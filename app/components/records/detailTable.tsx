"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { downloadWorkbook, newWorkbook } from "../../lib/excel";
import { tx, localizeData } from "../../lib/i18n";
import { date, money } from "../../lib/finance";
import type { Language, RecordItem } from "../../lib/types";
import { notify } from "../../lib/notify";

// Gider detay tablosu sınırları — sunucudaki detailTableSchema ile aynı olmalı
// (app/api/_lib/validate.ts); istemci bunlara göre kırpar, böylece kayıt 400 ile
// reddedilmez.
export const DETAIL_MAX_ROWS = 500;
export const DETAIL_MAX_COLS = 50;
export const DETAIL_MAX_CELL = 500;

// Excel/Google Sheets'ten kopyalanan hücreler panoya sekmeyle ayrılmış
// (TSV) metin olarak gelir; hücre içinde sekme/satır sonu varsa değer
// çift tırnaklı yazılır. Boş satırlar ve sondaki boş hücreler atılır.
export function parseClipboardTable(text: string): string[][] {
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === TAB) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === LF || ch === CR) {
      if (ch === CR && text[i + 1] === LF) i++;
      row.push(cell.trim());
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell.trim());
  if (row.length) rows.push(row);
  return rows
    .map((r) => {
      const copy = [...r];
      while (copy.length && copy[copy.length - 1] === "") copy.pop();
      return copy;
    })
    .filter((r) => r.length > 0);
}

// Bir gider kaydının yapıştırılmış detay tablosunu salt-okunur, geniş bir
// pencerede gösterir. Seçenekler: Excel'e aktar, panoya kopyala (tekrar
// Excel/Sheets'e yapıştırılabilir), kapat.
export type DetailAlign = "left" | "center" | "right";
export type DetailVAlign = "top" | "middle" | "bottom";
export type DetailCellAlign = { h?: DetailAlign; v?: DetailVAlign };
export type DetailLayout = {
  cols: number[];
  rows: number[];
  colAlign?: DetailAlign[];
  // Tek hücreye özel hizalama ("satır:sütun" anahtarı) — sütun hizalamasından önceliklidir.
  cellAlign?: Record<string, DetailCellAlign>;
};
export function effectiveAlign(layout: DetailLayout | undefined, r: number, c: number): { h: DetailAlign; v: DetailVAlign } {
  const cell = layout?.cellAlign?.[`${r}:${c}`];
  return { h: cell?.h ?? layout?.colAlign?.[c] ?? "left", v: cell?.v ?? "top" };
}
// Satır/sütun ekleme-silmeden sonra hücre hizalama anahtarlarını yeniden eşler (null = hücre silindi).
export function remapCellAlign(
  cellAlign: DetailLayout["cellAlign"],
  map: (r: number, c: number) => [number, number] | null,
): Record<string, DetailCellAlign> {
  const out: Record<string, DetailCellAlign> = {};
  for (const [key, value] of Object.entries(cellAlign ?? {})) {
    const [r, c] = key.split(":").map(Number);
    const mapped = map(r, c);
    if (mapped) out[`${mapped[0]}:${mapped[1]}`] = value;
  }
  return out;
}
export const DETAIL_DEFAULT_COL = 140;
export const DETAIL_DEFAULT_ROW = 30;

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

// Hücre metnine göre yüksekliği otomatik ayarlanan textarea — kullanıcı satır
// yüksekliğini elle ayarlamadıysa (fixedHeight yok) uzun metin kırpılmaz,
// hücre içeriğin tamamını gösterecek kadar uzar.
export function AutoSizeTextarea({
  value,
  fixedHeight,
  width,
  align,
  valign,
  onChange,
  onPaste,
  onFocus,
}: {
  value: string;
  fixedHeight?: number;
  width: number;
  align?: DetailAlign;
  valign?: DetailVAlign;
  onChange: (value: string) => void;
  onPaste: (text: string) => boolean;
  onFocus?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Önce doğal (içerik) yüksekliği ölç; dikey hizalama için sabit yükseklik
    // doğal yükseklikten büyükse aradaki farkı üst boşluk olarak ekle.
    el.style.paddingTop = "";
    el.style.height = "auto";
    const natural = Math.max(DETAIL_DEFAULT_ROW, el.scrollHeight);
    const height = fixedHeight ?? natural;
    if (valign && valign !== "top" && height > natural) {
      const base = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const extra = (height - natural) * (valign === "middle" ? 0.5 : 1);
      el.style.paddingTop = `${base + extra}px`;
    }
    el.style.height = `${height}px`;
  }, [value, fixedHeight, width, valign]);
  return (
    <textarea
      ref={ref}
      value={value}
      style={align ? { textAlign: align } : undefined}
      maxLength={DETAIL_MAX_CELL}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        if (onPaste(e.clipboardData.getData("text/plain"))) e.preventDefault();
      }}
    />
  );
}

// Yapıştırılan gider detay tablosunu düzenleme editörü: hücreleri doğrudan
// düzenleme, satır/sütun ekleme-silme, sütun başlığının sağ kenarını / satır
// numarasının alt kenarını sürükleyerek genişlik-yükseklik ayarı. Bir hücreye
// Excel/Sheets'ten çok hücreli veri yapıştırılırsa o hücreden başlayarak
// yerleştirilir (tablo gerekirse büyür).
export function DetailTableEditor({
  language,
  table,
  layout,
  onChange,
}: {
  language: Language;
  table: string[][];
  layout: DetailLayout;
  onChange: (table: string[][], layout: DetailLayout) => void;
}) {
  const colCount = Math.max(0, ...table.map((r) => r.length));
  const rowCount = table.length;
  // Sürükleme sırasında (window olay dinleyicileri) en güncel değerlere ulaşmak için;
  // render sırasında değil, her çizimden sonra güncellenir.
  const latest = useRef({ table, layout, onChange });
  useLayoutEffect(() => {
    latest.current = { table, layout, onChange };
  });
  const colWidth = (i: number) => layout.cols[i] ?? DETAIL_DEFAULT_COL;
  const padded = () => table.map((r) => Array.from({ length: colCount }, (_, c) => r[c] ?? ""));
  function setCell(r: number, c: number, value: string) {
    const next = padded();
    next[r][c] = value;
    onChange(next, layout);
  }
  function pasteIntoCell(r: number, c: number, text: string): boolean {
    const parsed = parseClipboardTable(text);
    const isMulti = parsed.length > 1 || (parsed[0]?.length ?? 0) > 1;
    if (!isMulti) return false;
    const rows = Math.min(DETAIL_MAX_ROWS, Math.max(rowCount, r + parsed.length));
    const cols = Math.min(DETAIL_MAX_COLS, Math.max(colCount, c + Math.max(...parsed.map((p) => p.length))));
    const next = Array.from({ length: rows }, (_, ri) => Array.from({ length: cols }, (_, ci) => table[ri]?.[ci] ?? ""));
    parsed.forEach((prow, pr) =>
      prow.forEach((value, pc) => {
        if (r + pr < rows && c + pc < cols) next[r + pr][c + pc] = value.slice(0, DETAIL_MAX_CELL);
      }),
    );
    onChange(next, layout);
    return true;
  }
  function addRow() {
    if (rowCount >= DETAIL_MAX_ROWS) return;
    onChange([...padded(), Array.from({ length: Math.max(colCount, 1) }, () => "")], layout);
  }
  function addColumn() {
    if (colCount >= DETAIL_MAX_COLS) return;
    onChange(rowCount ? padded().map((r) => [...r, ""]) : [[""]], layout);
  }
  function removeRow(r: number) {
    onChange(table.filter((_, i) => i !== r), {
      ...layout,
      rows: layout.rows.filter((_, i) => i !== r),
      cellAlign: remapCellAlign(layout.cellAlign, (ri, ci) => (ri === r ? null : [ri > r ? ri - 1 : ri, ci])),
    });
  }
  function removeColumn(c: number) {
    const next = padded()
      .map((row) => row.filter((_, i) => i !== c))
      .filter((row) => row.length > 0);
    onChange(next, {
      ...layout,
      cols: layout.cols.filter((_, i) => i !== c),
      colAlign: (layout.colAlign ?? []).filter((_, i) => i !== c),
      cellAlign: remapCellAlign(layout.cellAlign, (ri, ci) => (ci === c ? null : [ri, ci > c ? ci - 1 : ci])),
    });
  }
  // Sütun hizalaması, o sütundaki hücrelere özel yatay hizalamaları sıfırlar.
  function setColumnAlign(c: number, align: DetailAlign) {
    const list: DetailAlign[] = [...(layout.colAlign ?? [])];
    while (list.length <= c) list.push("left");
    list[c] = align;
    const cellAlign = { ...(layout.cellAlign ?? {}) };
    for (const key of Object.keys(cellAlign)) {
      if (Number(key.split(":")[1]) === c) {
        const { h: _h, ...rest } = cellAlign[key];
        if (Object.keys(rest).length) cellAlign[key] = rest;
        else delete cellAlign[key];
      }
    }
    onChange(table, { ...layout, colAlign: list, cellAlign });
  }
  // Satırın tüm hücrelerine dikey hizalama.
  function setRowVAlign(r: number, v: DetailVAlign) {
    const cellAlign = { ...(layout.cellAlign ?? {}) };
    for (let c = 0; c < colCount; c++) cellAlign[`${r}:${c}`] = { ...cellAlign[`${r}:${c}`], v };
    onChange(table, { ...layout, cellAlign });
  }
  // Odaktaki tek hücre için yatay/dikey hizalama (araç çubuğu).
  const [focused, setFocused] = useState<{ r: number; c: number } | null>(null);
  function setCellAlign(patch: DetailCellAlign) {
    if (!focused) return;
    const key = `${focused.r}:${focused.c}`;
    onChange(table, { ...layout, cellAlign: { ...(layout.cellAlign ?? {}), [key]: { ...(layout.cellAlign?.[key] ?? {}), ...patch } } });
  }
  function insertRow(at: number) {
    if (rowCount >= DETAIL_MAX_ROWS) return;
    const next = padded();
    next.splice(at, 0, Array.from({ length: Math.max(colCount, 1) }, () => ""));
    const rows = [...layout.rows];
    if (rows.length > at) rows.splice(at, 0, DETAIL_DEFAULT_ROW);
    onChange(next, {
      ...layout,
      rows,
      cellAlign: remapCellAlign(layout.cellAlign, (ri, ci) => [ri >= at ? ri + 1 : ri, ci]),
    });
  }
  function insertColumn(at: number) {
    if (colCount >= DETAIL_MAX_COLS) return;
    const cols = [...layout.cols];
    if (cols.length > at) cols.splice(at, 0, DETAIL_DEFAULT_COL);
    const colAlign = [...(layout.colAlign ?? [])];
    if (colAlign.length > at) colAlign.splice(at, 0, "left");
    onChange(padded().map((row) => [...row.slice(0, at), "", ...row.slice(at)]), {
      ...layout,
      cols,
      colAlign,
      cellAlign: remapCellAlign(layout.cellAlign, (ri, ci) => [ri, ci >= at ? ci + 1 : ci]),
    });
  }
  // Satır/sütun silme ve ekleme: başlığa sağ tıklayınca açılan menüden —
  // tek tıkla yanlışlıkla veri silinmesin diye kenarlarda silme düğmesi yok.
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "row" | "col"; index: number } | null>(null);
  const menuHint = tx(language, "Seçenekler için sağ tıklayın", "Right-click for options", "Ji bo vebijarkan rast-bitikîne");
  function openMenu(kind: "row" | "col", index: number, event: ReactMouseEvent) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, kind, index });
  }
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  function startResize(kind: "col" | "row", index: number, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const origin = kind === "col" ? event.clientX : event.clientY;
    // Sürükleme, kenarın o an ekrandaki gerçek boyutundan başlar (otomatik
    // genişlikteki sütun/satırda ilk tıklamada zıplama olmasın).
    const rect = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const base = Math.round(kind === "col" ? rect.width : rect.height);
    const [min, max] = kind === "col" ? [50, 600] : [26, 300];
    function onMove(e: MouseEvent) {
      const size = Math.round(Math.min(max, Math.max(min, base + ((kind === "col" ? e.clientX : e.clientY) - origin))));
      const cur = latest.current;
      const list = [...(kind === "col" ? cur.layout.cols : cur.layout.rows)];
      const fallback = kind === "col" ? DETAIL_DEFAULT_COL : DETAIL_DEFAULT_ROW;
      while (list.length <= index) list.push(fallback);
      list[index] = size;
      cur.onChange(cur.table, kind === "col" ? { ...cur.layout, cols: list } : { ...cur.layout, rows: list });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("noSelectDragging");
    }
    document.body.classList.add("noSelectDragging");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  // Elle genişlik verilmemiş sütunlar kapsayıcıya eşit paylaşılır (tablo
  // yatay kaydırma gerektirmeden tamamen görünür); elle verilenler sabit kalır.
  const explicitWidth = Array.from({ length: colCount }, (_, i) => layout.cols[i] ?? 0).reduce((a, b) => a + b, 0);
  const autoCols = Array.from({ length: colCount }, (_, i) => layout.cols[i] === undefined).filter(Boolean).length;
  const minTableWidth = 40 + 36 + explicitWidth + autoCols * 60;
  return (
    <div className="detailEditor">
      {rowCount === 0 && (
        <div className="detailEditorBar">
          <button
            type="button"
            className="detailAddButton"
            onClick={addColumn}
            title={tx(language, "Tablo oluştur", "Create table", "Tabloyê çêbike")}
            aria-label={tx(language, "Tablo oluştur", "Create table", "Tabloyê çêbike")}
          >
            ＋
          </button>
        </div>
      )}
      {rowCount > 0 && (
        <div className="detailAlignBar" role="toolbar" aria-label={tx(language, "Hücre hizalama", "Cell alignment", "Rastkirina şaneyê")}>
          {(
            [
              ["h", "left", "⇤", tx(language, "Sola hizala", "Align left", "Li çepê rast bike")],
              ["h", "center", "⇔", tx(language, "Ortala", "Center", "Li navendê")],
              ["h", "right", "⇥", tx(language, "Sağa hizala", "Align right", "Li rastê rast bike")],
              ["v", "top", "⤒", tx(language, "Üste hizala", "Align top", "Li jor rast bike")],
              ["v", "middle", "⇕", tx(language, "Dikey ortala", "Center vertically", "Bi serdemî navend")],
              ["v", "bottom", "⤓", tx(language, "Alta hizala", "Align bottom", "Li jêr rast bike")],
            ] as ["h" | "v", string, string, string][]
          ).map(([axis, value, icon, label]) => {
            const current = focused ? effectiveAlign(layout, focused.r, focused.c) : null;
            const active = current ? (axis === "h" ? current.h : current.v) === value : false;
            return (
              <button
                key={`${axis}-${value}`}
                type="button"
                className={`detailAlignButton${active ? " active" : ""}`}
                disabled={!focused}
                title={focused ? label : `${label} — ${tx(language, "önce bir hücreye tıklayın", "click a cell first", "pêşî li şaneyekê bitikîne")}`}
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCellAlign(axis === "h" ? { h: value as DetailAlign } : { v: value as DetailVAlign })}
              >
                {icon}
              </button>
            );
          })}
        </div>
      )}
      {rowCount > 0 && (
        <div className="detailTableScroll detailEditScroll">
          <table className="detailTable detailTableEdit" style={{ width: "100%", minWidth: minTableWidth }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {Array.from({ length: colCount }, (_, c) => (
                <col key={c} style={layout.cols[c] !== undefined ? { width: layout.cols[c] } : undefined} />
              ))}
              <col style={{ width: 36 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="detailCorner" />
                {Array.from({ length: colCount }, (_, c) => (
                  <th key={c} className="detailColHead" title={menuHint} onContextMenu={(e) => openMenu("col", c, e)}>
                    <span>{columnLetter(c)}</span>
                    <i className="detailResizer detailColResizer" onMouseDown={(e) => startResize("col", c, e)} />
                  </th>
                ))}
                <th className="detailAddCell">
                  <button
                    type="button"
                    className="detailAddButton"
                    onClick={addColumn}
                    disabled={colCount >= DETAIL_MAX_COLS}
                    title={tx(language, "Sütun ekle", "Add column", "Stûn zêde bike")}
                    aria-label={tx(language, "Sütun ekle", "Add column", "Stûn zêde bike")}
                  >
                    ＋
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((row, r) => (
                <tr key={r} style={layout.rows[r] ? { height: layout.rows[r] } : undefined}>
                  <th className="detailRowHead" title={menuHint} onContextMenu={(e) => openMenu("row", r, e)}>
                    <span>{r + 1}</span>
                    <i className="detailResizer detailRowResizer" onMouseDown={(e) => startResize("row", r, e)} />
                  </th>
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c} className={r === 0 ? "detailEditHead" : undefined}>
                      <AutoSizeTextarea
                        value={row[c] ?? ""}
                        fixedHeight={layout.rows[r]}
                        width={colWidth(c)}
                        align={effectiveAlign(layout, r, c).h}
                        valign={effectiveAlign(layout, r, c).v}
                        onFocus={() => setFocused({ r, c })}
                        onChange={(value) => setCell(r, c, value)}
                        onPaste={(text) => pasteIntoCell(r, c, text)}
                      />
                    </td>
                  ))}
                  <td className="detailAddSpacer" />
                </tr>
              ))}
              <tr>
                <th className="detailAddCell">
                  <button
                    type="button"
                    className="detailAddButton"
                    onClick={addRow}
                    disabled={rowCount >= DETAIL_MAX_ROWS}
                    title={tx(language, "Satır ekle", "Add row", "Rêz zêde bike")}
                    aria-label={tx(language, "Satır ekle", "Add row", "Rêz zêde bike")}
                  >
                    ＋
                  </button>
                </th>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {menu &&
        createPortal(
          <div className="detailContextMenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
            {menu.kind === "col" ? (
              <>
                <button type="button" onClick={() => { insertColumn(menu.index); setMenu(null); }}>
                  {tx(language, "Soluna sütun ekle", "Insert column left", "Li çepê stûn zêde bike")}
                </button>
                <button type="button" onClick={() => { insertColumn(menu.index + 1); setMenu(null); }}>
                  {tx(language, "Sağına sütun ekle", "Insert column right", "Li rastê stûn zêde bike")}
                </button>
                {(["left", "center", "right"] as DetailAlign[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`detailAlignItem${(layout.colAlign?.[menu.index] ?? "left") === a ? " active" : ""}`}
                    onClick={() => { setColumnAlign(menu.index, a); setMenu(null); }}
                  >
                    {a === "left" ? "⇤ " : a === "center" ? "⇔ " : "⇥ "}
                    {a === "left"
                      ? tx(language, "Sola hizala", "Align left", "Li çepê rast bike")
                      : a === "center"
                        ? tx(language, "Ortala", "Center", "Li navendê")
                        : tx(language, "Sağa hizala", "Align right", "Li rastê rast bike")}
                  </button>
                ))}
                <button type="button" className="danger" onClick={() => { removeColumn(menu.index); setMenu(null); }}>
                  {tx(language, "Sütunu sil", "Delete column", "Stûnê jê bibe")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { insertRow(menu.index); setMenu(null); }}>
                  {tx(language, "Üstüne satır ekle", "Insert row above", "Li jorê rêz zêde bike")}
                </button>
                <button type="button" onClick={() => { insertRow(menu.index + 1); setMenu(null); }}>
                  {tx(language, "Altına satır ekle", "Insert row below", "Li jêrê rêz zêde bike")}
                </button>
                {(["top", "middle", "bottom"] as DetailVAlign[]).map((v) => (
                  <button key={v} type="button" className="detailAlignItem" onClick={() => { setRowVAlign(menu.index, v); setMenu(null); }}>
                    {v === "top" ? "⤒ " : v === "middle" ? "⇕ " : "⤓ "}
                    {v === "top"
                      ? tx(language, "Üste hizala", "Align top", "Li jor rast bike")
                      : v === "middle"
                        ? tx(language, "Dikey ortala", "Center vertically", "Bi serdemî navend")
                        : tx(language, "Alta hizala", "Align bottom", "Li jêr rast bike")}
                  </button>
                ))}
                <button type="button" className="danger" onClick={() => { removeRow(menu.index); setMenu(null); }}>
                  {tx(language, "Satırı sil", "Delete row", "Rêzê jê bibe")}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// Detay tablosunda "Birim fiyat" / "Tutar" sütunları kaydın para birimiyle gösterilir (USD, SYP, EUR...).
export const MONEY_HEADER = /birim fiyat|unit price|bihayê yekê|nirxê yekê|^tutar|^amount|^mîqdar \(|^fiyat|^price/i;
export function parseCellNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

export function DetailTableModal({ language, record, onClose }: { language: Language; record: RecordItem; onClose: () => void }) {
  const table = record.detailTable ?? [];
  const columnCount = Math.max(0, ...table.map((r) => r.length));
  const [copied, setCopied] = useState(false);
  // Pencereyi tam ekrana yakın boyuta büyüt / geri al; ayrıca sağ-alt köşeden sürüklenebilir.
  const [expanded, setExpanded] = useState(false);
  async function copyToClipboard() {
    const text = table.map((r) => r.join(String.fromCharCode(9))).join(String.fromCharCode(10));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify(tx(language, "Panoya kopyalanamadı.", "Could not copy to clipboard.", "Nehat kopîkirin."));
    }
  }
  async function exportToExcel() {
    const workbook = await newWorkbook();
    const sheet = workbook.addWorksheet("Detay");
    table.forEach((row, index) => {
      const added = sheet.addRow(Array.from({ length: columnCount }, (_, c) => row[c] ?? ""));
      if (index === 0) {
        added.font = { bold: true };
        added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDEEBB" } };
      }
    });
    sheet.columns.forEach((col, index) => {
      const px = record.detailTableLayout?.cols?.[index];
      col.width = px ? Math.max(8, Math.round(px / 7)) : 18;
    });
    table.forEach((row, rowIndex) => {
      for (let colIndex = 0; colIndex < columnCount; colIndex++) {
        const { h, v } = effectiveAlign(record.detailTableLayout, rowIndex, colIndex);
        sheet.getCell(rowIndex + 1, colIndex + 1).alignment = { horizontal: h, vertical: v, wrapText: true };
      }
    });
    record.detailTableLayout?.rows?.forEach((px, index) => {
      if (px) sheet.getRow(index + 1).height = Math.round(px * 0.75);
    });
    await downloadWorkbook(workbook, `${(record.source || "gider").replace(/[^\p{L}\p{N}_-]+/gu, "_")}-detay.xlsx`);
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal detailViewModal${expanded ? " detailViewExpanded" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{record.kind === "income" ? tx(language, "Gelir Detayları", "Income Details", "Hûrguliyên Dahatê") : tx(language, "Gider Detayları", "Expense Details", "Hûrguliyên Mesrefê")}</h2>
            <p>
              {localizeData(record.source, language)} · {date(record.date, language)} · {money(record.amount, record.currency)}
            </p>
          </div>
          <div className="detailViewHeadActions">
            <button
              type="button"
              className="detailViewExpand"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? tx(language, "Küçült", "Shrink", "Biçûk bike") : tx(language, "Pencereyi genişlet", "Expand window", "Pencereyê fireh bike")}
              aria-label={expanded ? tx(language, "Küçült", "Shrink", "Biçûk bike") : tx(language, "Pencereyi genişlet", "Expand window", "Pencereyê fireh bike")}
            >
              {expanded ? "⤡" : "⤢"}
            </button>
            <button type="button" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="detailViewActions">
          <span>
            {Math.max(0, table.length - 1)} {tx(language, "satır", "rows", "rêz")} · {columnCount} {tx(language, "sütun", "columns", "stûn")}
          </span>
          <button type="button" className="light compact" onClick={copyToClipboard}>
            {copied ? `✓ ${tx(language, "Kopyalandı", "Copied", "Hat kopîkirin")}` : `⧉ ${tx(language, "Panoya Kopyala", "Copy", "Kopî bike")}`}
          </button>
          <button type="button" className="light compact" onClick={exportToExcel}>
            ⇩ {tx(language, "Excel'e Aktar", "Export to Excel", "Biguhezîne Excel")}
          </button>
        </div>
        <div className="detailTableScroll detailViewScroll">
          <table className="detailTable">
            {(record.detailTableLayout?.cols?.length ?? 0) > 0 && (
              <colgroup>
                {Array.from({ length: columnCount }, (_, c) => (
                  <col key={c} style={{ width: record.detailTableLayout!.cols[c] ?? DETAIL_DEFAULT_COL }} />
                ))}
              </colgroup>
            )}
            <tbody>
              {table.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={rowIndex === 0 ? "detailTableHead" : undefined}
                  style={record.detailTableLayout?.rows?.[rowIndex] ? { height: record.detailTableLayout.rows[rowIndex] } : undefined}
                >
                  {Array.from({ length: columnCount }).map((_, colIndex) => (
                    <td
                      key={colIndex}
                      style={{
                        textAlign: effectiveAlign(record.detailTableLayout, rowIndex, colIndex).h,
                        verticalAlign: effectiveAlign(record.detailTableLayout, rowIndex, colIndex).v,
                      }}
                    >
                      {(() => {
                        const raw = row[colIndex] ?? "";
                        if (rowIndex > 0 && MONEY_HEADER.test((table[0]?.[colIndex] ?? "").trim())) {
                          const n = parseCellNumber(raw);
                          if (n !== null) return money(n, record.currency);
                        }
                        return localizeData(raw, language);
                      })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>
            {tx(language, "Kapat", "Close", "Bigire")}
          </button>
        </div>
      </div>
    </div>
  );
}
