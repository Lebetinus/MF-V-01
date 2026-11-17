import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../../db";
import { cashAccounts, records } from "../../../db/schema";
import { formatAmount, logActivity } from "./activity";
import type { SessionUser } from "./auth";
import { canAccessCashAccount, canWriteCashAccount } from "./cash-access";

// Kasalar arası borç. Borç yalnızca iki kasa arasında olur ve her işlem İKİ kayıt yazar (tek işlemde, kasa
// aktarımı gibi; bkz. transfers.ts). İki kayıt debt_link_id ile birbirine bağlıdır (ikiz):
//  - Borç ver  A → B:  A'da "lent" gider      +  B'de "borrowed" gelir
//  - Borç öde  B → A:  B'de "repay" gider     +  A'da "collected" gelir
// Kasa bakiyesine dördü de girer. Gelir/gider istatistiklerine yalnız borç alan tarafın kayıtları (borrowed, repay)
// girer; borç veren kasanın "lent" ve "collected" kayıtları istatistiğe girmez (para çıkar ve geri döner, sermaye
// gibi). İstemci de aynı kuralı uygular (app/lib/debts.ts isDebtLeg). Geçmiş kayıtlar hiçbir zaman değiştirilmez.

export const DEBT_ROLES = ["lent", "borrowed", "repay", "collected"] as const;
export type DebtRole = (typeof DEBT_ROLES)[number];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Borçlu kasanın alacaklı kasaya, belirli para biriminde kalan borcu: alınan borç − yapılan geri ödemeler
// (borçlu tarafın kayıtlarından).
export async function outstandingDebt(debtorId: number, creditorId: number, currency: string, db: DbClient): Promise<number> {
  const rows = await db
    .select({ role: records.debtRole, amount: records.amount })
    .from(records)
    .where(and(eq(records.cashAccountId, debtorId), eq(records.debtCashAccountId, creditorId), eq(records.currency, currency)));
  let sum = 0;
  for (const r of rows) {
    if (r.role === "borrowed") sum += r.amount;
    else if (r.role === "repay") sum -= r.amount;
  }
  return round2(sum);
}

export async function kasaName(id: number, db: DbClient): Promise<string | null> {
  const row = (await db.select({ name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.id, id)).limit(1))[0];
  return row?.name ?? null;
}

// Aynı kasa çifti için borç işlemleri sırayla yapılır: aynı anda iki ödeme "kalan borç" kontrolünü birlikte geçip
// fazla ödeme yapamasın. Transaction içinde çağrılmalıdır (kilit transaction sonunda bırakılır).
export async function lockDebtPair(a: number, b: number, tx: DbClient): Promise<void> {
  const pairKey = `debt:${Math.min(a, b)}:${Math.max(a, b)}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pairKey}))`);
}

type Leg = typeof records.$inferSelect;

// Bir borç işleminin iki kaydını yazar ve birbirine bağlar. `from` parası çıkan kasa (gider), `to` parası giren kasa
// (gelir). Borç verirken from = borç veren, to = borç alan; geri öderken from = borçlu, to = alacaklı.
export async function writeDebtPair(
  tx: DbClient,
  op: {
    mode: "lend" | "repay";
    from: { id: number; name: string };
    to: { id: number; name: string };
    amount: number;
    currency: string;
    date: string;
    note: string;
    detail: string;
  },
): Promise<{ fromLeg: Leg; toLeg: Leg }> {
  const lend = op.mode === "lend";
  const base = { date: op.date, note: op.note, amount: op.amount, currency: op.currency };
  const [fromInserted] = await tx
    .insert(records)
    .values({
      ...base,
      kind: "expense",
      source: lend ? "Borç verildi" : "Borç ödemesi",
      detail: op.detail || (lend ? `Borç verildi → ${op.to.name}` : `Borç ödemesi → ${op.to.name}`),
      person: op.to.name,
      cashAccount: op.from.name,
      cashAccountId: op.from.id,
      debtRole: lend ? "lent" : "repay",
      debtCashAccountId: op.to.id,
    })
    .returning();
  const [toLeg] = await tx
    .insert(records)
    .values({
      ...base,
      kind: "income",
      source: lend ? "Borç alındı" : "Borç tahsilatı",
      detail: op.detail || (lend ? `Borç alındı ← ${op.from.name}` : `Borç tahsilatı ← ${op.from.name}`),
      person: op.from.name,
      cashAccount: op.to.name,
      cashAccountId: op.to.id,
      debtRole: lend ? "borrowed" : "collected",
      debtCashAccountId: op.from.id,
      debtLinkId: fromInserted.id,
    })
    .returning();
  const [fromLeg] = await tx.update(records).set({ debtLinkId: toLeg.id }).where(eq(records.id, fromInserted.id)).returning();
  return { fromLeg, toLeg };
}

// Bir borç kaydının (borçlu, alacaklı) kasa çifti — rolüne göre.
export function debtPairOf(leg: { debtRole: string; cashAccountId: number | null; debtCashAccountId: number | null }): { debtorId: number; creditorId: number } | null {
  if (leg.cashAccountId == null || leg.debtCashAccountId == null) return null;
  const lenderSide = leg.debtRole === "lent" || leg.debtRole === "collected";
  return lenderSide
    ? { debtorId: leg.debtCashAccountId, creditorId: leg.cashAccountId }
    : { debtorId: leg.cashAccountId, creditorId: leg.debtCashAccountId };
}

// Bir borç kaydının ikizi: önce kendi debt_link_id'si, yoksa ona debt_link_id ile bağlanan kayıt.
export async function debtTwinOf(leg: Leg, db: DbClient): Promise<Leg | null> {
  if (leg.debtLinkId != null) {
    const twin = (await db.select().from(records).where(eq(records.id, leg.debtLinkId)).limit(1))[0];
    if (twin) return twin;
  }
  const back = (await db.select().from(records).where(eq(records.debtLinkId, leg.id)).limit(1))[0];
  return back ?? null;
}

class DebtRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type DebtOperationInput = {
  // Parası çıkan kasa (borç verirken borç veren, öderken borçlu) ve parası giren kasa.
  fromId: number;
  toId: number;
  amount: number;
  currency: string;
  date: string;
  note: string;
  detail: string;
};

// POST /api/debts (mode "lend") ve POST /api/debts/repay (mode "repay") ortak akışı. Yetki: kullanıcı iki kasaya da
// erişebilmeli, parası çıkan kasaya yazabilmeli (sahibi / süper admin — kasa aktarımı gibi) ve normal kayıt yazımı
// gibi "Gelir" ile "Gider" sayfa izinlerine sahip olmalı (iki kayıt yazılır: biri gelir, biri gider).
export async function runDebtOperation(
  user: SessionUser,
  mode: "lend" | "repay",
  input: DebtOperationInput,
  db: DbClient,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!user.isAdmin && !(user.permissions.includes("income") && user.permissions.includes("expense"))) {
    return { status: 403, body: { error: "Borç işlemi için Gelir ve Gider yetkisi gerekir" } };
  }
  if (input.fromId === input.toId) {
    return { status: 400, body: { error: mode === "lend" ? "Borç veren ve borç alan kasa farklı olmalıdır" : "Borçlu ve alacaklı kasa farklı olmalıdır" } };
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [fromName, toName] = await Promise.all([kasaName(input.fromId, tx), kasaName(input.toId, tx)]);
      if (!fromName || !toName) throw new DebtRequestError(404, "Kasa bulunamadı");
      if (!(await canAccessCashAccount(user, input.fromId, tx)) || !(await canWriteCashAccount(user, input.fromId, tx))) {
        throw new DebtRequestError(403, mode === "lend" ? "Borç veren kasaya yazma yetkiniz (erişiminiz) yok" : "Borcu ödeyen kasaya yazma yetkiniz (erişiminiz) yok");
      }
      if (!(await canAccessCashAccount(user, input.toId, tx))) {
        throw new DebtRequestError(403, mode === "lend" ? "Borç alan kasaya erişiminiz yok" : "Alacaklı kasaya erişiminiz yok");
      }
      await lockDebtPair(input.fromId, input.toId, tx);
      if (mode === "repay") {
        const remaining = await outstandingDebt(input.fromId, input.toId, input.currency, tx);
        if (remaining <= 0.004) throw new DebtRequestError(400, `${fromName} kasasının ${toName} kasasına ${input.currency} cinsinden borcu yok`);
        if (input.amount > remaining + 0.001) throw new DebtRequestError(400, `Ödeme kalan borçtan büyük olamaz (kalan: ${remaining} ${input.currency})`);
      }
      return writeDebtPair(tx, {
        mode,
        from: { id: input.fromId, name: fromName },
        to: { id: input.toId, name: toName },
        amount: round2(input.amount),
        currency: input.currency,
        date: input.date,
        note: input.note,
        detail: input.detail.trim(),
      });
    });
    const { fromLeg, toLeg } = result;
    await logActivity(user, {
      category: "cash",
      action: "create",
      summary: mode === "lend"
        ? `Borç verildi: ${fromLeg.cashAccount} → ${toLeg.cashAccount} — ${formatAmount(fromLeg.amount, fromLeg.currency)}`
        : `Borç ödendi: ${fromLeg.cashAccount} → ${toLeg.cashAccount} — ${formatAmount(fromLeg.amount, fromLeg.currency)}`,
      kasa: fromLeg.cashAccount,
      meta: { ids: [fromLeg.id, toLeg.id] },
    });
    return { status: 201, body: { records: [fromLeg, toLeg] } };
  } catch (error) {
    if (error instanceof DebtRequestError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
