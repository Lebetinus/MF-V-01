"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { tx } from "../../lib/i18n";
import { loadRecordAttachment, openAttachment, openRecordAttachment } from "../../lib/attachments";
import { notify } from "../../lib/notify";
import type { ViewSheet } from "../../lib/excelView";
import type { Language, RecordAttachment } from "../../lib/types";

// Belgeler hücresi: üzerine gelince belge özeti tablo kutusunun dışında (portal) görünür; böylece kaydırma alanında kesilmez.
// Belge adını kısaltır, uzantıyı korur: "çok-uzun-belge-adı.pdf" → "çok-uzun-be….pdf"
export function shortDocName(name: string, max = 14): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  return `${name.slice(0, Math.max(4, max - ext.length - 1))}…${ext}`;
}

export function DocCell({ language, recordId, docs, tableRows, onOpenDetail }: { language: Language; recordId: number; docs: RecordAttachment[]; tableRows: number; onOpenDetail: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [excelView, setExcelView] = useState<{ name: string; data: string } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  // Fare balona geçebilsin diye kapanma kısa süre geciktirilir.
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setPos(null), 180);
  };
  const show = (el: HTMLElement) => {
    cancelHide();
    const rect = el.getBoundingClientRect();
    setPos({ x: Math.min(rect.left, window.innerWidth - 340), y: rect.bottom + 2 });
  };
  // Excel: tablo olarak açılır; PDF/resim yeni sekmede, diğerleri indirilir.
  // Liste ekin içeriğini taşımaz: tıklanınca önce tek istekle indirilir (bkz. lib/attachments).
  async function openDoc(doc: RecordAttachment, index: number) {
    setPos(null);
    try {
      if (/\.(xlsx|xlsm)$/i.test(doc.name)) {
        setExcelView(await loadRecordAttachment(recordId, doc, index));
        return;
      }
      await openRecordAttachment(recordId, doc, index);
    } catch {
      notify(tx(language, "Belge açılamadı. Lütfen tekrar deneyin.", "The document could not be opened. Please try again.", "Belge nehat vekirin. Ji kerema xwe dîsa biceribîne."));
    }
  }
  // Belge çipine tıklayınca belgenin kendisi açılır (tek belge); birden çok belgede açılacak belge listesi gösterilir.
  // Tıklama satıra geçmez (satır tıklaması düzenleme / görünüm açar).
  const clickChip = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (docs.length === 1) void openDoc(docs[0], 0);
    else show(e.currentTarget);
  };
  return (
    <>
    <span className="docCell" onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={scheduleHide}>
      {docs.length > 0 && (
        <button type="button" className="docChip" title={docs.length === 1 ? tx(language, "Belgeyi aç", "Open the document", "Belgeyê veke") : undefined} onFocus={(e) => show(e.currentTarget)} onClick={clickChip}>
          📎 {shortDocName(docs[0].name)}
          {docs.length > 1 && <b className="docMore"> +{docs.length - 1}</b>}
        </button>
      )}
      {tableRows > 0 && (
        <button type="button" className="docChip docChipDetail" onFocus={(e) => show(e.currentTarget)} onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}>
          ▦ {tx(language, "Detay", "Details", "Hûrguliyan")} · {tableRows}
        </button>
      )}
      {pos &&
        createPortal(
          <span className="docTooltip" style={{ position: "fixed", left: pos.x, top: pos.y, display: "block" }} onMouseEnter={cancelHide} onMouseLeave={scheduleHide}>
            <b>{tx(language, "Belgeler", "Documents", "Belge")}</b>
            <ul>
              {docs.map((d, i) => (
                <li key={`${d.name}-${i}`}>
                  <button type="button" className="docItem" title={tx(language, "Açmak için tıklayın", "Click to open", "Ji bo vekirinê bitikîne")} onClick={() => void openDoc(d, i)}>
                    📄 {d.name}
                    <small> · {Math.max(1, Math.round((d.size ?? (d.data.length * 3) / 4) / 1024))} KB</small>
                  </button>
                </li>
              ))}
              {tableRows > 0 && (
                <li>
                  <button type="button" className="docItem" onClick={() => { setPos(null); onOpenDetail(); }}>
                    ▦ {tx(language, "Detay tablosu", "Detail table", "Tabloya hûrguliyan")} · {tableRows} {tx(language, "satır", "rows", "rêz")}
                  </button>
                </li>
              )}
            </ul>
          </span>,
          document.body,
        )}
    </span>
    {excelView && createPortal(<ExcelAttachmentModal language={language} attachment={excelView} onClose={() => setExcelView(null)} />, document.body)}
    </>
  );
}

// Eklenen Excel belgesinin içeriğini (sayfa sayfa) Excel'e benzer bir tabloda gösterir: birleştirilmiş hücreler tek hücre,
// sütun genişlikleri, kalın yazı, renkler ve hizalama korunur; satır numaraları ve sütun harfleri görünür (bkz.
// app/lib/excelView.ts). "İndir" belgenin kendisini indirir.
export function ExcelAttachmentModal({ language, attachment, onClose }: { language: Language; attachment: { name: string; data: string }; onClose: () => void }) {
  const [sheets, setSheets] = useState<ViewSheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await (await fetch(attachment.data)).blob();
        const { readWorkbookView } = await import("../../lib/excelView");
        const data = await readWorkbookView(new File([blob], attachment.name));
        if (!cancelled) setSheets(data);
      } catch {
        if (!cancelled) setError(tx(language, "Excel dosyası okunamadı.", "The Excel file could not be read.", "Pelê Excelê nehat xwendin."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, language]);
  const sheet = sheets?.[active];
  return (
    <div className="overlay">
      <div className="modal excelViewModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>▦ {attachment.name}</h2>
            <p>{tx(language, "Excel belgesinin önizlemesi. Asıl dosya için “İndir”.", "Preview of the Excel file. Use “Download” for the file itself.", "Pêşdîtina pelê Excelê.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        {!sheets && !error && <small>{tx(language, "Yükleniyor…", "Loading…", "Tê barkirin…")}</small>}
        {error && <small className="formWarning">{error}</small>}
        {sheets && sheets.length > 1 && (
          <div className="excelSheetTabs">
            {sheets.map((s, i) => (
              <button key={`${s.name}-${i}`} type="button" className={i === active ? "active" : ""} onClick={() => setActive(i)}>{s.name}</button>
            ))}
          </div>
        )}
        {sheets && !sheet && <small>{tx(language, "Bu belgede görünür sayfa yok.", "This file has no visible sheet.", "Rûpelek xuya tune.")}</small>}
        {sheet && (
          <div className="excelViewScroll">
            {sheet.rows.length === 0 ? (
              <small className="excelEmpty">{tx(language, "Bu sayfa boş.", "This sheet is empty.", "Ev rûpel vala ye.")}</small>
            ) : (
              <table className="excelGrid">
                <colgroup>
                  <col style={{ width: 38 }} />
                  {sheet.cols.map((c) => <col key={c.letter} style={{ width: c.width }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th className="excelCorner" />
                    {sheet.cols.map((c) => <th key={c.letter}>{c.letter}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => (
                    <tr key={row.n}>
                      <th className="excelRowNo">{row.n}</th>
                      {row.cells.map((cell, ci) => cell === null ? null : (
                        <td
                          key={ci}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan}
                          title={cell.text.length > 30 ? cell.text : undefined}
                          className={cell.num ? "num" : undefined}
                          style={{
                            fontWeight: cell.bold ? 700 : undefined,
                            fontStyle: cell.italic ? "italic" : undefined,
                            color: cell.color,
                            background: cell.bg,
                            textAlign: cell.align ?? (cell.num ? "right" : undefined),
                          }}
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sheet.moreRows > 0 && <small className="excelMore">… {sheet.moreRows} {tx(language, "satır daha (tamamı için dosyayı indirin)", "more rows (download the file for all)", "rêzên din")}</small>}
          </div>
        )}
        <div className="modalActions">
          <button type="button" className="light" onClick={() => openAttachment(attachment, { forceDownload: true })}>⇩ {tx(language, "İndir", "Download", "Daxe")}</button>
          <button type="button" className="light" onClick={onClose}>{tx(language, "Kapat", "Close", "Bigire")}</button>
        </div>
      </div>
    </div>
  );
}
