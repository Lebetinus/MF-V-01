import type { ExchangeRates } from "./finance";

// Döviz (sunucu: app/api/_lib/fx.ts). Kur: bir taraf USD ise "1 USD = kur diğer birim" (Ayarlar > Döviz Kurları ile
// aynı biçim), değilse "1 kaynak = kur hedef".
export const FX_CURRENCIES = ["USD", "EUR", "IQD", "SYP", "TRY"];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fxConvert(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return round2(amount);
  if (to === "USD") return round2(amount / rate);
  return round2(amount * rate);
}

// Kurun ne anlama geldiği: "1 USD = … SYP" ya da "1 EUR = … SYP". [solda 1 olan birim, sağdaki birim]
export function fxRateUnits(from: string, to: string): [string, string] {
  if (from === "USD") return ["USD", to];
  if (to === "USD") return ["USD", from];
  return [from, to];
}

// Kuru okunur gösterir: büyük kurlar 2, küçükler daha çok ondalıkla. "1 USD = 0,91 EUR" gibi 1'den küçük bir kur ters
// çevrilerek "1 EUR = 1,0974 USD" yazılır (saklanan kur değişmez; yalnız gösterim).
export function formatRate(n: number): string {
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: digits });
}
export function fxRateLabel(from: string, to: string, rate: number): string {
  const [one, other] = fxRateUnits(from, to);
  if (one === "USD" && rate > 0 && rate < 1) return `1 ${other} = ${formatRate(1 / rate)} USD`;
  return `1 ${one} = ${formatRate(rate)} ${other}`;
}

// Ayarlar > Döviz Kurları'ndan önerilen kur (yoksa null).
export function suggestedRate(from: string, to: string, rates: ExchangeRates): number | null {
  if (from === to) return 1;
  const r = (c: string) => (c === "USD" ? 1 : rates[c] && rates[c] > 0 ? rates[c] : null);
  const rf = r(from);
  const rt = r(to);
  if (rf == null || rt == null) return null;
  if (from === "USD") return rt;
  if (to === "USD") return rf;
  return Math.round((rt / rf) * 1e8) / 1e8;
}
