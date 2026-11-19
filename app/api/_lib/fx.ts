import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../../db";
import { records } from "../../../db/schema";
import { formatAmount, logActivity } from "./activity";
import type { SessionUser } from "./auth";
import { canAccessCashAccount, canWriteCashAccount } from "./cash-access";
import { kasaName } from "./debts";
import { transferForRecord } from "./transfers";

// Döviz işlemleri. İki iş yapar:
//  1. Döviz bozdur (kasa içi): bir kasada bir para biriminden ötekine geçiş. Tek işlemde İKİ kayıt yazılır ve
//     birbirine bağlanır (fxLinkId): verilen birimde "out" gider + alınan birimde "in" gelir. İkisi de bakiyeye girer,
//     gelir/gider istatistiğine girmez (istemci: app/lib/debts.ts isDebtLeg). Alınan kayıtta çevrilen tutar, birimi ve
//     kur bilgi olarak durur. Bir tarafı silmek ikisini birlikte siler.
//  2. Kaydı çevir ("Dolara çevir"): var olan normal bir gelir / giderin tutarı ve para birimi kurla çevrilir; eski
//     tutar, birimi ve kur kayıtta bilgi olarak kalır (originalAmount / originalCurrency / fxRate). Geri alınabilir.
// Kur: bir taraf USD ise "1 USD = kur diğer birim" (Ayarlar > Döviz Kurları ile aynı), değilse "1 kaynak = kur hedef".

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fxConvert(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return round2(amount);
  if (to === "USD") return round2(amount / rate);
  return round2(amount * rate);
}

// Okunur kur (istemcideki app/lib/fx.ts fxRateLabel ile aynı): 1'den küçük USD kuru ters çevrilerek yazılır
// ("1 USD = 0,91 EUR" yerine "1 EUR = 1,0974 USD").
function formatRate(n: number): string {
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: digits });
}
export function fxRateLabel(from: string, to: string, rate: number): string {
  const usdSide = from === "USD" || to === "USD";
  const other = from === "USD" ? to : from;
  if (usdSide && rate > 0 && rate < 1) return `1 ${other} = ${formatRate(1 / rate)} USD`;
  if (usdSide) return `1 USD = ${formatRate(rate)} ${other}`;
  return `1 ${from} = ${formatRate(rate)} ${to}`;
}

class FxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Row = typeof records.$inferSelect;

// Bozdurma kaydı mı ya da çevrilemeyecek / bozdurmaya dönüştürülemeyecek özel bir kayıt mı (borç, aktarım).
export async function specialRecordReason(row: Row, db: DbClient): Promise<string | null> {
  if (row.fxRole) return "Döviz bozdurma kaydı";
  if (row.debtRole) return "Borç kaydı";
  if (await transferForRecord(row.id, db)) return "Kasa aktarımı kaydı";
  return null;
}

// POST /api/fx — kasa içi döviz bozdurma.
export async function runFxExchange(
  user: SessionUser,
  input: { cashAccountId: number; fromCurrency: string; toCurrency: string; amount: number; rate: number; date: string; note: string },
  db: DbClient,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!user.isAdmin && !(user.permissions.includes("income") && user.permissions.includes("expense"))) {
    return { status: 403, body: { error: "Döviz bozdurma için Gelir ve Gider yetkisi gerekir" } };
  }
  const fromAmount = round2(input.amount);
  const toAmount = fxConvert(fromAmount, input.fromCurrency, input.toCurrency, input.rate);
  if (toAmount <= 0) return { status: 400, body: { error: "Çevrilen tutar sıfır çıkıyor; tutarı ya da kuru kontrol edin" } };
  const label = fxRateLabel(input.fromCurrency, input.toCurrency, input.rate);
  try {
    const legs = await db.transaction(async (tx) => {
      const name = await kasaName(input.cashAccountId, tx);
      if (!name) throw new FxError(404, "Kasa bulunamadı");
      if (!(await canAccessCashAccount(user, input.cashAccountId, tx)) || !(await canWriteCashAccount(user, input.cashAccountId, tx))) {
        throw new FxError(403, "Bu kasaya yazma yetkiniz (erişiminiz) yok");
      }
      const detail = `Döviz bozdurma: ${formatAmount(fromAmount, input.fromCurrency)} → ${formatAmount(toAmount, input.toCurrency)} · ${label}`;
      const base = { date: input.date, note: input.note, detail, cashAccount: name, cashAccountId: input.cashAccountId, fxRate: input.rate };
      const [out] = await tx
        .insert(records)
        .values({ ...base, kind: "expense", source: "Döviz bozdurma", amount: fromAmount, currency: input.fromCurrency, fxRole: "out" })
        .returning();
      const [inn] = await tx
        .insert(records)
        .values({
          ...base,
          kind: "income",
          source: "Döviz bozdurma",
          amount: toAmount,
          currency: input.toCurrency,
          fxRole: "in",
          fxLinkId: out.id,
          originalAmount: fromAmount,
          originalCurrency: input.fromCurrency,
        })
        .returning();
      const [outLinked] = await tx.update(records).set({ fxLinkId: inn.id }).where(eq(records.id, out.id)).returning();
      return [outLinked, inn];
    });
    await logActivity(user, {
      category: "cash",
      action: "create",
      summary: `Döviz bozduruldu (${legs[0].cashAccount}): ${formatAmount(fromAmount, input.fromCurrency)} → ${formatAmount(toAmount, input.toCurrency)} · ${label}`,
      kasa: legs[0].cashAccount,
      meta: { ids: legs.map((l) => l.id) },
    });
    return { status: 201, body: { records: legs } };
  } catch (error) {
    if (error instanceof FxError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

// Bozdurma kaydının öteki tarafı.
export async function fxTwinOf(row: Row, db: DbClient): Promise<Row | null> {
  if (row.fxLinkId != null) {
    const twin = (await db.select().from(records).where(eq(records.id, row.fxLinkId)).limit(1))[0];
    if (twin) return twin;
  }
  return (await db.select().from(records).where(eq(records.fxLinkId, row.id)).limit(1))[0] ?? null;
}

// "Dolara çevir": kaydın tutarı ve birimi çevrilir, ilk tutar / birim / kur bilgi olarak saklanır. Zaten çevrilmiş bir
// kayıt yeniden çevrilirse "ilk" bilgi korunur (en baştaki tutar ve birim), kur yeni çeviriye göre yazılır.
export async function convertRecord(tx: DbClient, old: Row, toCurrency: string, rate: number): Promise<{ record?: Row; error?: { status: number; message: string } }> {
  if (old.currency === toCurrency) return { error: { status: 400, message: `Kayıt zaten ${toCurrency}` } };
  const amount = fxConvert(old.amount, old.currency, toCurrency, rate);
  if (amount <= 0) return { error: { status: 400, message: "Çevrilen tutar sıfır çıkıyor; kuru kontrol edin" } };
  const firstAmount = old.originalCurrency ? old.originalAmount : old.amount;
  const firstCurrency = old.originalCurrency || old.currency;
  const [record] = await tx
    .update(records)
    .set({ amount, currency: toCurrency, originalAmount: firstAmount, originalCurrency: firstCurrency, fxRate: rate, updatedAt: new Date() })
    .where(and(eq(records.id, old.id), sql`date_trunc('milliseconds', ${records.updatedAt}) = ${old.updatedAt.toISOString()}::timestamptz`, sql`${records.fxRole} = ''`, sql`${records.debtRole} = ''`))
    .returning();
  if (!record) return { error: { status: 409, message: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" } };
  return { record };
}

// Çevirmeyi geri al: kayıt ilk tutarına ve birimine döner, çeviri bilgisi silinir.
export async function revertConversion(tx: DbClient, old: Row): Promise<{ record?: Row; error?: { status: number; message: string } }> {
  if (old.fxRole) return { error: { status: 400, message: "Döviz bozdurma kaydı geri çevrilemez; bozdurmayı silin" } };
  if (!old.originalCurrency || old.originalAmount == null) return { error: { status: 400, message: "Bu kayıt çevrilmemiş" } };
  const [record] = await tx
    .update(records)
    .set({ amount: old.originalAmount, currency: old.originalCurrency, originalAmount: null, originalCurrency: "", fxRate: null, updatedAt: new Date() })
    .where(and(eq(records.id, old.id), sql`date_trunc('milliseconds', ${records.updatedAt}) = ${old.updatedAt.toISOString()}::timestamptz`))
    .returning();
  if (!record) return { error: { status: 409, message: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" } };
  return { record };
}
