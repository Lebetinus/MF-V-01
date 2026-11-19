import type { RecordItem } from "./types";

// Kasalar arası borç (sunucu mantığı: app/api/_lib/debts.ts). Her işlem iki kayıt yazar:
//  Borç ver A → B:  lent      (A'da gider)  +  borrowed  (B'de gelir)
//  Borç öde B → A:  repay     (B'de gider)  +  collected (A'da gelir)
// Kasa bakiyesine dördü de girer. Gelir/gider istatistiklerine (kasa kartlarındaki ↗/↘, Ana Sayfa, Analiz, Alan
// Detayları, kasa sayfasındaki Gelir/Gider toplamları) borç alan tarafın borrowed ve repay kayıtları girer; borç
// veren kasanın lent ve collected kayıtları girmez (para çıkar ve geri döner: sermaye gibi).

// Sistem dışı kasaya / projeye borç (sunucu: app/api/_lib/debts.ts runPartyDebtOperation): karşı kasa sistemde
// olmadığı için tek kayıt yazılır — borç veren kasada "lent" gider, tahsilatta "collected" gelir; debtParty = borç
// alan kasanın / projenin adı, person = parayı alan kişi (yalnız bilgi). Bunlar da borç veren tarafın kayıtlarıdır:
// bakiyeye girer, gelir/gider istatistiğine girmez. Proje adı büyük/küçük harf ve boşluk farkı gözetmeden eşleşir.
export const normalizeParty = (name: string) => name.trim().replace(/\s+/g, " ");
export const partyKey = (name: string) => normalizeParty(name).toLocaleUpperCase("tr-TR");
// Sistem dışı kasaya / projeye borç kaydı mı.
export const isPartyDebt = (x: Pick<RecordItem, "debtRole" | "debtCashAccountId" | "debtParty">) =>
  (x.debtRole === "lent" || x.debtRole === "collected") && x.debtCashAccountId == null && Boolean(x.debtParty?.trim());

// true = gelir/gider istatistiklerinin DIŞINDA tutulan borç kaydı (borç veren tarafın kayıtları).
export const isDebtLeg = (x: Pick<RecordItem, "debtRole">) => x.debtRole === "lent" || x.debtRole === "collected";
// Herhangi bir borç kaydı mı (dört rolden biri).
export const isDebtRecord = (x: Pick<RecordItem, "debtRole">) => Boolean(x.debtRole);
// Borç veren (alacaklı) tarafın kaydı mı.
const isLenderSide = (role?: string) => role === "lent" || role === "collected";

export type DebtPair = {
  key: string;
  // true = borçlu sistem dışı bir kasa / proje (debtorId 0, debtorName proje adı); tahsilatı alacaklı kasa yazar.
  external: boolean;
  // Parayı alan / ödeyen kişiler (kayıtların "Kişi" alanı; yalnız bilgi).
  people: string[];
  debtorId: number;
  debtorName: string;
  creditorId: number;
  creditorName: string;
  currency: string;
  // Borç alan tarafın kayıtları: alınan borç ve yapılan geri ödemeler.
  borrowed: number;
  repaid: number;
  // Borç veren tarafın aynaları: verilen borç ve geri alınan (tahsil edilen).
  lent: number;
  collected: number;
  // Görüntülenecek rakamlar: erişilebilen taraftan (borç veren taraf görünüyorsa onun kayıtlarından).
  given: number;
  returned: number;
  outstanding: number;
  // Çiftle ilgili tüm borç kayıtları (en yeni üstte; iki taraf da görünüyorsa her işlem iki kayıt).
  movements: RecordItem[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Kasa çiftlerine (borçlu → alacaklı, para birimi) göre borç özeti. Yalnızca erişilebilen kayıtlardan hesaplanır:
// kullanıcı yalnız bir tarafın kasasını görebiliyorsa rakamlar o tarafın kayıtlarından çıkar (iki taraf eşittir).
// Aynı kayıt dizisi için sonuç önbelleğe alınır (kasa kartları ve tablo hücreleri her çizimde tekrar sorar).
const pairsCache = new WeakMap<RecordItem[], DebtPair[]>();
export function debtPairs(records: RecordItem[]): DebtPair[] {
  const cached = pairsCache.get(records);
  if (cached) return cached;
  const result = computeDebtPairs(records);
  pairsCache.set(records, result);
  return result;
}

function computeDebtPairs(records: RecordItem[]): DebtPair[] {
  const map = new Map<string, DebtPair & { hasLender: boolean; hasBorrower: boolean }>();
  for (const x of records) {
    if (!x.debtRole || x.cashAccountId == null) continue;
    if (x.debtCashAccountId == null) {
      if (!isPartyDebt(x)) continue;
      // Sistem dışı borç: çift (kasa, proje, para birimi); yalnız borç veren kasanın kayıtları vardır.
      const party = normalizeParty(x.debtParty!);
      const key = `party:${x.cashAccountId}:${partyKey(party)}:${x.currency}`;
      let pair = map.get(key);
      if (!pair) {
        pair = { key, external: true, people: [], debtorId: 0, debtorName: party, creditorId: x.cashAccountId, creditorName: x.cashAccount, currency: x.currency, borrowed: 0, repaid: 0, lent: 0, collected: 0, given: 0, returned: 0, outstanding: 0, movements: [], hasLender: true, hasBorrower: false };
        map.set(key, pair);
      }
      if (x.debtRole === "lent") pair.lent += x.amount;
      else pair.collected += x.amount;
      const person = x.person?.trim();
      if (person && !pair.people.includes(person)) pair.people.push(person);
      pair.movements.push(x);
      continue;
    }
    const lender = isLenderSide(x.debtRole);
    // Çift her zaman (borçlu, alacaklı) sırasıyla anahtarlanır.
    const debtorId = lender ? x.debtCashAccountId : x.cashAccountId;
    const creditorId = lender ? x.cashAccountId : x.debtCashAccountId;
    const key = `${debtorId}:${creditorId}:${x.currency}`;
    let pair = map.get(key);
    if (!pair) {
      pair = { key, external: false, people: [], debtorId, debtorName: "", creditorId, creditorName: "", currency: x.currency, borrowed: 0, repaid: 0, lent: 0, collected: 0, given: 0, returned: 0, outstanding: 0, movements: [], hasLender: false, hasBorrower: false };
      map.set(key, pair);
    }
    if (lender) {
      pair.hasLender = true;
      pair.creditorName = x.cashAccount;
      pair.debtorName = pair.debtorName || x.person;
      if (x.debtRole === "lent") pair.lent += x.amount;
      else pair.collected += x.amount;
    } else {
      pair.hasBorrower = true;
      pair.debtorName = x.cashAccount;
      pair.creditorName = pair.creditorName || x.person;
      if (x.debtRole === "borrowed") pair.borrowed += x.amount;
      else if (x.debtRole === "repay") pair.repaid += x.amount;
    }
    pair.movements.push(x);
  }
  return [...map.values()]
    .map(({ hasLender, hasBorrower, ...p }) => ({
      ...p,
      borrowed: round2(p.borrowed),
      repaid: round2(p.repaid),
      lent: round2(p.lent),
      collected: round2(p.collected),
      // Verilen / geri alınan: borç veren taraf görünüyorsa onun kayıtları, yoksa borç alan tarafın aynaları.
      given: round2(hasLender ? p.lent : p.borrowed),
      returned: round2(hasLender ? p.collected : p.repaid),
      // Kalan borç: borç alan tarafın kayıtlarından (sunucunun ödeme sınırı da böyle hesaplanır).
      outstanding: round2(hasBorrower ? p.borrowed - p.repaid : p.lent - p.collected),
      movements: p.movements.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

// Bir kasanın (borçlu olarak) para birimine göre toplam kalan borcu — yalnızca borcu olan para birimleri.
export function kasaDebtByCurrency(records: RecordItem[], kasaName: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of debtPairs(records)) {
    if (p.external || p.debtorName !== kasaName || p.outstanding <= 0.004) continue;
    out[p.currency] = round2((out[p.currency] ?? 0) + p.outstanding);
  }
  return out;
}

// Bir kasanın (borç veren olarak) para birimine göre toplam alacağı — yalnızca alacağı olan para birimleri.
export function kasaReceivableByCurrency(records: RecordItem[], kasaName: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of debtPairs(records)) {
    if (p.creditorName !== kasaName || p.outstanding <= 0.004) continue;
    out[p.currency] = round2((out[p.currency] ?? 0) + p.outstanding);
  }
  return out;
}

export type KasaDebtStatus = {
  // Borç veren olarak: verilen borç, geri alınan, alacak (kalan).
  lender: { given: Record<string, number>; returned: Record<string, number>; receivable: Record<string, number> } | null;
  // Borç alan olarak: alınan borç, ödenen, kalan borç.
  borrower: { borrowed: Record<string, number>; repaid: Record<string, number>; remaining: Record<string, number> } | null;
};

// Kasa sayfasındaki "Borç durumu" kutusu: kasanın borç veren ve borç alan olarak para birimine göre durumu.
// Kasanın hiç borç hareketi olmayan tarafı null döner.
export function kasaDebtStatus(records: RecordItem[], kasaName: string): KasaDebtStatus {
  const add = (m: Record<string, number>, c: string, v: number) => { m[c] = round2((m[c] ?? 0) + v); };
  let lender: KasaDebtStatus["lender"] = null;
  let borrower: KasaDebtStatus["borrower"] = null;
  for (const p of debtPairs(records)) {
    if (p.creditorName === kasaName) {
      lender ??= { given: {}, returned: {}, receivable: {} };
      add(lender.given, p.currency, p.given);
      add(lender.returned, p.currency, p.returned);
      add(lender.receivable, p.currency, Math.max(0, p.outstanding));
    }
    if (!p.external && p.debtorName === kasaName) {
      borrower ??= { borrowed: {}, repaid: {}, remaining: {} };
      add(borrower.borrowed, p.currency, p.given);
      add(borrower.repaid, p.currency, p.returned);
      add(borrower.remaining, p.currency, Math.max(0, p.outstanding));
    }
  }
  return { lender, borrower };
}

// Bir borç kaydının ait olduğu çift (kasalar arası ya da sistem dışı).
export function debtPairOfRecord(records: RecordItem[], x: RecordItem): DebtPair | undefined {
  if (!x.debtRole || x.cashAccountId == null) return undefined;
  if (isPartyDebt(x)) {
    const key = `party:${x.cashAccountId}:${partyKey(x.debtParty!)}:${x.currency}`;
    return debtPairs(records).find((p) => p.key === key);
  }
  const lenderSide = isLenderSide(x.debtRole);
  const debtorId = lenderSide ? x.debtCashAccountId : x.cashAccountId;
  const creditorId = lenderSide ? x.cashAccountId : x.debtCashAccountId;
  return debtPairs(records).find((p) => !p.external && p.debtorId === debtorId && p.creditorId === creditorId && p.currency === x.currency);
}

// Daha önce kullanılmış sistem dışı kasa / proje adları (öneri listesi için), ilk yazımıyla.
export function knownParties(records: RecordItem[]): string[] {
  const seen = new Map<string, string>();
  for (const x of records) {
    if (!isPartyDebt(x)) continue;
    const name = normalizeParty(x.debtParty!);
    if (!seen.has(partyKey(name))) seen.set(partyKey(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "tr"));
}
