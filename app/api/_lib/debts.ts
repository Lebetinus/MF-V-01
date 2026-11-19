import { and, eq, isNull, ne, sql } from "drizzle-orm";
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

// ---------------------------------------------------------------------------------------------------------------
// Sistem dışı kasaya / projeye borç. Borç alan taraf sistemde bir kasa değildir (ör. "C.GROUP" projesi); parayı
// alan kişinin adı kaydın "Kişi" alanında durur (yalnız bilgi). Karşı kasa olmadığı için her işlem TEK kayıttır:
//  - Borç ver:     borç veren kasada "lent" gider       (debtCashAccountId boş, debtParty = proje adı)
//  - Tahsil et:    aynı kasada "collected" gelir        (geri ödenen para kasaya döner)
// İkisi de bakiyeye girer, gelir/gider istatistiğine girmez (isDebtLeg). Kalan alacak = lent − collected,
// (kasa, proje, para birimi) başına. Proje adı büyük/küçük harf ve boşluk farkı gözetilmeden eşleşir.
// ---------------------------------------------------------------------------------------------------------------

export const normalizeParty = (name: string) => name.trim().replace(/\s+/g, " ");
export const partyKey = (name: string) => normalizeParty(name).toLocaleUpperCase("tr-TR");

// Bir kasanın sistem dışı bir projeden (para biriminde) kalan alacağı: verilen borç − tahsil edilen.
export async function outstandingPartyDebt(kasaId: number, party: string, currency: string, db: DbClient): Promise<number> {
  const rows = await db
    .select({ role: records.debtRole, amount: records.amount, party: records.debtParty })
    .from(records)
    .where(and(eq(records.cashAccountId, kasaId), isNull(records.debtCashAccountId), eq(records.currency, currency), ne(records.debtParty, "")));
  const key = partyKey(party);
  let sum = 0;
  for (const r of rows) {
    if (partyKey(r.party) !== key) continue;
    if (r.role === "lent") sum += r.amount;
    else if (r.role === "collected") sum -= r.amount;
  }
  return round2(sum);
}

// Daha önce kullanılmış yazım (ilk kayıttaki) korunur: "c.group" yazılsa da "C.GROUP" olarak kaydedilir.
async function knownPartySpelling(party: string, db: DbClient): Promise<string> {
  const rows = await db
    .select({ party: records.debtParty })
    .from(records)
    .where(and(isNull(records.debtCashAccountId), ne(records.debtParty, "")))
    .orderBy(records.id);
  const key = partyKey(party);
  return rows.find((r) => partyKey(r.party) === key)?.party ?? normalizeParty(party);
}

export async function lockPartyDebt(kasaId: number, party: string, tx: DbClient): Promise<void> {
  const key = `debt-party:${kasaId}:${partyKey(party)}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

// Sistem dışı borç kaydı mı (karşı kasası olmayan lent / collected).
export const isPartyDebtLeg = (leg: { debtRole: string; debtCashAccountId: number | null; debtParty: string }) =>
  (leg.debtRole === "lent" || leg.debtRole === "collected") && leg.debtCashAccountId == null && leg.debtParty.trim() !== "";

export type PartyDebtInput = {
  kasaId: number;
  party: string;
  person: string;
  amount: number;
  currency: string;
  date: string;
  note: string;
  detail: string;
};

// POST /api/debts (borrowerParty ile) ve POST /api/debts/repay (debtorParty ile). Yetki kasalar arası borçla
// aynıdır: Gelir ve Gider izni + kasaya yazma yetkisi. Tahsilat kalan alacağı aşamaz.
export async function runPartyDebtOperation(
  user: SessionUser,
  mode: "lend" | "collect",
  input: PartyDebtInput,
  db: DbClient,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!user.isAdmin && !(user.permissions.includes("income") && user.permissions.includes("expense"))) {
    return { status: 403, body: { error: "Borç işlemi için Gelir ve Gider yetkisi gerekir" } };
  }
  const lend = mode === "lend";
  try {
    const leg = await db.transaction(async (tx) => {
      const name = await kasaName(input.kasaId, tx);
      if (!name) throw new DebtRequestError(404, "Kasa bulunamadı");
      if (!(await canAccessCashAccount(user, input.kasaId, tx)) || !(await canWriteCashAccount(user, input.kasaId, tx))) {
        throw new DebtRequestError(403, lend ? "Borç veren kasaya yazma yetkiniz (erişiminiz) yok" : "Tahsilatı alan kasaya yazma yetkiniz (erişiminiz) yok");
      }
      await lockPartyDebt(input.kasaId, input.party, tx);
      const party = await knownPartySpelling(input.party, tx);
      if (!lend) {
        const remaining = await outstandingPartyDebt(input.kasaId, party, input.currency, tx);
        if (remaining <= 0.004) throw new DebtRequestError(400, `${name} kasasının ${party} için ${input.currency} cinsinden alacağı yok`);
        if (input.amount > remaining + 0.001) throw new DebtRequestError(400, `Tahsilat kalan alacaktan büyük olamaz (kalan: ${remaining} ${input.currency})`);
      }
      const [row] = await tx
        .insert(records)
        .values({
          kind: lend ? "expense" : "income",
          date: input.date,
          source: party,
          detail: input.detail || (lend ? `Borç verildi → ${party}` : `Borç tahsilatı ← ${party}`),
          note: input.note,
          person: normalizeParty(input.person),
          amount: round2(input.amount),
          currency: input.currency,
          cashAccount: name,
          cashAccountId: input.kasaId,
          debtRole: lend ? "lent" : "collected",
          debtParty: party,
        })
        .returning();
      return row;
    });
    await logActivity(user, {
      category: "cash",
      action: "create",
      summary: lend
        ? `Borç verildi: ${leg.cashAccount} → ${leg.debtParty}${leg.person ? ` (${leg.person})` : ""} — ${formatAmount(leg.amount, leg.currency)}`
        : `Borç tahsil edildi: ${leg.debtParty} → ${leg.cashAccount} — ${formatAmount(leg.amount, leg.currency)}`,
      kasa: leg.cashAccount,
      meta: { ids: [leg.id] },
    });
    return { status: 201, body: { records: [leg] } };
  } catch (error) {
    if (error instanceof DebtRequestError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

type DebtChange = { record?: Leg; error?: { status: number; message: string } };

// "Borca çevir": var olan normal bir kaydı sistem dışı borç kaydına çevirir (gider → verilen borç, gelir → borç
// tahsilatı); tutar, tarih, ana başlık, kişi ve belgeler aynen kalır. Tahsilata çevirmek kalan alacağı aşamaz.
export async function markRecordAsPartyDebt(tx: DbClient, old: Leg, partyInput: string): Promise<DebtChange> {
  if (old.debtRole) return { error: { status: 400, message: "Bu kayıt zaten bir borç kaydı" } };
  if (old.cashAccountId == null) return { error: { status: 400, message: "Kasaya bağlı olmayan kayıt borca çevrilemez" } };
  await lockPartyDebt(old.cashAccountId, partyInput, tx);
  const party = await knownPartySpelling(partyInput, tx);
  const role = old.kind === "expense" ? "lent" : "collected";
  if (role === "collected") {
    const remaining = await outstandingPartyDebt(old.cashAccountId, party, old.currency, tx);
    if (old.amount > remaining + 0.001) {
      return { error: { status: 400, message: `Tahsilat kalan alacaktan büyük olamaz (${party} kalan: ${remaining} ${old.currency})` } };
    }
  }
  const [record] = await tx
    .update(records)
    .set({ debtRole: role, debtParty: party, debtCashAccountId: null, debtLinkId: null, updatedAt: new Date() })
    .where(and(eq(records.id, old.id), eq(records.debtRole, "")))
    .returning();
  if (!record) return { error: { status: 409, message: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" } };
  return { record };
}

// "Borçtan çıkar": sistem dışı borç kaydını yeniden normal gelir / gidere döndürür. Verilen borcu geri almak, o borca
// yapılmış tahsilatlar kalan alacaktan fazla kalacaksa reddedilir.
export async function unmarkPartyDebt(tx: DbClient, old: Leg): Promise<DebtChange> {
  if (!isPartyDebtLeg(old) || old.cashAccountId == null) {
    return { error: { status: 400, message: "Yalnız sistem dışı kasaya / projeye borç kaydı normal kayda döndürülebilir" } };
  }
  await lockPartyDebt(old.cashAccountId, old.debtParty, tx);
  if (old.debtRole === "lent") {
    const remaining = await outstandingPartyDebt(old.cashAccountId, old.debtParty, old.currency, tx);
    if (remaining - old.amount < -0.004) {
      return { error: { status: 409, message: "Bu borca yapılan tahsilatlar kalan alacaktan fazla olur; önce tahsilatları geri alın" } };
    }
  }
  const [record] = await tx
    .update(records)
    .set({ debtRole: "", debtParty: "", source: originalSourceOf(old), debtMeta: [], updatedAt: new Date() })
    .where(and(eq(records.id, old.id), eq(records.debtRole, old.debtRole)))
    .returning();
  if (!record) return { error: { status: 409, message: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" } };
  return { record };
}

// "Borca çevir" — sistemdeki bir kasaya / projeye: var olan kayıt kasalar arası borcun bir tarafı olur ve karşı
// kasaya ikizi yazılır (Borç ver / Borç öde ile yazılan çiftle aynı yapı). Gider → "lent" (karşı kasada "borrowed"
// gelir); gelir → "collected" (karşı kasada "repay" gider; karşı kasanın bu kasaya kalan borcunu aşamaz). Tutar,
// tarih, ana başlık ve kişi aynen kalır. debtParty her iki tarafta karşı kasanın adını tutar (kullanıcı karşı kasayı
// göremese de borç ona göre adlandırılır).
export async function markRecordAsKasaDebt(
  tx: DbClient,
  user: SessionUser,
  old: Leg,
  counterpartId: number,
): Promise<DebtChange & { twin?: Leg }> {
  if (old.debtRole) return { error: { status: 400, message: "Bu kayıt zaten bir borç kaydı" } };
  if (old.cashAccountId == null) return { error: { status: 400, message: "Kasaya bağlı olmayan kayıt borca çevrilemez" } };
  if (counterpartId === old.cashAccountId) return { error: { status: 400, message: "Borç alan kasa, kaydın kasasından farklı olmalıdır" } };
  const counterpartName = await kasaName(counterpartId, tx);
  if (!counterpartName) return { error: { status: 404, message: "Kasa bulunamadı" } };
  if (!(await canAccessCashAccount(user, counterpartId, tx))) return { error: { status: 403, message: "Seçilen kasaya erişiminiz yok" } };
  await lockDebtPair(old.cashAccountId, counterpartId, tx);
  const lend = old.kind === "expense";
  if (!lend) {
    // Gelir, karşı kasanın (borçlu) bu kasaya (alacaklı) geri ödemesi sayılır.
    const remaining = await outstandingDebt(counterpartId, old.cashAccountId, old.currency, tx);
    if (old.amount > remaining + 0.001) {
      return { error: { status: 400, message: `Tahsilat kalan borçtan büyük olamaz (${counterpartName} kalan: ${remaining} ${old.currency})` } };
    }
  }
  const [twin] = await tx
    .insert(records)
    .values({
      kind: lend ? "income" : "expense",
      date: old.date,
      // Ana başlık karşı kasanın adıdır (bu kayıtta da seçilen kasanın adı olur).
      source: old.cashAccount,
      detail: lend ? `Borç alındı ← ${old.cashAccount}` : `Borç ödemesi → ${old.cashAccount}`,
      note: old.note,
      person: old.person,
      amount: old.amount,
      currency: old.currency,
      cashAccount: counterpartName,
      cashAccountId: counterpartId,
      debtRole: lend ? "borrowed" : "repay",
      debtCashAccountId: old.cashAccountId,
      debtParty: old.cashAccount,
      debtLinkId: old.id,
    })
    .returning();
  const [record] = await tx
    .update(records)
    .set({
      debtRole: lend ? "lent" : "collected",
      debtCashAccountId: counterpartId,
      debtParty: counterpartName,
      debtLinkId: twin.id,
      // Sistem içi borçta ana başlık seçilen kasanın adı olur; eski başlık "Borçtan çıkar" için saklanır.
      source: counterpartName,
      debtMeta: { originalSource: old.source },
      updatedAt: new Date(),
    })
    .where(and(eq(records.id, old.id), eq(records.debtRole, "")))
    .returning();
  // Yarış: kayıt bu arada değiştiyse transaction geri alınır (ikiz de yazılmamış olur).
  if (!record) throw new DebtRaceError();
  return { record, twin };
}

export class DebtRaceError extends Error {}

// "Borçtan çıkar" — kasalar arası borç kaydı: tıklanan kayıt normal gelir / gidere döner, karşı kasadaki ikizi silinir
// (Arşiv'e yazılması çağıranın işidir). Verilen / alınan borcu geri almak, o borca yapılmış geri ödemeler kalan borçtan
// fazla kalacaksa reddedilir.
export async function unmarkKasaDebt(tx: DbClient, old: Leg): Promise<DebtChange & { twin?: Leg | null }> {
  const pair = debtPairOf(old);
  if (!pair) return { error: { status: 400, message: "Bu kayıt kasalar arası bir borç kaydı değil" } };
  await lockDebtPair(pair.debtorId, pair.creditorId, tx);
  const current = (await tx.select().from(records).where(eq(records.id, old.id)).limit(1))[0];
  if (!current || current.debtRole !== old.debtRole) return { error: { status: 409, message: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" } };
  if (current.debtRole === "lent" || current.debtRole === "borrowed") {
    const remaining = await outstandingDebt(pair.debtorId, pair.creditorId, current.currency, tx);
    if (remaining - current.amount < -0.004) {
      return { error: { status: 409, message: "Bu borca yapılan geri ödemeler kalan borçtan fazla olur; önce geri ödemeleri geri alın" } };
    }
  }
  const twin = await debtTwinOf(current, tx);
  if (twin) await tx.delete(records).where(eq(records.id, twin.id));
  const [record] = await tx
    .update(records)
    .set({ debtRole: "", debtCashAccountId: null, debtLinkId: null, debtParty: "", source: originalSourceOf(current), debtMeta: [], updatedAt: new Date() })
    .where(eq(records.id, current.id))
    .returning();
  return { record, twin };
}

// "Borca çevir" sırasında değişen ana başlığın eski hali (debtMeta.originalSource); yoksa kaydın şimdiki başlığı.
export function originalSourceOf(leg: { source: string; debtMeta: unknown }): string {
  const meta = leg.debtMeta as { originalSource?: unknown } | null;
  return meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.originalSource === "string" ? meta.originalSource : leg.source;
}

// Borç adımı başarısız olursa transaction geri alınsın diye fırlatılır (ör. karşı tarafı değiştirirken: işaret
// kaldırıldıktan sonra yeni işaret konamazsa kaldırma da geri alınır).
export class DebtStepError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
