// Eklenmiş Excel belgesini görüntülemek için okur (içe aktarma okuyucusundan ayrı: app/lib/excelImport.ts readWorkbook).
// Excel'deki görünüme yakın olsun diye: birleştirilmiş hücreler tek hücre olarak (colSpan / rowSpan) gelir — eskiden
// her parçasında aynı yazı tekrar ediyordu —, gizli satır / sütunlar atlanır, sütun genişlikleri, kalın / italik yazı,
// yazı ve dolgu renkleri ile hizalama korunur; sayılar ve tarihler Türkçe biçimde yazılır. Yalnız kullanılan alan okunur.

export type ViewCell = {
  text: string;
  colSpan?: number;
  rowSpan?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  bg?: string;
  num?: boolean;
};
// null = birleştirilmiş bir hücrenin içinde kalan (çizilmeyen) hücre.
export type ViewRow = { n: number; cells: (ViewCell | null)[] };
export type ViewSheet = { name: string; cols: { letter: string; width: number }[]; rows: ViewRow[]; moreRows: number };

const MAX_COLS = 40;

type XCell = {
  value: unknown;
  numFmt?: string;
  font?: { bold?: boolean; italic?: boolean; color?: { argb?: string } };
  fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } };
  alignment?: { horizontal?: string };
};

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a.trim());
  return m ? { c: colNumber(m[1]), r: Number(m[2]) } : null;
}

// "FF1F4E79" → "#1F4E79" (beyaz / siyah varsayılanlar ve tema renkleri atlanır).
function cssColor(argb: string | undefined, skip: string[]): string | undefined {
  if (!argb || !/^[0-9A-F]{8}$/i.test(argb)) return undefined;
  const hex = `#${argb.slice(2).toUpperCase()}`;
  return skip.includes(hex) ? undefined : hex;
}

function rawValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown; hyperlink?: string };
  if (o.error) return String(o.error);
  if (o.result !== undefined) return rawValue(o.result);
  if (o.richText) return o.richText.map((t) => t.text).join("");
  if (o.text !== undefined) return rawValue(o.text);
  return null;
}

function formatValue(v: unknown, numFmt: string | undefined): { text: string; num: boolean } {
  if (v === null || v === undefined) return { text: "", num: false };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { text: "", num: false };
    const d = `${String(v.getUTCDate()).padStart(2, "0")}.${String(v.getUTCMonth() + 1).padStart(2, "0")}.${v.getUTCFullYear()}`;
    return { text: d, num: true };
  }
  if (typeof v === "number") {
    const fmt = numFmt ?? "";
    if (fmt.includes("%")) return { text: `%${(v * 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`, num: true };
    const decimals = /0\.(0+)/.exec(fmt)?.[1].length;
    const text = decimals != null
      ? v.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : v.toLocaleString("tr-TR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 });
    return { text, num: true };
  }
  if (typeof v === "boolean") return { text: v ? "DOĞRU" : "YANLIŞ", num: false };
  return { text: String(v), num: false };
}

export async function readWorkbookView(file: File, maxRows = 500): Promise<ViewSheet[]> {
  const { newWorkbook } = await import("./excel");
  const workbook = await newWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheets: ViewSheet[] = [];
  for (const ws of workbook.worksheets) {
    if (ws.state !== "visible") continue;
    // Kullanılan alan: değeri olan son satır ve sütun (birleştirmeler dahil).
    let lastRow = 0;
    let lastCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = rawValue((cell as unknown as XCell).value);
        if (v !== null && String(v).trim() !== "") {
          lastRow = Math.max(lastRow, r);
          lastCol = Math.max(lastCol, c);
        }
      });
    });
    // Birleştirmeler: sol üst hücre → kapladığı alan; içindeki öteki hücreler çizilmez.
    const masters = new Map<string, { bottom: number; right: number }>();
    const covered = new Set<string>();
    const mergeList = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []) as string[];
    for (const range of mergeList) {
      const [a, b] = range.split(":");
      const tl = parseAddr(a ?? "");
      const br = parseAddr(b ?? a ?? "");
      if (!tl || !br) continue;
      if (tl.r > lastRow || tl.c > lastCol) continue;
      masters.set(`${tl.r}:${tl.c}`, { bottom: br.r, right: br.c });
      for (let r = tl.r; r <= br.r; r++) for (let c = tl.c; c <= br.c; c++) if (r !== tl.r || c !== tl.c) covered.add(`${r}:${c}`);
    }
    const colCount = Math.min(lastCol, MAX_COLS);
    const visibleCols: number[] = [];
    for (let c = 1; c <= colCount; c++) if (!ws.getColumn(c).hidden) visibleCols.push(c);
    const cols = visibleCols.map((c) => {
      const w = ws.getColumn(c).width;
      return { letter: colLetter(c), width: Math.max(36, Math.min(420, Math.round((w ?? 9) * 7 + 12))) };
    });
    const rows: ViewRow[] = [];
    let visibleRowCount = 0;
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      if (row.hidden) continue;
      visibleRowCount++;
      if (rows.length >= maxRows) continue;
      const cells: (ViewCell | null)[] = [];
      for (const c of visibleCols) {
        const key = `${r}:${c}`;
        if (covered.has(key)) {
          cells.push(null);
          continue;
        }
        const cell = row.getCell(c) as unknown as XCell;
        const { text, num } = formatValue(rawValue(cell.value), cell.numFmt);
        const out: ViewCell = { text, num };
        const merge = masters.get(key);
        if (merge) {
          const span = visibleCols.filter((x) => x >= c && x <= merge.right).length;
          if (span > 1) out.colSpan = span;
          let rs = 0;
          for (let rr = r; rr <= Math.min(merge.bottom, lastRow); rr++) if (!ws.getRow(rr).hidden) rs++;
          if (rs > 1) out.rowSpan = rs;
        }
        if (cell.font?.bold) out.bold = true;
        if (cell.font?.italic) out.italic = true;
        const color = cssColor(cell.font?.color?.argb, ["#000000"]);
        if (color) out.color = color;
        if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid") {
          const bg = cssColor(cell.fill.fgColor?.argb, ["#FFFFFF"]);
          if (bg) out.bg = bg;
        }
        const h = cell.alignment?.horizontal;
        if (h === "center" || h === "centerContinuous") out.align = "center";
        else if (h === "right") out.align = "right";
        else if (h === "left") out.align = "left";
        cells.push(out);
      }
      rows.push({ n: r, cells });
    }
    sheets.push({ name: ws.name, cols, rows, moreRows: Math.max(0, visibleRowCount - rows.length) });
  }
  return sheets;
}
