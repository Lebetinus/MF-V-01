"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { PersonChip } from "../shared";
import { debtPairOfRecord } from "../../lib/debts";
import { workspaceKeyOf, type workspaceOptions } from "../KasaManage";
import { TableTools } from "../TableTools";
import { tx, localizeData } from "../../lib/i18n";
import { date, money, toUsd, type ExchangeRates } from "../../lib/finance";
import type { CashAccountSummary, CashTransfer, KasaSection, Language, RecordItem, RecordsView } from "../../lib/types";
import { DocCell } from "./documents";
import type { ColumnId } from "./useColumnLayout";

// 💬 sütununun özeti (bkz. refreshCommentSummaries in Records()).
export type CommentSummary = { count: number; lastText: string; lastUserName: string; hasAttention: boolean; hasUnread: boolean };

// Hücre çiziminin Records'tan aldığı durum ve geri çağrılar.
export type RecordCellContext = {
  language: Language;
  kind: RecordsView;
  readOnly: boolean;
  allRecords: RecordItem[];
  cashAccounts: CashAccountSummary[];
  sections: KasaSection[];
  wsOptions: ReturnType<typeof workspaceOptions>;
  commentSummaries: Record<number, CommentSummary>;
  approvingId: number | null;
  exchangeRates: ExchangeRates;
  onEdit: (x: RecordItem) => void;
  setViewTarget: (x: RecordItem) => void;
  setDetailViewTarget: (x: RecordItem) => void;
  setCommentTarget: (x: RecordItem) => void;
  approveTransfer: (transferId: number) => void;
  setDeleteTarget: (x: RecordItem) => void;
  // "Borca çevir" / "Borçtan çıkar" penceresi (sistem dışı kasaya / projeye borç; bkz. DebtMarkModal).
  onDebtMark?: (x: RecordItem) => void;
  startRowDrag: (e: ReactMouseEvent, id: number) => void;
};

// Tablo çiziminin ek olarak aldığı sütun düzeni, seçim ve sürükleme durumu.
export type RecordsTableContext = RecordCellContext & {
  columnOrder: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  kasaSplitActive: boolean;
  selectedIds: Set<number>;
  toggleMany: (list: RecordItem[], on: boolean) => void;
  draggedColumn: ColumnId | null;
  setDraggedColumn: (id: ColumnId | null) => void;
  reorderColumn: (draggedId: ColumnId, targetId: ColumnId) => void;
  startResize: (e: ReactMouseEvent, id: ColumnId) => void;
  cashTransfers: CashTransfer[];
  draggedRowId: number | null;
  dragOverRowId: number | null;
};

// Borç kaydının adı (dört rol; bkz. app/lib/debts.ts).
export function debtRoleLabel(role: string | undefined, language: Language): string {
  return role === "lent" ? tx(language, "Borç verildi", "Lent", "Deyn hat dayîn")
    : role === "borrowed" ? tx(language, "Borç alındı", "Borrowed", "Deyn hat girtin")
    : role === "collected" ? tx(language, "Borç tahsilatı", "Debt collected", "Deyn hat standin")
    : tx(language, "Borç ödemesi", "Debt payment", "Dravdana deynê");
}
// Borç simgesinin / rozetinin üzerine gelince çıkan açıklama: kime/kimden, verilen, geri ödenen ve kalan.
export function debtTooltip(x: RecordItem, language: Language, allRecords: RecordItem[]): string {
  const title = debtRoleLabel(x.debtRole, language);
  const lenderSide = x.debtRole === "lent" || x.debtRole === "collected";
  const pair = debtPairOfRecord(allRecords, x);
  if (!pair) return `${title}: ${money(x.amount, x.currency)}`;
  const route = `${localizeData(pair.creditorName || "—", language)} → ${localizeData(pair.debtorName || "—", language)}`;
  return [
    `${title}: ${route}`,
    `${tx(language, "Verilen borç", "Lent", "Deynê hatî dayîn")}: ${money(pair.given, pair.currency)}`,
    `${tx(language, "Geri ödenen", "Repaid", "Hatî vegerandin")}: ${money(pair.returned, pair.currency)}`,
    `${tx(language, "Kalan", "Remaining", "Mayî")}: ${money(pair.outstanding, pair.currency)}`,
    ...(pair.external ? [tx(language, "Sistem dışı kasa / proje", "Kasa / project outside the system", "Qase / projeya derveyî sîstemê") + (pair.people.length ? ` · ${tx(language, "Alan", "Received by", "Wergir")}: ${pair.people.join(", ")}` : "")] : []),
    lenderSide
      ? tx(language, "Borç veren kasanın kaydı: bakiyeye girer, gelir/gider istatistiğine girmez.", "Lender-side record: affects the balance, not income/expense statistics.", "Qeyda deyndêr: dikeve balansê, nakeve statîstîka dahat/mesrefê.")
      : tx(language, "Borç alan kasanın kaydı: bakiyeye ve gelir/gider istatistiğine girer.", "Borrower-side record: counts in the balance and income/expense statistics.", "Qeyda deyndar: dikeve balans û statîstîka dahat/mesrefê."),
  ].join("\n");
}
export function columnLabel(id: ColumnId, language: Language): string {
  switch (id) {
    case "date":
      return tx(language, "Tarih", "Date", "Tarîx");
    case "title":
      return tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke");
    case "workspace":
      return tx(language, "Çalışma Alanı", "Workspace", "Qada Xebatê");
    case "debt":
      return tx(language, "Borç", "Debt", "Deyn");
    case "documents":
      return tx(language, "Belgeler", "Documents", "Belge");
    case "detail":
      return tx(language, "Detay / Not", "Detail / Note", "Hûragahî / Nîşe");
    case "messages":
      return tx(language, "Mesajlar", "Messages", "Peyam");
    case "person":
      return tx(language, "Kişi", "Person", "Kes");
    case "amount":
      return tx(language, "Miktar", "Amount", "Meblağ");
    case "location":
      return tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne");
    case "tags":
      return tx(language, "Etiket", "Tag", "Etîket");
    case "action":
      return tx(language, "İşlem", "Action", "Çalakî");
  }
}
export function columnCellClassName(id: ColumnId): string {
  return id === "amount" ? "amount" : "";
}
export function renderCell(
  id: ColumnId,
  x: RecordItem,
  ctx: { pendingTransfer?: CashTransfer; canApprove?: boolean; isTransfer?: boolean },
  cellCtx: RecordCellContext,
) {
  const {
    language,
    readOnly,
    allRecords,
    cashAccounts,
    sections,
    wsOptions,
    commentSummaries,
    approvingId,
    exchangeRates,
    onEdit,
    setViewTarget,
    setDetailViewTarget,
    setCommentTarget,
    approveTransfer,
    setDeleteTarget,
    onDebtMark,
    startRowDrag,
  } = cellCtx;
  switch (id) {
    case "date":
      return <span className="cellDate">{date(x.date, language)}</span>;
    case "title":
      return (
        <>
          <button
            type="button"
            className="cellTitle cellTitleButton"
            title={tx(
              language,
              "Girilen verileri görmek için tıklayın",
              "Click to view the entered data",
              "Ji bo dîtina daneyên hatine nivîsandin bitikîne",
            )}
            onClick={() => setViewTarget(x)}
          >
            {localizeData(x.source, language)}
          </button>
          {x.debtRole && (
            <span className="debtBadge" title={debtTooltip(x, language, allRecords)}>
              {tx(language, "Borç", "Debt", "Deyn")}
            </span>
          )}
          {x.link && /^https?:\/\//i.test(x.link) && (
            <a className="cellLinkIcon" href={x.link} target="_blank" rel="noopener noreferrer" title={x.link} onClick={(e) => e.stopPropagation()}>🔗</a>
          )}
          {ctx.pendingTransfer && (
            <small className="subNote pendingBadge">
              ⏳ {tx(language, "Onay Bekliyor", "Awaiting Approval", "Li Benda Erêkirinê")}
            </small>
          )}
        </>
      );
    case "detail":
      return (
        <>
          <span className="cellDetailText" title={localizeData(x.detail || x.note, language)}>
            {localizeData(x.detail || x.note, language)}
          </span>
          <small className="subNote" title={x.detail ? localizeData(x.note, language) : undefined}>
            {x.detail && localizeData(x.note, language)}
          </small>
        </>
      );
    case "workspace": {
      const account = cashAccounts.find((a) => a.name === x.cashAccount);
      const label = account
        ? wsOptions.find((o) => o.key === workspaceKeyOf(account.sectionId, sections))?.label
        : undefined;
      return <span className="cellDetailText" title={label}>{label ? localizeData(label, language) : "—"}</span>;
    }
    case "documents": {
      const docs = x.attachments ?? [];
      const tableRows = (x.detailTable?.length ?? 0) > 1 ? x.detailTable!.length - 1 : 0;
      if (!docs.length && !tableRows) return <span className="docEmpty">—</span>;
      return (
        <DocCell
          language={language}
          recordId={x.id}
          docs={docs}
          tableRows={tableRows}
          onOpenDetail={() => setDetailViewTarget(x)}
        />
      );
    }
    case "messages":
      return (
        <button
          type="button"
          className={`messagesCell${commentSummaries[x.id] ? "" : " messagesCellEmpty"}${
            commentSummaries[x.id]?.hasAttention ? " attention" : ""
          }${commentSummaries[x.id]?.hasUnread ? " unread" : ""}`}
          title={commentSummaries[x.id]?.lastText}
          onClick={() => setCommentTarget(x)}
        >
          {commentSummaries[x.id] ? (
            <>
              {commentSummaries[x.id].hasUnread && <span className="commentUnreadDot" title={tx(language, "Okunmadı", "Unread", "Nexwendî")} />}
              {commentSummaries[x.id].hasAttention ? "⚠️" : "💬"}
              <b>{commentSummaries[x.id].lastUserName}:</b>
              <span className="messagesCellText">{commentSummaries[x.id].lastText}</span>
              <span className="messagesCellCount">{commentSummaries[x.id].count}</span>
            </>
          ) : (
            <>💬 {tx(language, "Yorum ekle", "Add a comment", "Şîrove zêde bike")}</>
          )}
        </button>
      );
    case "person":
      return <PersonChip name={x.person}>{localizeData(x.person, language)}</PersonChip>;
    case "amount":
      {
        // USD dışı tutarın üzerine gelince, o günün kuruyla USD karşılığı açılır kutuda görünür.
        const usd = x.currency === "USD" ? null : toUsd(x.amount, x.currency, exchangeRates);
        const tip = x.currency === "USD"
          ? undefined
          : usd === null
            ? tx(language, "Bu para birimi için kur bulunamadı (Ayarlar > Döviz Kurları)", "No rate available for this currency (Settings > Exchange Rates)", "Ji bo vê diravê kur nehat dîtin")
            : `≈ ${money(usd, "USD")}\n1 USD = ${exchangeRates[x.currency]} ${x.currency}\n${tx(language, "Günlük kur", "Daily rate", "Kurê rojane")}`;
        return <span className={`${x.kind === "income" ? "amountIncome" : x.kind === "expense" ? "amountExpense" : ""}${tip ? " hasRateTip" : ""}`} title={tip}>{money(x.amount, x.currency)}</span>;
      }
    case "location":
      return (
        <>
          <span className="cellDetailText" title={localizeData(x.project, language)}>
            {localizeData(x.project, language)}
          </span>
          {x.cashAccount && (
            <small className="subNote" title={localizeData(x.cashAccount, language)}>
              ▣ {localizeData(x.cashAccount, language)}
            </small>
          )}
        </>
      );
    case "debt":
      return x.debtRole ? (
        <span className={`debtIcon ${x.debtRole}`} title={debtTooltip(x, language, allRecords)} aria-label={debtTooltip(x, language, allRecords)} tabIndex={0}>
          {x.debtRole === "lent" ? "↗" : x.debtRole === "borrowed" ? "↙" : x.debtRole === "collected" ? "↩" : "✓"}
        </span>
      ) : null;
    case "tags":
      return (
        <div className="tagRow">
          {(x.tags || []).map((t) => (
            <span key={t}>{localizeData(t, language)}</span>
          ))}
        </div>
      );
    case "action":
      return (
        <>
          {!readOnly && ctx.canApprove && (
            <button
              type="button"
              className="icon approve"
              title={tx(language, "Aktarımı Onayla", "Approve Transfer", "Veguhastinê Erê Bike")}
              disabled={approvingId === ctx.pendingTransfer!.id}
              onClick={() => approveTransfer(ctx.pendingTransfer!.id)}
            >
              ✓
            </button>
          )}
          {!readOnly && (
            <>
              <button className="icon edit" title={tx(language, "Düzenle", "Edit", "Biguherîne")} onClick={() => onEdit(x)}>
                ✎
              </button>
              {onDebtMark && x.cashAccountId != null && !ctx.isTransfer && (
                <button
                  type="button"
                  className={`icon debtMark${x.debtRole ? " on" : ""}`}
                  title={x.debtRole === "lent"
                    ? tx(language, "Borç bilgisi: karşı kasayı değiştir / borçtan çıkar", "Debt details: change the counterpart / remove the mark", "Agahiya deynê")
                    : x.debtRole
                    ? tx(language, "Borçtan çıkar (normal kayda döndür)", "Remove the debt mark", "Nîşana deynê rake")
                    : x.kind === "expense"
                      ? tx(language, "Borca çevir", "Mark as debt", "Bike deyn")
                      : tx(language, "Borç tahsilatı olarak işaretle", "Mark as debt collection", "Wek standina deynê nîşan bike")}
                  onClick={() => onDebtMark(x)}
                >
                  ⇄
                </button>
              )}
              <button
                className="icon delete"
                title={tx(language, "Sil", "Delete", "Jêbirin")}
                onClick={() => setDeleteTarget(x)}
              >
                🗑
              </button>
            </>
          )}
          <span
            className="icon rowDragHandle"
            onMouseDown={(e) => startRowDrag(e, x.id)}
            title={tx(
              language,
              "Satırı sürükleyerek yukarı/aşağı taşı",
              "Drag to move this row up/down",
              "Ji bo derbaskirina jor/jêr rêzê bikişîne",
            )}
          >
            ⠿
          </span>
        </>
      );
  }
}

// Tek bir kolgroup/thead/tbody bloğu üretir — sütun sırası/genişliği ve
// satır sürükleme tüm tablolarda aynı davransın diye Kasa detayındaki
// Gelir/Gider ayrımında da (bkz. aşağıdaki kasaResultSplit) bu fonksiyon
// yeniden kullanılıyor, tek bir birleşik tabloda da.
export function renderRecordsTable(tableRows: RecordItem[], tableCtx: RecordsTableContext) {
  const {
    language,
    kind,
    cashAccounts,
    columnOrder,
    columnWidths,
    kasaSplitActive,
    selectedIds,
    toggleMany,
    draggedColumn,
    setDraggedColumn,
    reorderColumn,
    startResize,
    cashTransfers,
    draggedRowId,
    dragOverRowId,
    setViewTarget,
  } = tableCtx;
  // Satırın herhangi bir yerine tıklamak kaydın detay panelini açar (eskiden yalnız başlık yazısı açıyordu). Satırdaki
  // düğmeler, bağlantılar, seçim kutusu ve sürükleme tutamacı kendi işini yapar; yazı seçilirken de panel açılmaz.
  const openRow = (e: ReactMouseEvent<HTMLTableRowElement>, x: RecordItem) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label, [role='button'], .selectCell, .rowDragHandle")) return;
    if (window.getSelection()?.toString()) return;
    // Ctrl/Shift ile ya da sürükleyerek hücre seçilirken (tablo toplama çubuğu) kayıt açılmaz.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.currentTarget.querySelector("td[data-calc-sel]")) return;
    setViewTarget(x);
  };
  // Borç simgesi sütunu yalnızca tabloda borç hareketi varsa görünür; kasa sayfasında çalışma alanı sütunu gereksizdir.
  const cols = columnOrder.filter((id) => (id !== "debt" || tableRows.some((r) => r.debtRole)) && (id !== "workspace" || !kasaSplitActive));
  const colsTotal = 38 + cols.reduce((t, id) => t + columnWidths[id], 0);
  return (
    <TableTools id={`records-${kind}`} language={language} className="recordsTable resizableTable" resize={false}>
      <table>
        <colgroup>
          {/* Kasa sayfasında sütunlar yüzde olarak ölçeklenir: tablo kutuya sığar, yatay kaydırma çıkmaz. */}
          <col style={{ width: kasaSplitActive ? `${(38 / colsTotal) * 100}%` : 38 }} />
          {cols.map((id) => (
            <col key={id} style={{ width: kasaSplitActive ? `${(columnWidths[id] / colsTotal) * 100}%` : columnWidths[id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="selectCell">
              <input
                type="checkbox"
                aria-label={tx(language, "Tümünü seç", "Select all", "Hemûyan hilbijêre")}
                disabled={tableRows.length === 0}
                checked={tableRows.length > 0 && tableRows.every((r) => selectedIds.has(r.id))}
                ref={(el) => {
                  if (el) el.indeterminate = tableRows.some((r) => selectedIds.has(r.id)) && !tableRows.every((r) => selectedIds.has(r.id));
                }}
                onChange={(e) => toggleMany(tableRows, e.target.checked)}
              />
            </th>
            {cols.map((id) => (
              <th
                key={id}
                className={draggedColumn === id ? "colDragging" : ""}
                draggable
                onDragStart={(e) => {
                  setDraggedColumn(id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (draggedColumn !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedColumn !== null) reorderColumn(draggedColumn, id);
                  setDraggedColumn(null);
                }}
                onDragEnd={() => setDraggedColumn(null)}
                title={tx(
                  language,
                  "Sürükleyerek sütunu taşı, kenarından tutup genişliğini ayarla",
                  "Drag to move this column, drag its edge to resize",
                  "Ji bo derbaskirina stûnê bikişîne, ji kêleka wê genîtiyê saz bike",
                )}
              >
                <span className="colHeaderLabel">{columnLabel(id, language)}</span>
                <span
                  className="colResizeHandle"
                  draggable={false}
                  // ref yalnız fare olayında (startResize içinde) kullanılır, render sırasında değil
                  onMouseDown={(e) => startResize(e, id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} className="empty">
                {tx(language, "Bu grupta kayıt yok.", "No records in this group.", "Di vê komê de qeyd tune.")}
              </td>
            </tr>
          )}
          {tableRows.map((x) => {
            const pendingTransfer = cashTransfers.find((t) => t.toRecordId === x.id && t.status === "pending");
            const canApprove = pendingTransfer && cashAccounts.some((a) => a.id === pendingTransfer.toCashAccountId);
            const isTransfer = cashTransfers.some((t) => t.toRecordId === x.id || t.fromRecordId === x.id);
            return (
              <tr
                key={x.id}
                data-row-id={x.id}
                onClick={(e) => openRow(e, x)}
                className={`recordRow ${selectedIds.has(x.id) ? "rowSelected " : ""}${pendingTransfer ? "pendingTransferRow" : ""}${draggedRowId === x.id ? " rowDragging" : ""}${dragOverRowId === x.id && draggedRowId !== null && draggedRowId !== x.id ? " rowDragOver" : ""}`}
              >
                <td className="selectCell">
                  <input type="checkbox" aria-label={tx(language, "Satırı seç", "Select row", "Rêzê hilbijêre")} checked={selectedIds.has(x.id)} onChange={(e) => toggleMany([x], e.target.checked)} />
                </td>
                {cols.map((id) => (
                  <td key={id} className={columnCellClassName(id)}>
                    {renderCell(id, x, { pendingTransfer, canApprove, isTransfer }, tableCtx)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableTools>
  );
}
