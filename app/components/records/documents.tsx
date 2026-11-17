"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tx } from "../../lib/i18n";
import { loadRecordAttachment, openRecordAttachment } from "../../lib/attachments";
import type { Language, RecordAttachment } from "../../lib/types";

// Belgeler hücresi: üzerine gelince belge özeti tablo kutusunun dışında (portal) görünür; böylece kaydırma alanında kesilmez.
// Belge adını kısaltır, uzantıyı korur: "çok-uzun-belge-adı.pdf" → "çok-uzun-be….pdf"
export function shortDocName(name: string, max = 14): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  return `${name.slice(0, Math.max(4, max - ext.length - 1))}…${ext}`;
}

export function DocCell({ language, recordId, docs, tableRows, onOpen, onOpenDetail }: { language: Language; recordId: number; docs: RecordAttachment[]; tableRows: number; onOpen: () => void; onOpenDetail: () => void }) {
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
      onOpen();
    }
  }
  return (
    <>
    <span className="docCell" onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={scheduleHide}>
      {docs.length > 0 && (
        <button type="button" className="docChip" onFocus={(e) => show(e.currentTarget)} onClick={onOpen}>
          📎 {shortDocName(docs[0].name)}
          {docs.length > 1 && <b className="docMore"> +{docs.length - 1}</b>}
        </button>
      )}
      {tableRows > 0 && (
        <button type="button" className="docChip docChipDetail" onFocus={(e) => show(e.currentTarget)} onClick={onOpenDetail}>
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

// Eklenen Excel belgesinin içeriğini (sayfa sayfa) tablo olarak gösterir.
export function ExcelAttachmentModal({ language, attachment, onClose }: { language: Language; attachment: { name: string; data: string }; onClose: () => void }) {
  const [sheets, setSheets] = useState<{ name: string; rows: (string | number | Date | null)[][] }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await (await fetch(attachment.data)).blob();
        const { readWorkbook } = await import("../../lib/excelImport");
        const data = await readWorkbook(new File([blob], attachment.name));
        if (!cancelled) setSheets(data.filter((s) => !s.hidden).map((s) => ({ name: s.name, rows: s.rows.filter(Boolean) })));
      } catch {
        if (!cancelled) setError(tx(language, "Excel dosyası okunamadı.", "The Excel file could not be read.", "Pelê Excelê nehat xwendin."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, language]);
  const sheet = sheets?.[active];
  const fmt = (v: string | number | Date | null) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null ? "" : typeof v === "number" ? v.toLocaleString("tr-TR") : String(v));
  const cols = sheet ? Math.min(40, Math.max(0, ...sheet.rows.map((row) => row.length))) : 0;
  return (
    <div className="overlay">
      <div className="modal excelViewModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>▦ {tx(language, "Excel Detayı", "Excel Detail", "Hûrguliyên Excelê")}</h2>
            <p>{attachment.name}</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {!sheets && !error && <small>{tx(language, "Yükleniyor…", "Loading…", "Tê barkirin…")}</small>}
        {error && <small className="formWarning">{error}</small>}
        {sheets && sheets.length > 1 && (
          <div className="excelSheetTabs">
            {sheets.map((s, i) => (
              <button key={s.name} type="button" className={i === active ? "active" : ""} onClick={() => setActive(i)}>{s.name}</button>
            ))}
          </div>
        )}
        {sheet && (
          <div className="excelViewScroll">
            <table>
              <tbody>
                {sheet.rows.slice(0, 500).map((row, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: cols }, (_, ci) => (
                      <td key={ci}>{fmt(row[ci] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.rows.length > 500 && <small>… {sheet.rows.length - 500} {tx(language, "satır daha", "more rows", "rêzên din")}</small>}
          </div>
        )}
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Kapat", "Close", "Bigire")}</button>
        </div>
      </div>
    </div>
  );
}
