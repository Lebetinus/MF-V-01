"use client";

import { PersonChip } from "../shared";
import { tx, localizeData } from "../../lib/i18n";
import { date, money } from "../../lib/finance";
import type { FinanceNote, KasaSection, Kind, Language, RecordItem } from "../../lib/types";
import { RecordViewPanel } from "./RecordViewPanel";

// Tablonun sağındaki pano: seçili kaydın görünümü, ya da "En Son Gelirler/Giderler" + "Mali Özel Notlar".
export type LatestPanelContext = {
  language: Language;
  kind: Kind;
  kasaSplitActive: boolean;
  readOnly: boolean;
  sections: KasaSection[];
  records: RecordItem[];
  rows: RecordItem[];
  notes: FinanceNote[];
  viewTarget: RecordItem | null;
  setViewTarget: (x: RecordItem | null) => void;
  onEdit: (x: RecordItem) => void;
  setCommentTarget: (x: RecordItem | null) => void;
  setDetailViewTarget: (x: RecordItem | null) => void;
};

export function renderLatestPanel(c: LatestPanelContext) {
  const { language, kind, kasaSplitActive, readOnly, sections, records, rows, notes, viewTarget, setViewTarget, onEdit, setCommentTarget, setDetailViewTarget } = c;
  const latestRows = [...records]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 3);
  // "En Son Gelirler/Giderler" panosunun altındaki "Mali Özel Notlar"
  // bölümü — bu sayfanın türüyle (income/expense) ilişkilendirilmiş en
  // son 3 özel not (bkz. RecordModal'daki "Mali Özel Not" alanı).
  const latestNotes = [...notes]
    .filter((n) => n.relation === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  // Gelir/Gider sayfalarındaki "En Son Gelirler/Giderler" panosuyla aynı
  // düzen — kasa seçiliyken de sağda bu kasanın en son 5 hareketi (gelir +
  // gider karışık) görünsün diye, kullanıcının elle sıraladığı orderedRows
  // yerine `rows`'tan bağımsızca en güncel tarihe göre hesaplanır.
  const kasaLatestRows = kasaSplitActive
    ? [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5)
    : [];
  return (
    <aside className={`latestRecords ${kasaSplitActive ? "cash" : kind}`}>
      {viewTarget ? (
        <RecordViewPanel
          inline
          language={language}
          record={viewTarget}
          sectionName={viewTarget.sectionId ? sections.find((sec) => sec.id === viewTarget.sectionId)?.name ?? "" : ""}
          canEdit={!readOnly}
          onClose={() => setViewTarget(null)}
          onEdit={() => { const item = viewTarget; setViewTarget(null); onEdit(item); }}
          onMessages={() => { const item = viewTarget; setViewTarget(null); setCommentTarget(item); }}
          onOpenTable={() => { const item = viewTarget; setViewTarget(null); setDetailViewTarget(item); }}
        />
      ) : kasaSplitActive ? (
        <p className="latestNotesEmpty">
          {tx(language, "Bir Gelir veya Gider adına tıklayın; içeriği burada görünsün.", "Click an income or expense name to see its content here.", "Li navê Dahat an Mesrefekê bitikîne; naverok li vir xuya dibe.")}
        </p>
      ) : (
      <>
      <div className="latestHead">
        <span>{kasaSplitActive ? "⇄" : kind === "income" ? "↗" : "↘"}</span>
        <div>
          <h3>
            {kasaSplitActive
              ? tx(language, "Son Hareketler", "Latest Activity", "Çalakiyên Dawî")
              : kind === "income"
                ? tx(language, "En Son Gelirler", "Latest Income", "Dahatên Dawî")
                : tx(language, "En Son Giderler", "Latest Expenses", "Mesrefên Dawî")}
          </h3>
          <small>
            {tx(language, "Son eklenen 3 kayıt", "3 most recent records", "3 qeydên herî dawî")}
          </small>
        </div>
      </div>
      <div className="latestList">
        {(kasaSplitActive ? kasaLatestRows : latestRows).map((x) => (
          <article key={x.id} className={x.kind === "expense" ? "expense" : ""}>
            <i />
            <span>
              <b>{localizeData(x.source, language)}</b>
              <small>{date(x.date, language)} · <PersonChip name={x.person}>{localizeData(x.person, language)}</PersonChip></small>
            </span>
            <strong>{x.kind === "expense" ? "−" : "+"}{money(x.amount, x.currency)}</strong>
          </article>
        ))}
      </div>
      {!kasaSplitActive && (
        <>
          <div className="latestHead latestNotesHead">
            <span>📝</span>
            <div>
              <h3>{tx(language, "Mali Özel Notlar", "Private Finance Notes", "Nîşeyên Taybet ên Darayî")}</h3>
              <small>
                {tx(language, "Son eklenen 3 not", "3 most recent notes", "3 nîşeyên herî dawî")}
              </small>
            </div>
          </div>
          <div className="latestList">
            {latestNotes.length === 0 ? (
              <p className="latestNotesEmpty">
                {tx(language, "Henüz özel not eklenmemiş.", "No private notes yet.", "Hê nîşeya taybet nehatiye zêdekirin.")}
              </p>
            ) : (
              latestNotes.map((n) => (
                <article key={n.id}>
                  <i />
                  <span>
                    <b>{localizeData(n.title, language)}</b>
                    <small>{localizeData(n.content, language)}</small>
                  </span>
                </article>
              ))
            )}
          </div>
        </>
      )}
      </>
      )}
    </aside>
  );
}
