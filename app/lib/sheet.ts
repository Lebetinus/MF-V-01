// Excel tarzı tablo notlarının hesap motoru (bkz. components/NoteSheet).
// Hücreler ham metin tutar; "=" ile başlayan hücre formüldür:
//   =B2*C2   =TOPLA(B2:B10)   =ORTALAMA(A1:A5;C1)   =(B2-B3)/B3*100   =B2*18%
// İşlemler: + - * / ^ ve sondaki % ; aralık A1:B5 ; bağımsız değişken ayırıcı ";" veya ",".
// İşlevler (Türkçe ve İngilizce adlarla): TOPLA/SUM, ORTALAMA/AVERAGE, MIN, MAKS/MAX, SAY/COUNT,
// YUVARLA/ROUND, MUTLAK/ABS.
import type { FinanceNote, NoteSheet } from "./types";

export type SheetError = { error: string };
export type CellValue = number | string | SheetError;

export const SHEET_ERR = {
  parse: "#HATA!",
  div0: "#BÖL/0!",
  ref: "#BAŞV!",
  cycle: "#DÖNGÜ!",
  value: "#DEĞER!",
  name: "#AD?",
} as const;

export const isSheetError = (v: CellValue): v is SheetError => typeof v === "object" && v !== null && "error" in v;

class Fail extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function colName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

// Hücreye yazılan sayı: "1.250,50", "1250.5", "1,5", "₺ 1.250", "%18", "-3" … Sayı değilse null.
export function parseSheetNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let percent = false;
  if (s.startsWith("%")) { percent = true; s = s.slice(1); }
  if (s.endsWith("%")) { percent = true; s = s.slice(0, -1); }
  s = s.replace(/^(?:[$€£₺]|TL|TRY|USD|EUR)\s*/i, "").replace(/\s*(?:[$€£₺]|TL|TRY|USD|EUR)$/i, "").replace(/\s/g, "");
  if (!/^[-+]?(?:\d|[.,]\d)[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // İkisi birden: sondaki ondalık ayırıcıdır.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Yalnız virgül: birden çoksa binlik, tek ise ondalık (Türkçe yazım).
    s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Yalnız nokta: birden çoksa ya da tek noktadan sonra tam 3 hane varsa binlik ("1.250"), değilse ondalık.
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1 || /^[-+]?\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "ref"; r: number; c: number }
  | { t: "fn"; name: string }
  | { t: "err"; code: string }
  | { t: "op"; v: string };

const FOLD: Record<string, string> = { Ç: "C", Ğ: "G", İ: "I", I: "I", Ö: "O", Ş: "S", Ü: "U" };
const fold = (name: string) => name.toLocaleUpperCase("tr").replace(/[ÇĞİÖŞÜ]/g, (ch) => FOLD[ch] ?? ch);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) { i += ws[0].length; continue; }
    const err = /^#(?:BAŞV|REF)!/i.exec(rest);
    if (err) { out.push({ t: "err", code: SHEET_ERR.ref }); i += err[0].length; continue; }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(rest);
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const ref = /^\$?([A-Za-z]{1,2})\$?(\d+)(?![\w(])/.exec(rest);
    if (ref) { out.push({ t: "ref", r: Number(ref[2]) - 1, c: colIndex(ref[1]) }); i += ref[0].length; continue; }
    const fn = /^[A-Za-zÇĞİÖŞÜçğıöşü_][A-Za-z0-9ÇĞİÖŞÜçğıöşü_.]*/.exec(rest);
    if (fn) { out.push({ t: "fn", name: fold(fn[0]) }); i += fn[0].length; continue; }
    if ("+-*/^()%:;,".includes(src[i])) { out.push({ t: "op", v: src[i] }); i += 1; continue; }
    throw new Fail(SHEET_ERR.parse);
  }
  return out;
}

type Agg = (nums: number[], extra: number[]) => number;
const FUNCS: Record<string, { agg: Agg; min?: number; max?: number }> = {
  SUM: { agg: (n) => n.reduce((a, b) => a + b, 0) },
  AVERAGE: {
    agg: (n) => {
      if (!n.length) throw new Fail(SHEET_ERR.div0);
      return n.reduce((a, b) => a + b, 0) / n.length;
    },
  },
  MIN: { agg: (n) => (n.length ? Math.min(...n) : 0) },
  MAX: { agg: (n) => (n.length ? Math.max(...n) : 0) },
  COUNT: { agg: (n) => n.length },
  ROUND: {
    min: 1,
    max: 2,
    agg: (_n, a) => {
      const f = 10 ** Math.trunc(a[1] ?? 0);
      return Math.round(a[0] * f) / f;
    },
  },
  ABS: { min: 1, max: 1, agg: (_n, a) => Math.abs(a[0]) },
};
const ALIASES: Record<string, string> = {
  TOPLA: "SUM", ORTALAMA: "AVERAGE", MAKS: "MAX", SAY: "COUNT", BAG_DEG_SAY: "COUNT",
  YUVARLA: "ROUND", MUTLAK: "ABS",
};

export function createSheetEvaluator(data: string[][], rows: number, cols: number) {
  const cache = new Map<number, CellValue>();
  const visiting = new Set<number>();

  function value(r: number, c: number): CellValue {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return { error: SHEET_ERR.ref };
    const key = r * 10_000 + c;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (visiting.has(key)) return { error: SHEET_ERR.cycle };
    visiting.add(key);
    const v = compute(data[r]?.[c] ?? "");
    visiting.delete(key);
    cache.set(key, v);
    return v;
  }

  function compute(raw: string): CellValue {
    if (!raw.startsWith("=")) {
      if (!raw.trim()) return "";
      const n = parseSheetNumber(raw);
      return n === null ? raw : n;
    }
    try {
      const v = evaluate(raw.slice(1));
      if (!Number.isFinite(v)) return { error: SHEET_ERR.div0 };
      return v;
    } catch (e) {
      return { error: e instanceof Fail ? e.code : SHEET_ERR.parse };
    }
  }

  function toNum(v: CellValue): number {
    if (typeof v === "number") return v;
    if (isSheetError(v)) throw new Fail(v.error);
    if (!v.trim()) return 0;
    const n = parseSheetNumber(v);
    if (n === null) throw new Fail(SHEET_ERR.value);
    return n;
  }

  function evaluate(src: string): number {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => { const t = toks[p]; return t?.t === "op" && t.v === v; };
    const expect = (v: string) => { if (!isOp(v)) throw new Fail(SHEET_ERR.parse); p += 1; };

    function add(): number {
      let left = mul();
      while (isOp("+") || isOp("-")) {
        const op = (toks[p++] as { v: string }).v;
        const right = mul();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }
    function mul(): number {
      let left = pow();
      while (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { v: string }).v;
        const right = pow();
        if (op === "/" && right === 0) throw new Fail(SHEET_ERR.div0);
        left = op === "*" ? left * right : left / right;
      }
      return left;
    }
    function pow(): number {
      const base = unary();
      if (isOp("^")) { p += 1; return base ** pow(); }
      return base;
    }
    function unary(): number {
      if (isOp("-")) { p += 1; return -unary(); }
      if (isOp("+")) { p += 1; return unary(); }
      let v = primary();
      while (isOp("%")) { p += 1; v /= 100; }
      return v;
    }
    function primary(): number {
      const t = peek();
      if (!t) throw new Fail(SHEET_ERR.parse);
      if (t.t === "num") { p += 1; return t.v; }
      if (t.t === "err") throw new Fail(t.code);
      if (t.t === "ref") {
        p += 1;
        if (isOp(":")) throw new Fail(SHEET_ERR.value);
        return toNum(value(t.r, t.c));
      }
      if (t.t === "fn") {
        p += 1;
        const fn = FUNCS[ALIASES[t.name] ?? t.name];
        if (!fn) throw new Fail(SHEET_ERR.name);
        expect("(");
        // nums: aralıklardaki sayılar (metin/boş atlanır) + doğrudan bağımsız değişkenler; extra: yalnız doğrudanlar.
        const nums: number[] = [];
        const extra: number[] = [];
        if (!isOp(")")) {
          for (;;) {
            const a = peek();
            const b = toks[p + 1];
            const c = toks[p + 2];
            if (a?.t === "ref" && b?.t === "op" && b.v === ":" && c?.t === "ref") {
              p += 3;
              for (let r = Math.min(a.r, c.r); r <= Math.max(a.r, c.r); r++)
                for (let col = Math.min(a.c, c.c); col <= Math.max(a.c, c.c); col++) {
                  const v = value(r, col);
                  if (isSheetError(v)) throw new Fail(v.error);
                  if (typeof v === "number") nums.push(v);
                }
            } else {
              const v = add();
              nums.push(v);
              extra.push(v);
            }
            if (isOp(";") || isOp(",")) { p += 1; continue; }
            break;
          }
        }
        expect(")");
        if ((fn.min !== undefined && extra.length < fn.min) || (fn.max !== undefined && extra.length > fn.max)) throw new Fail(SHEET_ERR.value);
        return fn.agg(nums, extra);
      }
      if (isOp("(")) {
        p += 1;
        const v = add();
        expect(")");
        return v;
      }
      throw new Fail(SHEET_ERR.parse);
    }

    const result = add();
    if (p !== toks.length) throw new Fail(SHEET_ERR.parse);
    return result;
  }

  return value;
}

// Görüntülenecek metin: formül sonuçları ve sayılar yerel biçimde, metin olduğu gibi.
export function formatSheetValue(v: CellValue, raw: string, locale: string): string {
  if (isSheetError(v)) return v.error;
  if (typeof v === "number") {
    // Elle yazılan sayı kullanıcının yazdığı gibi kalır; formül sonucu biçimlenir.
    if (!raw.startsWith("=")) return raw.trim();
    return v.toLocaleString(locale, { maximumFractionDigits: 2 });
  }
  return v;
}

export function emptySheet(rows = 20, cols = 8): NoteSheet {
  return { rows, cols, data: [] };
}

// rows × cols tam matris (eksik hücreler boş metin).
export function padSheet(sheet: NoteSheet): string[][] {
  return Array.from({ length: sheet.rows }, (_, r) => Array.from({ length: sheet.cols }, (_, c) => sheet.data[r]?.[c] ?? ""));
}

// Kaydederken sondaki boş hücreler/satırlar atılır (boyut rows/cols'ta kalır).
export function trimSheet(sheet: NoteSheet): NoteSheet {
  const data = sheet.data.map((row) => {
    let end = row.length;
    while (end > 0 && !row[end - 1]) end -= 1;
    return row.slice(0, end);
  });
  let last = data.length;
  while (last > 0 && data[last - 1].length === 0) last -= 1;
  return { ...sheet, data: data.slice(0, last) };
}

// Satır/sütun eklenip silinince formüllerdeki başvurular kaydırılır; silinen hücreye başvuru #BAŞV! olur.
export function shiftFormulaRefs(raw: string, axis: "row" | "col", at: number, delta: number): string {
  if (!raw.startsWith("=")) return raw;
  return raw.replace(/(?<![A-Za-z0-9_])(\$?)([A-Za-z]{1,2})(\$?)(\d+)(?![\w(])/g, (whole, d1: string, letters: string, d2: string, digits: string) => {
    let r = Number(digits) - 1;
    let c = colIndex(letters);
    const pos = axis === "row" ? r : c;
    if (delta < 0 && pos === at) return SHEET_ERR.ref;
    if (pos >= at) {
      if (axis === "row") r += delta;
      else c += delta;
    }
    return `${d1}${colName(c)}${d2}${r + 1}`;
  });
}

// Tablo notu mu (eski notlarda format alanı yoksa düz not sayılır).
export const isSheetNote = (note: Pick<FinanceNote, "format" | "sheet">) => note.format === "sheet" && Boolean(note.sheet);

// Tablodaki tüm metin (arama için).
export const sheetText = (sheet: NoteSheet | null | undefined) => (sheet ? sheet.data.flat().filter(Boolean).join(" ") : "");
