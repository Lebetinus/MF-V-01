"use client";

import { useEffect } from "react";
import { tx, localizeData } from "../../lib/i18n";
import { date, money } from "../../lib/finance";
import type { Language, RecordItem } from "../../lib/types";

// Gelir/Gider görünüm kartı: kaydın içeriği düzenleme açılmadan sağ üstte küçük bir kartta okunur.
export function RecordViewPanel({ language, record: x, sectionName, canEdit, inline, onClose, onEdit, onMessages, onOpenTable }: { inline?: boolean; language: Language; record: RecordItem; sectionName: string; canEdit: boolean; onClose: () => void; onEdit: () => void; onMessages: () => void; onOpenTable: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const kindLabel = x.kind === "income" ? tx(language, "Gelir", "Income", "Dahat") : tx(language, "Gider", "Expense", "Mesref");
  const tableRows = (x.detailTable?.length ?? 0) > 1 ? x.detailTable!.length - 1 : 0;
  const rows: [string, string][] = [
    [tx(language, "Kasa", "Cash account", "Qase"), x.cashAccount],
    [tx(language, "Bölüm", "Section", "Beş"), sectionName],
    [tx(language, "Kişi", "Person", "Kes"), x.person],
    [tx(language, "Birim", "Unit", "Yekîne"), x.project],
    [tx(language, "Liste", "List", "Lîste"), x.listName],
    [tx(language, "Etiketler", "Tags", "Etîket"), (x.tags ?? []).join(", ")],
  ].filter(([, v]) => v && v.trim()) as [string, string][];
  return (
    <aside className={inline ? "noteDrawer recordView recordViewInline" : "noteDrawer recordView"} role="dialog" aria-label={x.source}>
      <header>
        <div>
          <span className={`noteDrawerStatus recordViewKind ${x.kind}`}>{kindLabel}{x.debtRole ? ` · ${tx(language, "Borç", "Debt", "Deyn")}` : ""}</span>
          <h2>{localizeData(x.source, language)}</h2>
          <small>{date(x.date, language)}</small>
        </div>
        <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
      </header>
      <div className="noteDrawerBody">
        <div className={`recordViewAmount ${x.kind === "expense" ? "negative" : "positive"}`}>{x.kind === "expense" ? "−" : ""}{money(x.amount, x.currency)}</div>
        {rows.map(([label, value]) => (
          <p key={label} className="noteDrawerRow"><b>{label}</b><span>{localizeData(value, language)}</span></p>
        ))}
        {x.link && /^https?:\/\//i.test(x.link) && (
          <p className="noteDrawerRow"><b>{tx(language, "Link", "Link", "Lînk")}</b><span><a className="recordLink" href={x.link} target="_blank" rel="noopener noreferrer">🔗 {x.link.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</a></span></p>
        )}
        {x.detail && <div className="noteDrawerSection"><b>{tx(language, "Detay", "Detail", "Hûragahî")}</b><div className="noteDrawerContent">{x.detail}</div></div>}
        {x.note && <div className="noteDrawerSection"><b>{tx(language, "Not", "Note", "Nîşe")}</b><div className="noteDrawerContent">{x.note}</div></div>}
        {((x.attachments?.length ?? 0) > 0 || tableRows > 0) && (
          <div className="noteDrawerSection">
            <b>{tx(language, "Belgeler", "Documents", "Belge")}</b>
            <div className="noteAttachments">
              {(x.attachments ?? []).map((doc, i) => (
                <a key={`${doc.name}-${i}`} className="noteAttachmentChip" href={doc.data} download={doc.name} title={doc.name}>📎 <span>{doc.name}</span></a>
              ))}
              {tableRows > 0 && (
                <button type="button" className="noteAttachmentChip" onClick={onOpenTable}>▦ <span>{tx(language, "Gider detayı", "Expense details", "Hûrguliyên mesrefê")} ({tableRows})</span></button>
              )}
            </div>
          </div>
        )}
      </div>
      <footer>
        <button type="button" className="light" onClick={onMessages}>💬 {tx(language, "Mesajlar", "Messages", "Peyam")}</button>
        {canEdit && <button type="button" className="primary" onClick={onEdit}>✎ {tx(language, "Düzenle", "Edit", "Biguherîne")}</button>}
      </footer>
    </aside>
  );
}
