"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { tx } from "../lib/i18n";
import { cellName, colName, createSheetEvaluator, formatSheetValue, isSheetError, padSheet, shiftFormulaRefs } from "../lib/sheet";
import type { Language, NoteSheet } from "../lib/types";

const MAX_ROWS = 500;
const MAX_COLS = 52;
const DEFAULT_WIDTH = 110;
const UNDO_LIMIT = 60;

type Pos = { r: number; c: number };
type Editing = { r: number; c: number; value: string; viaBar?: boolean };

const localeOf = (language: Language) => (language === "en" ? "en-US" : "tr-TR");

// Excel / Google Sheets tarzı tablo düzenleyici (Mali Notlar). Ham hücre girişleri `sheet.data`'da tutulur;
// "=" ile başlayan hücreler lib/sheet'teki motorla hesaplanır.
// Klavye: oklar (Shift ile seçim), Enter/F2 düzenle, Tab sağa, Delete temizle, Ctrl+C/X/V, Ctrl+Z/Y.
export function NoteSheetEditor({ language, sheet, onChange, readOnly = false }: { language: Language; sheet: NoteSheet; onChange?: (next: NoteSheet) => void; readOnly?: boolean }) {
  const data = useMemo(() => padSheet(sheet), [sheet]);
  const { rows, cols } = sheet;
  const widths = Array.from({ length: cols }, (_, c) => sheet.colWidths?.[c] ?? DEFAULT_WIDTH);
  const evaluate = useMemo(() => createSheetEvaluator(data, rows, cols), [data, rows, cols]);
  const locale = localeOf(language);
  // Salt okuma (not paneli): yalnız dolu bölge gösterilir; hesap yine tüm tablo üzerinden yapılır.
  const viewRows = readOnly ? Math.max(1, sheet.data.length) : rows;
  const viewCols = readOnly ? Math.max(1, ...sheet.data.map((r) => r.length)) : cols;
  const shown = readOnly ? data.slice(0, viewRows).map((row) => row.slice(0, viewCols)) : data;

  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Düzenleme durumu bir ref'te de tutulur: blur + tıklama aynı anda bitirince değer iki kez yazılmasın.
  const editingNow = useRef<Editing | null>(null);
  const setEditing = (v: Editing | null) => { editingNow.current = v; setEditingState(v); };
  const wrapRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const undo = useRef<NoteSheet[]>([]);
  const redo = useRef<NoteSheet[]>([]);

  const top = Math.min(sel.r, anchor.r), bottom = Math.max(sel.r, anchor.r);
  const left = Math.min(sel.c, anchor.c), right = Math.max(sel.c, anchor.c);
  const inRange = (r: number, c: number) => r >= top && r <= bottom && c >= left && c <= right;

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  useEffect(() => {
    const input = editRef.current;
    if (!editing || editing.viaBar || !input || document.activeElement === input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);
  // Seçili hücre görünür alanda kalsın.
  useEffect(() => {
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${sel.r}:${sel.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  function commit(next: NoteSheet) {
    if (!onChange) return;
    undo.current = [...undo.current.slice(-UNDO_LIMIT + 1), sheet];
    redo.current = [];
    onChange(next);
  }
  function writeCells(updates: { r: number; c: number; v: string }[], grow?: { rows: number; cols: number }) {
    const nRows = Math.min(MAX_ROWS, Math.max(rows, grow?.rows ?? 0));
    const nCols = Math.min(MAX_COLS, Math.max(cols, grow?.cols ?? 0));
    const next = Array.from({ length: nRows }, (_, r) => Array.from({ length: nCols }, (_, c) => data[r]?.[c] ?? ""));
    let changed = nRows !== rows || nCols !== cols;
    for (const u of updates) {
      if (u.r >= nRows || u.c >= nCols) continue;
      if (next[u.r][u.c] !== u.v) { next[u.r][u.c] = u.v; changed = true; }
    }
    if (changed) commit({ ...sheet, rows: nRows, cols: nCols, data: next });
  }
  const focusGrid = () => wrapRef.current?.focus({ preventScroll: true });

  function move(dr: number, dc: number, extend = false) {
    const r = Math.max(0, Math.min(rows - 1, sel.r + dr));
    const c = Math.max(0, Math.min(cols - 1, sel.c + dc));
    setSel({ r, c });
    if (!extend) setAnchor({ r, c });
  }
  function startEdit(initial?: string) {
    if (readOnly) return;
    setEditing({ r: sel.r, c: sel.c, value: initial ?? data[sel.r][sel.c] });
  }
  function finishEdit(save: boolean, then?: Pos) {
    const current = editingNow.current;
    if (!current) return;
    if (save) writeCells([{ r: current.r, c: current.c, v: current.value }]);
    setEditing(null);
    if (then) {
      const r = Math.max(0, Math.min(rows - 1, then.r));
      const c = Math.max(0, Math.min(cols - 1, then.c));
      setSel({ r, c });
      setAnchor({ r, c });
    }
    focusGrid();
  }
  function clearRange() {
    const ups: { r: number; c: number; v: string }[] = [];
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) ups.push({ r, c, v: "" });
    writeCells(ups);
  }
  function rangeTsv() {
    const lines: string[] = [];
    for (let r = top; r <= bottom; r++) lines.push(data[r].slice(left, right + 1).join("\t"));
    return lines.join("\n");
  }
  function undoStep(redoing = false) {
    const from = redoing ? redo : undo;
    const to = redoing ? undo : redo;
    const prev = from.current.pop();
    if (!prev || !onChange) return;
    to.current.push(sheet);
    onChange(prev);
    setSel((s) => ({ r: Math.min(s.r, prev.rows - 1), c: Math.min(s.c, prev.cols - 1) }));
    setAnchor((s) => ({ r: Math.min(s.r, prev.rows - 1), c: Math.min(s.c, prev.cols - 1) }));
  }

  function onGridKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const far = mod ? 10_000 : 1;
      move(k === "ArrowUp" ? -far : k === "ArrowDown" ? far : 0, k === "ArrowLeft" ? -far : k === "ArrowRight" ? far : 0, e.shiftKey);
      return;
    }
    if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === "Home") { e.preventDefault(); move(0, -10_000, e.shiftKey); return; }
    if (k === "End") { e.preventDefault(); move(0, 10_000, e.shiftKey); return; }
    if (mod && (k === "a" || k === "A")) { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: rows - 1, c: cols - 1 }); return; }
    if (mod && (k === "c" || k === "C" || k === "x" || k === "X")) {
      e.preventDefault();
      navigator.clipboard?.writeText(rangeTsv()).catch(() => {});
      if ((k === "x" || k === "X") && !readOnly) clearRange();
      return;
    }
    if (readOnly) return;
    if (mod && (k === "z" || k === "Z")) { e.preventDefault(); undoStep(e.shiftKey); return; }
    if (mod && (k === "y" || k === "Y")) { e.preventDefault(); undoStep(true); return; }
    if (k === "Enter" || k === "F2") { e.preventDefault(); startEdit(); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearRange(); return; }
    if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(k); }
  }
  function onPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    if (readOnly || editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    // Excel / Google Sheets'ten kopyalanan blok: satırlar \n, hücreler \t ile ayrılır.
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const ups: { r: number; c: number; v: string }[] = [];
    let maxC = 0;
    lines.forEach((line, i) => line.forEach((v, j) => { ups.push({ r: sel.r + i, c: sel.c + j, v: v.trim() }); maxC = Math.max(maxC, j); }));
    writeCells(ups, { rows: sel.r + lines.length, cols: sel.c + maxC + 1 });
    setAnchor(sel);
    setSel({ r: Math.min(MAX_ROWS, sel.r + lines.length) - 1, c: Math.min(MAX_COLS, sel.c + maxC + 1) - 1 });
  }
  function onEditKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!editing) return;
    if (e.key === "Enter") { e.preventDefault(); finishEdit(true, { r: editing.r + (e.shiftKey ? -1 : 1), c: editing.c }); }
    else if (e.key === "Tab") { e.preventDefault(); finishEdit(true, { r: editing.r, c: editing.c + (e.shiftKey ? -1 : 1) }); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishEdit(false); }
  }

  function cellDown(e: ReactMouseEvent, r: number, c: number) {
    if (e.button !== 0) return;
    if (editing) {
      // Formül yazarken başka hücreye tıklamak o hücrenin adını formüle ekler (Excel gibi).
      if (editing.value.startsWith("=") && /[=+\-*/^(;,:]$/.test(editing.value) && (editing.r !== r || editing.c !== c)) {
        e.preventDefault();
        setEditing({ ...editing, value: editing.value + cellName(r, c) });
        return;
      }
      finishEdit(true);
    }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey) setSel({ r, c });
    else { setSel({ r, c }); setAnchor({ r, c }); }
    dragging.current = true;
  }
  function cellEnter(e: ReactMouseEvent, r: number, c: number) {
    // Yalnız sol tuş basılıyken sürükleme seçimi genişler (tuş pencere dışında bırakıldıysa durur).
    if (!dragging.current) return;
    if (!(e.buttons & 1)) { dragging.current = false; return; }
    setSel({ r, c });
  }
  function selectCol(c: number) { setAnchor({ r: 0, c }); setSel({ r: rows - 1, c }); focusGrid(); }
  function selectRow(r: number) { setAnchor({ r, c: 0 }); setSel({ r, c: cols - 1 }); focusGrid(); }

  // Satır/sütun ekleme ve silme; formüllerdeki başvurular kaydırılır.
  function structural(axis: "row" | "col", at: number, delta: 1 | -1) {
    if (axis === "row" && (delta > 0 ? rows >= MAX_ROWS : rows <= 1)) return;
    if (axis === "col" && (delta > 0 ? cols >= MAX_COLS : cols <= 1)) return;
    const shifted = data.map((row) => row.map((v) => shiftFormulaRefs(v, axis, at, delta)));
    let next: string[][];
    let colWidths = sheet.colWidths ? [...widths] : undefined;
    if (axis === "row") {
      next = delta > 0 ? [...shifted.slice(0, at), Array(cols).fill(""), ...shifted.slice(at)] : shifted.filter((_, i) => i !== at);
    } else {
      next = shifted.map((row) => (delta > 0 ? [...row.slice(0, at), "", ...row.slice(at)] : row.filter((_, i) => i !== at)));
      if (colWidths) colWidths = delta > 0 ? [...colWidths.slice(0, at), DEFAULT_WIDTH, ...colWidths.slice(at)] : colWidths.filter((_, i) => i !== at);
    }
    commit({ rows: rows + (axis === "row" ? delta : 0), cols: cols + (axis === "col" ? delta : 0), data: next, ...(colWidths ? { colWidths } : {}) });
    const p = { r: Math.min(sel.r, rows - 1 + (axis === "row" ? delta : 0)), c: Math.min(sel.c, cols - 1 + (axis === "col" ? delta : 0)) };
    setSel(p);
    setAnchor(p);
    focusGrid();
  }

  // Sütun genişliği: başlığın sağ kenarından sürüklenir.
  function startResize(e: ReactMouseEvent, c: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[c];
    const base = sheet;
    let last = startW;
    const onMove = (ev: MouseEvent) => {
      last = Math.max(40, Math.min(800, Math.round(startW + ev.clientX - startX)));
      const th = wrapRef.current?.querySelector<HTMLElement>(`col[data-col="${c}"]`);
      if (th) th.style.width = `${last}px`;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (last !== startW && onChange) {
        const colWidths = Array.from({ length: base.cols }, (_, i) => (i === c ? last : base.colWidths?.[i] ?? DEFAULT_WIDTH));
        commit({ ...base, colWidths });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Seçim özeti (Google Sheets'teki alt çubuk gibi): birden fazla hücre seçiliyken toplam / ortalama / sayı.
  const stats = useMemo(() => {
    if (top === bottom && left === right) return null;
    const nums: number[] = [];
    let filled = 0;
    for (let r = top; r <= bottom; r++)
      for (let c = left; c <= right; c++) {
        const v = evaluate(r, c);
        if (v !== "") filled += 1;
        if (typeof v === "number") nums.push(v);
      }
    if (!filled) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return { sum, avg: nums.length ? sum / nums.length : 0, count: nums.length, filled };
  }, [top, bottom, left, right, evaluate]);
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });

  const selRaw = data[sel.r]?.[sel.c] ?? "";
  const barValue = editing && editing.r === sel.r && editing.c === sel.c ? editing.value : selRaw;

  return (
    <div className={`nsSheet${readOnly ? " nsReadOnly" : ""}`}>
      {!readOnly && (
        <div className="nsToolbar">
          <div className="nsBar">
            <span className="nsName">{top === bottom && left === right ? cellName(sel.r, sel.c) : `${cellName(top, left)}:${cellName(bottom, right)}`}</span>
            <i>ƒx</i>
            <input
              value={barValue}
              aria-label={tx(language, "Hücre içeriği", "Cell content", "Naveroka şaneyê")}
              placeholder={tx(language, "Değer veya formül yazın (örn. =TOPLA(B2:B10))", "Type a value or formula (e.g. =SUM(B2:B10))", "Nirx an formulê binivîse (mînak =TOPLA(B2:B10))")}
              onFocus={() => setEditing({ r: sel.r, c: sel.c, value: selRaw, viaBar: true })}
              onChange={(e) => setEditing({ r: sel.r, c: sel.c, value: e.target.value, viaBar: true })}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); finishEdit(true, { r: sel.r + 1, c: sel.c }); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishEdit(false); }
                else if (e.key === "Tab") { e.preventDefault(); finishEdit(true, { r: sel.r, c: sel.c + 1 }); }
              }}
              onBlur={() => { if (editingNow.current?.viaBar) finishEdit(true); }}
            />
          </div>
          <div className="nsActions">
            <button type="button" className="light compact" onClick={() => structural("row", sel.r, 1)} title={tx(language, "Seçili satırın üstüne satır ekle", "Insert a row above", "Rêzek li jor zêde bike")}>＋ {tx(language, "Satır", "Row", "Rêz")}</button>
            <button type="button" className="light compact" onClick={() => structural("row", sel.r, -1)} disabled={rows <= 1} title={tx(language, "Seçili satırı sil", "Delete the selected row", "Rêza bijartî jê bibe")}>− {tx(language, "Satır", "Row", "Rêz")}</button>
            <button type="button" className="light compact" onClick={() => structural("col", sel.c, 1)} title={tx(language, "Seçili sütunun soluna sütun ekle", "Insert a column to the left", "Stûnek li çep zêde bike")}>＋ {tx(language, "Sütun", "Column", "Stûn")}</button>
            <button type="button" className="light compact" onClick={() => structural("col", sel.c, -1)} disabled={cols <= 1} title={tx(language, "Seçili sütunu sil", "Delete the selected column", "Stûna bijartî jê bibe")}>− {tx(language, "Sütun", "Column", "Stûn")}</button>
            <button type="button" className="light compact" onClick={() => structural("row", rows, 1)} title={tx(language, "Sona 1 satır ekle", "Add a row at the end", "Rêzek li dawiyê zêde bike")}>＋ {tx(language, "Sona satır", "Row at end", "Rêz li dawiyê")}</button>
            <button type="button" className="light compact" onClick={() => structural("col", cols, 1)} title={tx(language, "Sona 1 sütun ekle", "Add a column at the end", "Stûnek li dawiyê zêde bike")}>＋ {tx(language, "Sona sütun", "Column at end", "Stûn li dawiyê")}</button>
          </div>
        </div>
      )}
      <div className="nsWrap" ref={wrapRef} tabIndex={0} onKeyDown={onGridKey} onPaste={onPaste} role="grid" aria-label={tx(language, "Tablo", "Sheet", "Tablo")} aria-rowcount={rows} aria-colcount={cols}>
        <table className="nsGrid">
          <colgroup>
            <col style={{ width: 42 }} />
            {widths.slice(0, viewCols).map((w, c) => <col key={c} data-col={c} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="nsCorner" onMouseDown={(e) => { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: rows - 1, c: cols - 1 }); focusGrid(); }} />
              {widths.slice(0, viewCols).map((_, c) => (
                <th key={c} className={c >= left && c <= right ? "nsHeadOn" : ""} onMouseDown={(e) => { e.preventDefault(); selectCol(c); }}>
                  {colName(c)}
                  {!readOnly && <span className="nsResize" onMouseDown={(e) => startResize(e, c)} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r}>
                <th className={r >= top && r <= bottom ? "nsHeadOn" : ""} onMouseDown={(e) => { e.preventDefault(); selectRow(r); }}>{r + 1}</th>
                {row.map((raw, c) => {
                  const isEdit = editing && !editing.viaBar && editing.r === r && editing.c === c;
                  const v = evaluate(r, c);
                  const cls = [
                    typeof v === "number" ? "nsNum" : "",
                    isSheetError(v) ? "nsErr" : "",
                    raw.startsWith("=") ? "nsFormula" : "",
                    inRange(r, c) ? "nsInRange" : "",
                    sel.r === r && sel.c === c ? "nsActive" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <td
                      key={c}
                      data-cell={`${r}:${c}`}
                      className={cls}
                      title={raw.startsWith("=") ? raw : undefined}
                      onMouseDown={(e) => cellDown(e, r, c)}
                      onMouseEnter={(e) => cellEnter(e, r, c)}
                      onDoubleClick={() => { setSel({ r, c }); setAnchor({ r, c }); if (!readOnly) setEditing({ r, c, value: raw }); }}
                    >
                      {isEdit ? (
                        <input
                          ref={editRef}
                          className="nsEdit"
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={onEditKey}
                          onBlur={() => finishEdit(true)}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        formatSheetValue(v, raw, locale)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nsStatus">
        {stats ? (
          <span>
            {tx(language, "Toplam", "Sum", "Kom")}: <b>{fmt(stats.sum)}</b> · {tx(language, "Ortalama", "Average", "Navîn")}: <b>{fmt(stats.avg)}</b> · {tx(language, "Sayı", "Count", "Hejmar")}: <b>{stats.count}</b>
          </span>
        ) : (
          <span>
            {viewRows} {tx(language, "satır", "rows", "rêz")} × {viewCols} {tx(language, "sütun", "columns", "stûn")}
            {!readOnly && ` · ${tx(language, "Formüller: =TOPLA(B2:B9), =ORTALAMA(…), =MIN, =MAKS, =SAY, =YUVARLA(x;2), + − * / % — Excel'den kopyala-yapıştır desteklenir", "Formulas: =SUM(B2:B9), =AVERAGE(…), =MIN, =MAX, =COUNT, =ROUND(x;2), + − * / % — paste from Excel works", "Formul: =TOPLA(B2:B9), =ORTALAMA(…), =MIN, =MAKS, =SAY, =YUVARLA(x;2), + − * / %")}`}
          </span>
        )}
      </div>
    </div>
  );
}

// Not kartında küçük önizleme: dolu bölgenin ilk birkaç satır/sütunu, hesaplanmış değerlerle.
export function NoteSheetPreview({ language, sheet, maxRows = 5, maxCols = 4 }: { language: Language; sheet: NoteSheet; maxRows?: number; maxCols?: number }) {
  const data = padSheet(sheet);
  const evaluate = createSheetEvaluator(data, sheet.rows, sheet.cols);
  const usedRows = sheet.data.length;
  const usedCols = Math.max(0, ...sheet.data.map((r) => r.length));
  const locale = localeOf(language);
  if (!usedRows || !usedCols) return <p className="nsMiniEmpty">▦ {tx(language, "Boş tablo", "Empty sheet", "Tabloya vala")}</p>;
  const rShow = Math.min(usedRows, maxRows);
  const cShow = Math.min(usedCols, maxCols);
  return (
    <div className="nsMini">
      <table>
        <tbody>
          {Array.from({ length: rShow }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cShow }, (_, c) => {
                const v = evaluate(r, c);
                return <td key={c} className={typeof v === "number" ? "nsNum" : isSheetError(v) ? "nsErr" : ""}>{formatSheetValue(v, data[r][c], locale)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(usedRows > rShow || usedCols > cShow) && <small>▦ {usedRows} × {usedCols}</small>}
    </div>
  );
}
