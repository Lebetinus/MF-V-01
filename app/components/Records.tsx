"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { downloadWorkbook, newWorkbook } from "../lib/excel";
import { Title, DeleteConfirmModal, PersonChip } from "./shared";
import { debtPairs, isDebtLeg, kasaDebtByCurrency } from "../lib/debts";
import { KasaBoard, type BoardAction } from "./KasaBoard";
import { RecordCommentsModal } from "./Comments";
import { KasaDeleteModal, KasaEditModal, parentWorkspaceOptions, workspaceKeyOf, workspaceOptions } from "./KasaManage";
import { WorkspaceAccessModal, type AccessKasa } from "./WorkspaceAccess";
import { TableTools } from "./TableTools";
import { tx, localizeData } from "../lib/i18n";
import { combineByCurrency, date, money, moneyBreakdown, parseImportDate, toUsd, total, type ExchangeRates } from "../lib/finance";
import type { CashAccountSummary, CashTransfer, FinanceNote, KasaSection, Kind, Language, RecordItem, UserAccount } from "../lib/types";
import { notify } from "../lib/notify";
import { DetailTableModal } from "./records/detailTable";
import { ShareKasaModal } from "./records/inputs";
import { KasaResultModal } from "./records/KasaResultModal";
import { DocCell } from "./records/documents";
import { RecordViewPanel } from "./records/RecordViewPanel";

// Kasalar/Gelir/Gider tablosunun sütunları — kullanıcı bunları sürükleyerek
// sırasını değiştirebilir ve kenarından tutup genişliğini ayarlayabilir
// (bkz. columnOrder/columnWidths in Records()). Tek bir liste hem sütun
// kimliklerini hem de varsayılan genişliklerini taşır; sırası
// DEFAULT_COLUMN_ORDER'ın başlangıç durumudur.
type ColumnId = "date" | "title" | "workspace" | "documents" | "detail" | "messages" | "person" | "amount" | "location" | "tags" | "debt" | "action";
// Ana görünüm: Tarih, Kasa Adı, Çalışma Alanı, Kişi, Belgeler, Miktar, Etiket, İşlem. Detay/Not, Mesajlar ve Kasa Yeri ana tabloda yok.
const DEFAULT_COLUMN_ORDER: ColumnId[] = ["date", "title", "workspace", "person", "documents", "amount", "tags", "debt", "action"];
// Detay/Not ve Mesajlar öntanımlı olarak en dar iki sütun — uzun metin
// satıra sığmayınca satırı büyütmek yerine tek satırda "..." ile kesilir
// (bkz. renderCell'deki .cellDetailText ve .messagesCellText), böylece
// tablo hem dikeyde hem yatayda daha az yer kaplar. amount/action bilerek
// küçültülmedi — tutarların ve satır aksiyon ikonlarının kesilmemesi
// gerekiyor. Kullanıcı isterse sütun kenarından tutup yine genişletebilir.
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  date: 100,
  title: 170,
  workspace: 130,
  documents: 90,
  detail: 110,
  messages: 110,
  person: 80,
  amount: 110,
  location: 120,
  tags: 100,
  debt: 56,
  action: 104,
};
const MIN_COLUMN_WIDTH = 64;
// v2: Detay/Not ve Mesajlar öntanımlı genişlikleri daraltıldı — anahtar
// sürümü artırılmasa, daha önce kaydedilmiş (geniş) genişlikler yeni
// varsayılanları maskeler ve kullanıcı hiçbir fark görmez.
const COLUMNS_STORAGE_KEY = "mf-records-columns-v5";

// Kasalar sayfasındaki kasa kartı verisi (kasa kaydı + bağlı gelir/gider).
type CardGroup = {
  name: string;
  kind: Kind;
  count: number;
  totalInByCurrency: Record<string, number>;
  totalOutByCurrency: Record<string, number>;
  totalByCurrency: Record<string, number>;
};

export function Records({
  language,
  kind,
  records,
  allRecords,
  onAdd,
  onEdit,
  onDelete,
  onImport,
  checkPassword,
  cashAccounts,
  users,
  onCashAccountsChange,
  search,
  setSearch,
  cashTransfers,
  onTransfersChanged,
  onCommentsRead,
  readOnly,
  notes,
  exchangeRates = {},
  onRefreshData,
  sections = [],
  workspaceOrder = [],
  isSuperAdmin = false,
  onGoUpload,
}: {
  language: Language;
  kind: Kind;
  records: RecordItem[];
  allRecords: RecordItem[];
  onAdd: (kind?: Kind, cashAccount?: string, workspaceKey?: string) => void;
  onEdit: (x: RecordItem) => void;
  onDelete: (x: RecordItem, reason: string) => void;
  onImport: (rows: Omit<RecordItem, "id">[]) => void;
  checkPassword: (password: string) => Promise<boolean>;
  cashAccounts: CashAccountSummary[];
  users: UserAccount[];
  onCashAccountsChange: (updater: CashAccountSummary[] | ((current: CashAccountSummary[]) => CashAccountSummary[])) => void;
  search: string;
  setSearch: (v: string) => void;
  cashTransfers: CashTransfer[];
  onTransfersChanged: () => void;
  onCommentsRead?: () => void;
  readOnly: boolean;
  exchangeRates?: ExchangeRates;
  notes: FinanceNote[];
  onRefreshData?: () => void;
  sections?: KasaSection[];
  // Kasa Kontrol Merkezi: çalışma alanlarının elle sıralaması (anahtar listesi).
  workspaceOrder?: string[];
  isSuperAdmin?: boolean;
  onGoUpload?: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<RecordItem | null>(null);
  const [commentTarget, setCommentTarget] = useState<RecordItem | null>(null);
  // Satırdaki "Detay" göstergesine basınca açılan, yapıştırılmış gider
  // tablosunu salt-okunur gösteren pencere (bkz. DetailTableModal).
  const [detailViewTarget, setDetailViewTarget] = useState<RecordItem | null>(null);
  // Gelir/Gider satırının başlığına tıklayınca düzenleme yerine açılan salt okunur görünüm kartı.
  const [viewTarget, setViewTarget] = useState<RecordItem | null>(null);
  const [kasaResultOpen, setKasaResultOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Kasa kartı özet balonu: kartın üzerine binip tıklamayı engellemesin diye sayfa akışına göre kartın altında (yer yoksa üstünde) sabit konumlanır.
  useEffect(() => {
    const place = (event: MouseEvent) => {
      const card = (event.target as HTMLElement | null)?.closest?.(".groupCard");
      const tip = card?.querySelector<HTMLElement>(":scope > .groupCardTooltip");
      if (!card || !tip) return;
      requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const h = tip.offsetHeight;
        const w = tip.offsetWidth;
        const below = rect.bottom + 8 + h <= window.innerHeight || rect.top - 8 - h < 0;
        tip.style.position = "fixed";
        tip.style.bottom = "auto";
        tip.style.margin = "0";
        tip.style.pointerEvents = "none";
        tip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`;
        tip.style.top = `${below ? rect.bottom + 8 : rect.top - 8 - h}px`;
      });
    };
    document.addEventListener("mouseover", place);
    return () => document.removeEventListener("mouseover", place);
  }, []);
  // Manual row order (drag handle in the İşlem column) — a per-kind override
  // on top of the default date/id sort, kept in localStorage since it's a
  // personal display preference, not app data. Ids not in the saved order
  // (new records) fall back to their normal sorted position, after the ones
  // the user has placed.
  const [rowOrder, setRowOrder] = useState<number[]>([]);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<number | null>(null);
  const rowOrderStorageKey = `mf-row-order-${kind}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(rowOrderStorageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
      setRowOrder(saved ? JSON.parse(saved) : []);
    } catch {
      setRowOrder([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  function persistRowOrder(order: number[]) {
    setRowOrder(order);
    try {
      localStorage.setItem(rowOrderStorageKey, JSON.stringify(order));
    } catch {
      // Quota or private-mode failure — the order just won't survive reload.
    }
  }
  // Tarihe göre / son eklenene göre sıralama — standart bir liste özelliği.
  // Seçim değişince önceki elle sürükleme sırası (rowOrder) temizlenir, yoksa
  // yeni seçim görünürde hiçbir şey değiştirmemiş gibi durur.
  type SortMode = "dateDesc" | "dateAsc" | "addedDesc" | "addedAsc";
  const [sortMode, setSortMode] = useState<SortMode>("dateDesc");
  const sortModeStorageKey = `mf-sort-mode-${kind}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(sortModeStorageKey) as SortMode | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
      setSortMode(saved && ["dateDesc", "dateAsc", "addedDesc", "addedAsc"].includes(saved) ? saved : "dateDesc");
    } catch {
      setSortMode("dateDesc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  function changeSortMode(next: SortMode) {
    setSortMode(next);
    try {
      localStorage.setItem(sortModeStorageKey, next);
    } catch {
      // Quota or private-mode failure — the choice just won't survive reload.
    }
    persistRowOrder([]);
  }
  // Sütun sırası ve genişlikleri — Kasalar/Gelir/Gider üçünde de aynı
  // sütun kimlikleri geçerli olduğu için tek, paylaşılan bir tercih olarak
  // saklanır (kind'a göre ayrı değil).
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMN_ORDER);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const resizingRef = useRef<{ id: ColumnId; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { order?: string[]; widths?: Partial<Record<ColumnId, number>> };
        if (Array.isArray(parsed.order)) {
          const valid = parsed.order.filter((id): id is ColumnId => (DEFAULT_COLUMN_ORDER as string[]).includes(id));
          const missing = DEFAULT_COLUMN_ORDER.filter((id) => !valid.includes(id));
          const merged = [...valid, ...missing];
          // Yeni "Borç" simge sütunu, kayıtlı sıralarda Etiket ile İşlem arasına konur.
          if ((missing as string[]).includes("debt")) {
            const without: ColumnId[] = merged.filter((id) => id !== "debt");
            const at = without.indexOf("action");
            without.splice(at < 0 ? without.length : at, 0, "debt");
            // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
            setColumnOrder(without);
          } else setColumnOrder(merged);
        }
        if (parsed.widths) setColumnWidths((w) => ({ ...w, ...parsed.widths }));
      }
    } catch {
      // Corrupt/unavailable storage — defaults stay in place.
    }
    setColumnsLoaded(true);
  }, []);

  useEffect(() => {
    if (!columnsLoaded) return;
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify({ order: columnOrder, widths: columnWidths }));
    } catch {
      // Quota or private-mode failure — the layout just won't survive reload.
    }
  }, [columnOrder, columnWidths, columnsLoaded]);

  function reorderColumn(draggedId: ColumnId, targetId: ColumnId) {
    setColumnOrder((order) => {
      const from = order.indexOf(draggedId);
      const to = order.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return order;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      return next;
    });
  }

  function onResizeMove(e: MouseEvent) {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(MIN_COLUMN_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColumnWidths((w) => ({ ...w, [r.id]: next }));
  }
  function onResizeEnd() {
    resizingRef.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }
  function startResize(e: ReactMouseEvent, id: ColumnId) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { id, startX: e.clientX, startWidth: columnWidths[id] };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }

  const wsOptions = workspaceOptions(sections, language);
  // Borç simgesinin üzerine gelince çıkan açıklama: kime/kimden, toplam, ödenen ve kalan.
  function debtTooltip(x: RecordItem): string {
    const title = x.debtRole === "lent" ? tx(language, "Borç verildi", "Lent", "Deyn hat dayîn") : x.debtRole === "borrowed" ? tx(language, "Borç alındı", "Borrowed", "Deyn hat girtin") : tx(language, "Borç ödemesi", "Debt payment", "Dravdana deynê");
    const debtorId = x.debtRole === "lent" ? x.debtCashAccountId : x.cashAccountId;
    const creditorId = x.debtRole === "lent" ? x.cashAccountId : x.debtCashAccountId;
    const pair = debtPairs(allRecords).find((p) => p.debtorId === debtorId && p.creditorId === creditorId && p.currency === x.currency);
    if (!pair) return `${title}: ${money(x.amount, x.currency)}`;
    const route = `${localizeData(pair.creditorName || "—", language)} → ${localizeData(pair.debtorName || "—", language)}`;
    return [
      `${title}: ${route}`,
      `${tx(language, "Toplam borç", "Total debt", "Deynê giştî")}: ${money(pair.borrowed, pair.currency)}`,
      `${tx(language, "Ödenen", "Repaid", "Hatî dayîn")}: ${money(pair.repaid, pair.currency)}`,
      `${tx(language, "Kalan", "Remaining", "Mayî")}: ${money(pair.outstanding, pair.currency)}`,
    ].join("\n");
  }
  function columnLabel(id: ColumnId): string {
    switch (id) {
      case "date":
        return tx(language, "Tarih", "Date", "Tarîx");
      case "title":
        return kind === "cash"
          ? tx(language, "Kasa Adı", "Cash Account", "Navê Qaseyê")
          : tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke");
      case "workspace":
        return tx(language, "Çalışma Alanı", "Workspace", "Qada Xebatê");
      case "debt":
        return tx(language, "Borç", "Debt", "Deyn");
      case "documents":
        return tx(language, "Belgeler", "Documents", "Belge");
      case "detail":
        return showListColumn
          ? tx(language, "Liste Kaydı", "List Record", "Qeyda Lîsteyê")
          : tx(language, "Detay / Not", "Detail / Note", "Hûragahî / Nîşe");
      case "messages":
        return tx(language, "Mesajlar", "Messages", "Peyam");
      case "person":
        return tx(language, "Kişi", "Person", "Kes");
      case "amount":
        return tx(language, "Miktar", "Amount", "Meblağ");
      case "location":
        return kind === "cash"
          ? tx(language, "Kasa Yeri", "Cash Location", "Cihê Qaseyê")
          : tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne");
      case "tags":
        return tx(language, "Etiket", "Tag", "Etîket");
      case "action":
        return tx(language, "İşlem", "Action", "Çalakî");
    }
  }
  function columnCellClassName(id: ColumnId): string {
    return id === "amount" ? "amount" : "";
  }
  function renderCell(
    id: ColumnId,
    x: RecordItem,
    ctx: { pendingTransfer?: CashTransfer; canApprove?: boolean },
  ) {
    switch (id) {
      case "date":
        return <span className="cellDate">{date(x.date, language)}</span>;
      case "title":
        return (
          <>
            {readOnly && x.kind === "cash" ? (
              <b className="cellTitle" title={localizeData(x.source, language)}>
                {localizeData(x.source, language)}
              </b>
            ) : (
              <button
                type="button"
                className="cellTitle cellTitleButton"
                title={tx(
                  language,
                  "Girilen verileri görmek için tıklayın",
                  "Click to view the entered data",
                  "Ji bo dîtina daneyên hatine nivîsandin bitikîne",
                )}
                onClick={() => (x.kind === "cash" ? onEdit(x) : setViewTarget(x))}
              >
                {localizeData(x.source, language)}
              </button>
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
        return showListColumn ? (
          x.listName ? (
            <button
              type="button"
              className="linkButton"
              onClick={() => openList(x.listName)}
              title={tx(
                language,
                "Bu listeye ait tüm kayıtları göster",
                "Show all records in this list",
                "Hemû qeydên vê lîsteyê nîşan bide",
              )}
            >
              {localizeData(x.listName, language)}
            </button>
          ) : (
            "—"
          )
        ) : (
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
        const kasaName = x.kind === "cash" ? x.source : x.cashAccount;
        const account = cashAccounts.find((a) => a.name === kasaName);
        const label = account
          ? wsOptions.find((o) => o.key === workspaceKeyOf({ sectionId: account.sectionId ?? null, rjKasa: !!account.isRjKasa, listKasa: !!account.isListWorkspace }, sections))?.label
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
            docs={docs}
            tableRows={tableRows}
            onOpen={() => onEdit(x)}
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
          <span className={`debtIcon ${x.debtRole}`} title={debtTooltip(x)} aria-label={debtTooltip(x)} tabIndex={0}>
            {x.debtRole === "lent" ? "↗" : x.debtRole === "borrowed" ? "↙" : "✓"}
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
  const [commentSummaries, setCommentSummaries] = useState<
    Record<number, { count: number; lastText: string; lastUserName: string; hasAttention: boolean; hasUnread: boolean }>
  >({});
  const [shareTarget, setShareTarget] = useState<CashAccountSummary | null>(null);
  const [kasaEditTarget, setKasaEditTarget] = useState<CashAccountSummary | null>(null);
  const [kasaDeleteTarget, setKasaDeleteTarget] = useState<CashAccountSummary | null>(null);
  const [kasaMoveTarget, setKasaMoveTarget] = useState<CashAccountSummary | null>(null);
  const [accessTarget, setAccessTarget] = useState<{ title: string; kasas: AccessKasa[]; section?: KasaSection } | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  // Doluysa yeni alan bu çalışma alanının içinde "bölüm" olarak oluşturulur ("" = ana çalışma alanı).
  const [newWorkspaceParent, setNewWorkspaceParent] = useState("");
  const [newWorkspaceBusy, setNewWorkspaceBusy] = useState(false);
  const [newWorkspaceError, setNewWorkspaceError] = useState("");
  // Seçili kasa kartında "Kasayı Düzenle" ve "Kasayı Sil" (şifreli onay) düğmeleri.
  const kasaActions = (name: string, selected: boolean) => {
    if (!selected || readOnly) return null;
    const account = cashAccounts.find((a) => a.name === name);
    if (!account) return null;
    return (
      <span className="kasaActions">
        <button type="button" title={tx(language, "Kasayı Düzenle", "Edit Cash Account", "Qaseyê Biguherîne")} aria-label={tx(language, "Kasayı Düzenle", "Edit Cash Account", "Qaseyê Biguherîne")} onClick={() => setKasaEditTarget(account)}>✎</button>
        {isSuperAdmin && (
          <button type="button" title={tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")} aria-label={tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")} onClick={() => setAccessTarget({ title: `${account.name} — ${tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")}`, kasas: [{ id: account.id, name: account.name, ownerUserId: account.ownerUserId }] })}>👁</button>
        )}
        <button type="button" title={tx(language, "Çalışma alanına taşı", "Move to workspace", "Bibe qada xebatê")} aria-label={tx(language, "Çalışma alanına taşı", "Move to workspace", "Bibe qada xebatê")} onClick={() => setKasaMoveTarget(account)}>⇄</button>
        <button type="button" className="danger" title={tx(language, "Kasayı Sil", "Delete Cash Account", "Qaseyê Jê Bibe")} aria-label={tx(language, "Kasayı Sil", "Delete Cash Account", "Qaseyê Jê Bibe")} onClick={() => setKasaDeleteTarget(account)}>🗑</button>
      </span>
    );
  };
  const [shareBusyKey, setShareBusyKey] = useState<string | null>(null);
  const [dashboardShareBusy, setDashboardShareBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  async function approveTransfer(transferId: number) {
    setApprovingId(transferId);
    try {
      const response = await fetch(`/api/cash-transfers/${transferId}/confirm`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notify(body.error || tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
        return;
      }
      onTransfersChanged();
    } catch {
      notify(tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
    } finally {
      setApprovingId(null);
    }
  }

  async function toggleShare(userId: number, grant: boolean) {
    if (!shareTarget) return;
    const cashAccountId = shareTarget.id;
    const key = `${cashAccountId}-${userId}`;
    setShareBusyKey(key);
    try {
      const response = grant
        ? await fetch(`/api/cash-accounts/${cashAccountId}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          })
        : await fetch(`/api/cash-accounts/${cashAccountId}/access?userId=${userId}`, { method: "DELETE" });
      if (!response.ok) {
        notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
        return;
      }
      // Built from `shareTarget` itself (not the `cashAccounts` prop, which
      // may be scoped to just the active workspace) so this patches the
      // right row in the full list regardless of what's currently filtered.
      const updatedTarget: CashAccountSummary = {
        ...shareTarget,
        sharedWithUserIds: grant
          ? [...shareTarget.sharedWithUserIds, userId]
          : shareTarget.sharedWithUserIds.filter((id) => id !== userId),
      };
      onCashAccountsChange((current) => current.map((a) => (a.id === cashAccountId ? updatedTarget : a)));
      setShareTarget(updatedTarget);
    } catch {
      notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
    } finally {
      setShareBusyKey(null);
    }
  }

  async function toggleDashboardShare(enabled: boolean) {
    if (!shareTarget) return;
    const cashAccountId = shareTarget.id;
    setDashboardShareBusy(true);
    try {
      const response = await fetch(`/api/cash-accounts/${cashAccountId}/dashboard-share`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
        return;
      }
      const updatedTarget: CashAccountSummary = { ...shareTarget, dashboardShareEnabled: enabled };
      onCashAccountsChange((current) => current.map((a) => (a.id === cashAccountId ? updatedTarget : a)));
      setShareTarget(updatedTarget);
    } catch {
      notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
    } finally {
      setDashboardShareBusy(false);
    }
  }
  const [source, setSource] = useState("Tümü");
  const [showListColumn] = useState(false);
  const [activeList, setActiveList] = useState("");
  // Gelir/Gider sayfalarında kasa kutusuyla (ör. "Ana Kasa Giderleri") süzülen kasa adı.
  const [activeKasa, setActiveKasa] = useState("");
  // Gelir/Gider sayfalarında bölüm kutusuyla süzülen bölüm (Ayarlar > Bölümler).
  const [activeSection, setActiveSection] = useState<number | null>(null);
  // Kasalar sayfasında çalışma alanı başlığıyla süzülen alan anahtarı (genel / liste / rj / sec-<id>).
  const [activeWs, setActiveWs] = useState<string | null>(null);
  // Gelir/Gider sayfalarında seçili çalışma alanı (kasa kutuları yalnız seçili alanın kasalarını gösterir).
  const [activeIeWs, setActiveIeWs] = useState<string | null>(null);
  // Sayfa (Kasa/Gelir/Gider) değişince seçili çalışma alanı sıfırlanır. Render sırasında yapılır
  // (React'in "önceki değeri sakla" deseni): eski seçim yeni sayfada bir kare bile görünmez.
  const [wsKind, setWsKind] = useState(kind);
  if (wsKind !== kind) {
    setWsKind(kind);
    setActiveIeWs(null);
    setActiveWs(null);
  }
  const [showAllLists, setShowAllLists] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterPerson, setFilterPerson] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const activeFilterCount = [filterFrom, filterTo, filterSource, filterPerson, filterProject, filterTag].filter(Boolean).length;
  const clearFilters = () => {
    setFilterFrom("");
    setFilterTo("");
    setFilterSource("");
    setFilterPerson("");
    setFilterProject("");
    setFilterTag("");
  };
  // "Liste Kasası" işaretli kasalar (Listeler ile ilişkili): üstteki kasa kartlarında değil, yalnızca "Tüm Liste Kasaları"
  // bölümünde görünür; kasanın kendi kayıtları listeli kayıt sayılır.
  // Kasa adı kümeleri yalnız kasalar/bölümler değişince yeniden kurulur; aşağıdaki useMemo'lar bunlara bağlıdır.
  const kasaListNames = useMemo(() => new Set(cashAccounts.filter((a) => a.isListWorkspace).map((a) => a.name)), [cashAccounts]);
  // "RJ-Kasaları": üstteki kasa kartlarında değil, kendi renkli bölümlerinde görünür (Liste Kasaları gibi ayrı tutulur).
  const kasaRjNames = useMemo(() => new Set(cashAccounts.filter((a) => a.isRjKasa).map((a) => a.name)), [cashAccounts]);
  const cashSections = useMemo(() => sections.filter((x) => x.scope === "cash"), [sections]);
  const kasaSectionNames = useMemo(
    () => new Set(cashAccounts.filter((a) => a.sectionId != null && cashSections.some((x) => x.id === a.sectionId)).map((a) => a.name)),
    [cashAccounts, cashSections],
  );
  const listOf = useCallback((x: RecordItem) => x.listName || (x.kind === "cash" && kasaListNames.has(x.source) ? x.source : ""), [kasaListNames]);
  const isListLinked = useCallback((x: RecordItem) => !!x.listName || kasaListNames.has(x.cashAccount), [kasaListNames]);
  const filterSourceOptions = [...new Set(records.map((x) => x.source).filter(Boolean))];
  const openList = (name: string) => {
    setActiveKasa("");
    setSource("Tümü");
    setSearch(name);
    setActiveList(name);
    setShowAllLists(false);
  };
  const openCardRecord = (
    field: "source" | "listName",
    value: string,
    matchKind?: Kind,
  ) => {
    const candidates = records.filter((x) =>
      field === "source"
        ? x.source === value && (!matchKind || x.kind === matchKind)
        : listOf(x) === value,
    );
    const rec = [...candidates].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (rec) onEdit(rec);
  };
  // Liste ile ilişkilendirilen kayıtlar üst (ana) satırda kendi kartını
  // oluşturmaz — sadece aşağıdaki sarı "Tüm Liste ..." satırında görünür
  // (bkz. listGroups). Bir kasaya bağlı gelir/gider (linkedIncomeRows/
  // linkedExpenseRows) bu kuralın dışında tutulur: o para gerçekten o
  // kasaya girip çıktığı için, liste etiketli olsa bile kasanın üstteki
  // gerçek bakiyesinden düşülmemesi/eklenmemesi yanlış olur.
  const groups = useMemo(
    () =>
      // Gelir sayfasında kasanın kendi adıyla açılan kayıt kutuları (ör. "Ana -Kasa") ayrı kasa kutusunda (ör. "Ana -Kasa Gelirleri")
      // zaten toplandığı için burada tekrar edilmez.
      // Excel aktarımıyla gelen kayıtlar (yüzlerce ürün/kalem başlığı olabilir) tek tek kutu oluşturmaz; kasa kutusunda toplanır.
      [...new Set(records.filter((x) => !listOf(x) && !(kind !== "cash" && x.importBatch) && !(kind === "cash" && (kasaRjNames.has(x.source) || kasaSectionNames.has(x.source)))).map((x) => x.source))]
        .filter((name) => !(kind !== "cash" && cashAccounts.some((a) => a.name === name)))
        .map((name) => {
        const directRows = records.filter((x) => x.source === name && !listOf(x) && !(kind !== "cash" && x.importBatch));
        const linkedIncomeRows =
          kind === "cash"
            ? allRecords.filter((x) => x.kind === "income" && x.cashAccount === name)
            : [];
        const linkedExpenseRows =
          kind === "cash"
            ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount === name)
            : [];
        const directAmount = total(directRows);
        const linkedIncome = total(linkedIncomeRows);
        const linkedExpense = total(linkedExpenseRows);
        return {
          name,
          kind: records.find((x) => x.source === name)?.kind ?? kind,
          kasas: [...new Set(directRows.map((r) => r.cashAccount).filter(Boolean))],
          count: directRows.length + linkedIncomeRows.length + linkedExpenseRows.length,
          totalIn: directAmount + linkedIncome,
          totalOut: linkedExpense,
          total: directAmount + linkedIncome - linkedExpense,
          totalInByCurrency: combineByCurrency([{ rows: directRows }, { rows: linkedIncomeRows }]),
          totalOutByCurrency: combineByCurrency([{ rows: linkedExpenseRows }]),
          totalByCurrency: combineByCurrency([
            { rows: directRows },
            { rows: linkedIncomeRows },
            { rows: linkedExpenseRows, sign: -1 },
          ]),
        };
      }),
    [records, allRecords, kind, cashAccounts, kasaRjNames, kasaSectionNames, listOf],
  );
  // Kart satırı flex-wrap olduğu için genişlik yeterliyse zaten hepsi
  // görünür — önceden ilk 4'ten sonrasını "Diğer Kasalar" açılır menüsünde
  // gizliyorduk, ekran dar olmasa bile. Artık tüm kartlar render ediliyor;
  // dar ekranda tarayıcı bunları kendiliğinden alt satıra sarar.
  // Kasa kartının üzerine gelince: kasanın aylık gelir / gider / sonuç özeti (son 3 ay).
  const monthlyOfKasa = (name: string) => {
    const byMonth = new Map<string, RecordItem[]>();
    for (const x of allRecords) {
      if ((x.kind !== "income" && x.kind !== "expense") || x.cashAccount !== name) continue;
      const key = x.date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), x]);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3)
      .map(([month, rows]) => {
        const inc = rows.filter((x) => x.kind === "income");
        const exp = rows.filter((x) => x.kind === "expense");
        return { month, inc: combineByCurrency([{ rows: inc }]), exp: combineByCurrency([{ rows: exp }]), res: combineByCurrency([{ rows: inc }, { rows: exp, sign: -1 }]) };
      });
  };
  const renderGroupTooltip = (g: CardGroup, matchingAccount: CashAccountSummary | undefined) => (
    <div className="groupCardTooltip">
      {g.kind === "cash" ? (
        <>
          <div>
            <small>{tx(language, "Kasa Oluşturucu", "Kasa Owner", "Vekera Qaseyê")}</small>
            <strong>{matchingAccount?.ownerName || tx(language, "Belirtilmedi", "Unassigned", "Nehatiye diyarkirin")}</strong>
          </div>
          <div>
            <small>{tx(language, "Toplam Kasa", "Total In", "Giştî")}</small>
            <strong>{moneyBreakdown(g.totalInByCurrency)}</strong>
          </div>
          <div>
            <small>{tx(language, "Gider", "Expense", "Mesref")}</small>
            <strong className="negative">{moneyBreakdown(g.totalOutByCurrency)}</strong>
          </div>
          <div>
            <small>{tx(language, "Sonuç", "Result", "Encam")}</small>
            <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
          </div>
          {monthlyOfKasa(g.name).length > 0 && (
            <table className="tooltipMonths">
              <thead>
                <tr>
                  <th>{tx(language, "Ay", "Month", "Meh")}</th>
                  <th>{tx(language, "Gelir", "Income", "Dahat")}</th>
                  <th>{tx(language, "Gider", "Expense", "Mesref")}</th>
                  <th>{tx(language, "Sonuç", "Result", "Encam")}</th>
                </tr>
              </thead>
              <tbody>
                {monthlyOfKasa(g.name).map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="in">{moneyBreakdown(m.inc)}</td>
                    <td className="negative">{moneyBreakdown(m.exp)}</td>
                    <td>{moneyBreakdown(m.res)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <div>
            <small>
              {g.kind === "income"
                ? tx(language, "Toplam Gelir", "Total Income", "Dahata Giştî")
                : tx(language, "Toplam Gider", "Total Expense", "Mesrefa Giştî")}
            </small>
            <strong className={g.kind === "expense" ? "negative" : ""}>
              {moneyBreakdown(g.totalByCurrency)}
            </strong>
          </div>
          <div>
            <small>{tx(language, "Kayıt Sayısı", "Record Count", "Hejmara Qeydan")}</small>
            <strong>{g.count}</strong>
          </div>
        </>
      )}
    </div>
  );
  const renderKasaCard = (g: CardGroup, tone?: { background: string; borderColor: string }) => {
    const matchingAccount = cashAccounts.find((a) => a.name === g.name);
    return (
      <div className="groupCard" key={g.name}>
        <button
          className={source === g.name && !showAllLists ? "selected" : ""}
          style={tone}
          onClick={() => {
            // Çalışma alanı açık kalır: diğer kasalar arasında geçiş yapılabilsin.
            setSource(g.name);
            setActiveKasa("");
            setShowAllLists(false);
          }}
        >
          <b>{localizeData(g.name, language)} <span className="groupCount">({g.count})</span></b>
          <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
          <span className="groupInOut">
            <span className="in">↗ {moneyBreakdown(g.totalInByCurrency)}</span>
            <span className="out">↘ {moneyBreakdown(g.totalOutByCurrency)}</span>
          </span>
        </button>
        {!readOnly && source === g.name && (
          <button
            className="cashEditIcon"
            title={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
            aria-label={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
            onClick={() => openCardRecord("source", g.name, "cash")}
          >
            🗂
          </button>
        )}
        {source === g.name && matchingAccount && (
          <button
            className="cashEditIcon"
            title={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
            aria-label={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
            onClick={() => setShareTarget(matchingAccount)}
          >
            🔗
          </button>
        )}
        {kasaActions(g.name, source === g.name && !showAllLists)}
        {renderGroupTooltip(g, matchingAccount)}
      </div>
    );
  };
  const workspacePalette = ["#315fe8", "#1f8a5b", "#7b52bf", "#c0562b", "#b9951c", "#3a5fb0", "#a8386b"];
  // window.prompt masaüstü uygulamasında çalışmadığı için ad uygulama içi pencereden alınır.
  async function createWorkspace() {
    const name = newWorkspaceName.trim();
    if (!name) return;
    setNewWorkspaceBusy(true);
    setNewWorkspaceError("");
    try {
      const response = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "cash", name, color: workspacePalette[cashSections.length % workspacePalette.length], ...(newWorkspaceParent ? { parentKey: newWorkspaceParent } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setNewWorkspaceError(
          response.status === 403
            ? tx(language, "Çalışma alanını yalnızca yönetici oluşturabilir.", "Only an administrator can create a workspace.", "Qada xebatê tenê rêvebir dikare çêke.")
            : response.status === 409
              ? tx(language, "Bu adla bir çalışma alanı / bölüm zaten var.", "A workspace / section with this name already exists.", "Qada xebatê / beşa bi vî navî heye.")
              : body.error || tx(language, "Çalışma alanı oluşturulamadı.", "The workspace could not be created.", "Qada xebatê nehat çêkirin."),
        );
        return;
      }
      setNewWorkspaceOpen(false);
      setNewWorkspaceName("");
      setNewWorkspaceParent("");
      onRefreshData?.();
    } catch {
      setNewWorkspaceError(tx(language, "Çalışma alanı oluşturulamadı.", "The workspace could not be created.", "Qada xebatê nehat çêkirin."));
    } finally {
      setNewWorkspaceBusy(false);
    }
  }
  // Overall pill total, computed per currency directly from the record
  // arrays (not by summing groups' already-blended totals) so mixed
  // currencies show as separate amounts instead of one wrong number.
  // "Tüm Kasalar" toplamı: Listeler ile ilişkili (Liste Kasası) kasalar burada değil, "Tüm Liste Kasaları"nda sayılır.
  const overallByCurrency = useMemo(
    () =>
      combineByCurrency([
        { rows: records },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "income" && x.cashAccount) : [] },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount) : [], sign: -1 },
      ]),
    [records, allRecords, kind],
  );
  const listedRecords = useMemo(() => records.filter((x) => listOf(x)), [records, listOf]);
  const listGroups = useMemo(
    () =>
      [...new Set(records.map((x) => listOf(x)).filter(Boolean))].map(
        (name) => {
          const directRows = records.filter((x) => listOf(x) === name);
          const linkedIncomeRows =
            kind === "cash"
              ? allRecords.filter((x) => x.kind === "income" && (x.listName === name || (kasaListNames.has(name) && x.cashAccount === name)))
              : [];
          const linkedExpenseRows =
            kind === "cash"
              ? allRecords.filter((x) => x.kind === "expense" && (x.listName === name || (kasaListNames.has(name) && x.cashAccount === name)))
              : [];
          const directAmount = total(directRows);
          const linkedIncome = total(linkedIncomeRows);
          const linkedExpense = total(linkedExpenseRows);
          return {
            name,
            count: records.filter((x) => listOf(x) === name).length,
            totalIn: directAmount + linkedIncome,
            totalOut: linkedExpense,
            total: directAmount + linkedIncome - linkedExpense,
            totalInByCurrency: combineByCurrency([{ rows: directRows }, { rows: linkedIncomeRows }]),
            totalOutByCurrency: combineByCurrency([{ rows: linkedExpenseRows }]),
            totalByCurrency: combineByCurrency([
              { rows: directRows },
              { rows: linkedIncomeRows },
              { rows: linkedExpenseRows, sign: -1 },
            ]),
          };
        },
      ),
    [records, allRecords, kind, kasaListNames, listOf],
  );
  // Kasa kutusu satırı (eskiden ayrı bir kasaBoxes hesabı vardı; yalnız türü kullanılıyordu).
  type KasaBox = { name: string; count: number; totalByCurrency: ReturnType<typeof combineByCurrency>; amount: number };
  // "Tüm Kasalar" / "Tüm Liste Kasaları" kutuları da tek tek kasa kartları gibi gelir ↗ ve gider ↘ satırını gösterir.
  const overallInOut = useMemo(() => {
    const incomeRows = kind === "cash" ? allRecords.filter((x) => x.kind === "income" && x.cashAccount) : [];
    const expenseRows = kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount) : [];
    return { inBy: combineByCurrency([{ rows: records }, { rows: incomeRows.filter((x) => !isDebtLeg(x)) }]), outBy: combineByCurrency([{ rows: expenseRows.filter((x) => !isDebtLeg(x)) }]) };
  }, [records, allRecords, kind]);
  // Gelir/Gider sayfalarında liste kayıtları, genel yönteme uygun olarak liste adına göre değil bağlı oldukları (Liste)
  // kasaya göre kutulanır: "DL-2026 Giderleri" gibi; kutuda o kasanın listeleri etiket olarak görünür.
  const listKasaBoxes = useMemo(() => {
    if (kind === "cash") return [];
    const byKasa = new Map<string, RecordItem[]>();
    for (const x of records) {
      if (!(listOf(x) || isListLinked(x))) continue;
      const k = x.cashAccount || x.source;
      byKasa.set(k, [...(byKasa.get(k) ?? []), x]);
    }
    return [...byKasa.entries()]
      .map(([name, rows]) => ({
        name,
        count: rows.length,
        amount: total(rows),
        totalByCurrency: combineByCurrency([{ rows }]),
        lists: [...new Set(rows.map((r) => r.listName).filter(Boolean))],
      }))
      .filter((b) => Math.abs(b.amount) > 0.004)
      .sort((a, b) => b.amount - a.amount);
  }, [records, kind, isListLinked, listOf]);
  // Çalışma alanları (Kasalar sayfası): Genel Kasalar, Liste Kasaları, RJ-Kasaları ve Ayarlar > Çalışma Alanları'ndan oluşturulanlar.
  // Her kasa yalnızca bir alanda görünür: önce seçili çalışma alanı, yoksa Liste Kasası / RJ-Kasası işareti, yoksa Genel Kasalar.
  const cashWorkspaces = useMemo(() => {
    if (kind !== "cash") return [];
    const names = [...new Set([...cashAccounts.map((a) => a.name), ...records.map((x) => x.source)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    type Card = CardGroup & { direct: RecordItem[]; inc: RecordItem[]; exp: RecordItem[] };
    type Ws = { key: string; name: string; color: string; kasas: Card[]; parentKey?: string | null };
    const buckets: Ws[] = [
      { key: "genel", name: tx(language, "Diğer", "Other", "Yên din"), color: "#315fe8", kasas: [] },
      { key: "liste", name: tx(language, "Liste Kasaları", "List Cash Accounts", "Qaseyên Lîsteyê"), color: "#b9951c", kasas: [] },
      { key: "rj", name: tx(language, "RJ-Kasaları", "RJ Cash Accounts", "Qaseyên RJ"), color: "#7b52bf", kasas: [] },
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, parentKey: section.parentKey ?? null, kasas: [] as Card[] })),
    ];
    for (const name of names) {
      const direct = records.filter((x) => x.source === name);
      const inc = allRecords.filter((x) => x.kind === "income" && x.cashAccount === name);
      const exp = allRecords.filter((x) => x.kind === "expense" && x.cashAccount === name);
      const card: Card = {
        name,
        kind: "cash",
        count: direct.length + inc.length + exp.length,
        totalInByCurrency: combineByCurrency([{ rows: direct }, { rows: inc.filter((x) => !isDebtLeg(x)) }]),
        totalOutByCurrency: combineByCurrency([{ rows: exp.filter((x) => !isDebtLeg(x)) }]),
        totalByCurrency: combineByCurrency([{ rows: direct }, { rows: inc }, { rows: exp, sign: -1 }]),
        direct,
        inc,
        exp,
      };
      const account = accountOf.get(name);
      const key = account?.sectionId != null && cashSections.some((x) => x.id === account.sectionId)
        ? `sec-${account.sectionId}`
        : account?.isListWorkspace ? "liste" : account?.isRjKasa ? "rj" : "genel";
      buckets.find((b) => b.key === key)?.kasas.push(card);
    }
    // Elle sıralama (Kasa Kontrol Merkezi): sortOrder > 0 olan kasalar önce, kendi sırasıyla; kalanlar adla.
    const orderOf = (name: string) => accountOf.get(name)?.sortOrder || 0;
    for (const b of buckets) b.kasas.sort((a, c) => (orderOf(a.name) || 1e9) - (orderOf(c.name) || 1e9));
    // Bölümler: başka bir çalışma alanının içine taşınan alanlar ana listede ayrı kutu olmaz; üst alanın içinde "bölüm" olarak görünür
    // ve toplamları üst alana dahil edilir.
    const calc = (kasas: Card[]) => {
      const parts = kasas.flatMap((k) => [{ rows: k.direct }, { rows: k.inc }]);
      const opParts = kasas.flatMap((k) => [{ rows: k.direct }, { rows: k.inc.filter((x) => !isDebtLeg(x)) }]);
      return {
        count: kasas.reduce((a, k) => a + k.count, 0),
        inBy: combineByCurrency(opParts),
        outBy: combineByCurrency(kasas.map((k) => ({ rows: k.exp.filter((x) => !isDebtLeg(x)) }))),
        totalBy: combineByCurrency([...parts, ...kasas.map((k) => ({ rows: k.exp, sign: -1 }))]),
      };
    };
    const known = new Set(buckets.map((b) => b.key));
    const isChild = (b: Ws) => Boolean(b.parentKey) && known.has(b.parentKey as string);
    return buckets
      .filter((b) => !isChild(b))
      .sort((a, c) => {
        const ia = workspaceOrder.indexOf(a.key), ic = workspaceOrder.indexOf(c.key);
        return (ia < 0 ? 1e9 : ia) - (ic < 0 ? 1e9 : ic);
      })
      .filter((b) => b.kasas.length > 0 || b.key.startsWith("sec-") || b.key === "genel" || buckets.some((s) => s.parentKey === b.key))
      .map((b) => {
        const subs = buckets
          .filter((s) => s.parentKey === b.key)
          .sort((x, y) => (sections.find((q) => `sec-${q.id}` === x.key)?.sortOrder || 1e9) - (sections.find((q) => `sec-${q.id}` === y.key)?.sortOrder || 1e9))
          .map((s) => ({ ...s, ...calc(s.kasas) }));
        const allKasas = [...b.kasas, ...subs.flatMap((s) => s.kasas)];
        return { ...b, subs, allKasas, ...calc(allKasas) };
      });
  }, [records, allRecords, kind, cashAccounts, sections, cashSections, language, workspaceOrder]);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [subWs, setSubWs] = useState(activeWs);
  if (subWs !== activeWs) {
    setSubWs(activeWs);
    setActiveSub(null);
  }
  const activeWsObj = cashWorkspaces.find((w) => w.key === activeWs);
  const activeSubObj = activeSub ? activeWsObj?.subs.find((s) => s.key === activeSub) ?? null : null;
  const activeWsNames = new Set((activeSubObj ? activeSubObj.kasas : activeWsObj?.allKasas ?? []).map((k) => k.name));
  // Gelir/Gider sayfaları: kasa kutuları çalışma alanlarına göre gruplanır; üstte yalnızca alan kutuları görünür (ekran şişmesin),
  // bir alana basınca o alanın kasaları altta açılır. Bu sayfadaki türde (gelir/gider) kaydı olmayan alanlar gösterilmez.
  const ieWorkspaces = useMemo(() => {
    if (kind === "cash") return [];
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    const buckets = [
      { key: "genel", name: tx(language, "Diğer", "Other", "Yên din"), color: "#315fe8", kasas: [] as KasaBox[] },
      { key: "liste", name: tx(language, "Liste Kasaları", "List Cash Accounts", "Qaseyên Lîsteyê"), color: "#b9951c", kasas: [] as KasaBox[] },
      { key: "rj", name: tx(language, "RJ-Kasaları", "RJ Cash Accounts", "Qaseyên RJ"), color: "#7b52bf", kasas: [] as KasaBox[] },
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, kasas: [] as KasaBox[] })),
    ];
    const rowsByKasa = new Map<string, RecordItem[]>();
    for (const x of records) if (x.cashAccount) rowsByKasa.set(x.cashAccount, [...(rowsByKasa.get(x.cashAccount) ?? []), x]);
    for (const [name, rows] of rowsByKasa) {
      const account = accountOf.get(name);
      const key = account?.sectionId != null && cashSections.some((x) => x.id === account.sectionId)
        ? `sec-${account.sectionId}`
        : account?.isListWorkspace ? "liste" : account?.isRjKasa ? "rj" : "genel";
      buckets.find((b) => b.key === key)?.kasas.push({ name, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]), amount: total(rows) });
    }
    return buckets
      .filter((b) => b.kasas.length > 0)
      .map((b) => {
        const rows = b.kasas.flatMap((k) => rowsByKasa.get(k.name) ?? []);
        return { ...b, kasas: [...b.kasas].sort((a, c) => c.amount - a.amount), count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
      });
  }, [records, kind, cashAccounts, cashSections, language]);
  const activeIeWorkspace = kind !== "cash" && activeIeWs ? ieWorkspaces.find((w) => w.key === activeIeWs) ?? null : null;
  const activeIeNames = new Set((activeIeWorkspace?.kasas ?? []).map((k) => k.name));
  // Gelir/Gider bölüm kutuları: her bölüm için bir kutu (o bölümdeki kayıtların toplamı).
  const sectionBoxes = useMemo(
    () =>
      kind === "cash"
        ? []
        : sections
            .filter((x) => x.scope === kind)
            .map((section) => {
              const rows = records.filter((x) => x.sectionId === section.id);
              return { section, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
            }),
    [records, kind, sections],
  );
  // "Tüm Kasalar" seçiliyken (activeWs === "__all") çalışma alanlarına dağıtılmış tüm kasalar tek sırada, kendi alanının renginde gösterilir.
  const activeWorkspace = kind === "cash" && activeWs && activeWs !== "__all" ? cashWorkspaces.find((w) => w.key === activeWs) ?? null : null;
  const activeKasaCards: { g: CardGroup; color: string }[] =
    kind !== "cash" || !activeWs
      ? []
      : activeWs === "__all"
        ? cashWorkspaces.flatMap((w) => [...w.kasas.map((g) => ({ g, color: w.color })), ...w.subs.flatMap((s) => s.kasas.map((g) => ({ g, color: s.color })))]).sort((a, b) => a.g.name.localeCompare(b.g.name))
        : (activeWorkspace?.kasas ?? []).map((g) => ({ g, color: activeWorkspace!.color }));
  const overallListInOut = useMemo(() => {
    const incomeRows = kind === "cash" ? allRecords.filter((x) => x.kind === "income" && isListLinked(x)) : [];
    const expenseRows = kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && isListLinked(x)) : [];
    return { inBy: combineByCurrency([{ rows: listedRecords }, { rows: incomeRows }]), outBy: combineByCurrency([{ rows: expenseRows }]) };
  }, [listedRecords, allRecords, kind, isListLinked]);
  const overallListByCurrency = useMemo(
    () =>
      combineByCurrency([
        { rows: listedRecords },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "income" && isListLinked(x)) : [] },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && isListLinked(x)) : [], sign: -1 },
      ]),
    [listedRecords, allRecords, kind, isListLinked],
  );
  // Belirli bir kasa seçildiğinde (source !== "Tümü"), o kasanın kart
  // toplamına dahil edilen ama `records`'ta (sadece kind="cash" satırları)
  // bulunmayan bağlı gelir/gider kayıtlarını da listeye kat — aksi halde
  // "Toplam Kasa" tutarı bu kayıtları sayar ama liste onları hiç göstermez
  // (bildirilen hata tam olarak buydu).
  const linkedRowsForSelectedKasa =
    kind === "cash" && source !== "Tümü"
      ? allRecords.filter((x) => (x.kind === "income" || x.kind === "expense") && x.cashAccount === source)
      : [];
  const rows = [...records, ...linkedRowsForSelectedKasa].filter(
    (x) =>
      (source === "Tümü" || source === "__RJ" || x.source === source || x.cashAccount === source) &&
      (!showAllLists || listOf(x) || isListLinked(x)) &&
      (!activeKasa || x.cashAccount === activeKasa) &&
      (!activeIeWorkspace || activeIeNames.has(x.cashAccount)) &&
      (activeSection === null || x.sectionId === activeSection) &&
      (activeWs === null || activeWs === "__all" || kind !== "cash" || activeWsNames.has(x.cashAccount || x.source)) &&
      (source !== "__RJ" || kasaRjNames.has(x.cashAccount || x.source)) &&
      (!filterFrom || x.date >= filterFrom) &&
      (!filterTo || x.date <= filterTo) &&
      (!filterSource || x.source === filterSource) &&
      (!filterPerson || x.person.toLowerCase().includes(filterPerson.toLowerCase())) &&
      (!filterProject || x.project.toLowerCase().includes(filterProject.toLowerCase())) &&
      (!filterTag || x.tags.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))) &&
      JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
  );
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sortMode) {
        case "dateAsc":
          return a.date.localeCompare(b.date) || a.id - b.id;
        case "addedAsc":
          return a.id - b.id;
        case "addedDesc":
          return b.id - a.id;
        case "dateDesc":
        default:
          return b.date.localeCompare(a.date) || b.id - a.id;
      }
    });
    return copy;
  }, [rows, sortMode]);
  const orderedRows = useMemo(() => {
    if (!rowOrder.length) return sortedRows;
    const index = new Map(rowOrder.map((id, i) => [id, i]));
    return [...sortedRows].sort((a, b) => {
      const ai = index.has(a.id) ? index.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b.id) ? index.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [sortedRows, rowOrder]);
  // Satır sürükleme — native HTML5 drag-and-drop (draggable + onDragStart/
  // onDrop) tablo satırlarında (<tr>) tarayıcılar arasında güvenilir çalışmadığı
  // için (sürükleme hiç başlamayabiliyor), fare olaylarıyla elle takip edilen
  // aynı yöntem kullanılıyor — bkz. shared.tsx'teki useDraggableModals.
  function startRowDrag(e: ReactMouseEvent, id: number) {
    e.preventDefault();
    setDraggedRowId(id);
    document.body.classList.add("noSelectDragging");
    function onMove(ev: MouseEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const rowEl = el?.closest("tr[data-row-id]") as HTMLElement | null;
      setDragOverRowId(rowEl ? Number(rowEl.dataset.rowId) : null);
    }
    function onUp(ev: MouseEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const rowEl = el?.closest("tr[data-row-id]") as HTMLElement | null;
      const targetId = rowEl ? Number(rowEl.dataset.rowId) : null;
      if (targetId !== null) moveRow(id, targetId);
      setDraggedRowId(null);
      setDragOverRowId(null);
      document.body.classList.remove("noSelectDragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  function moveRow(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const currentIds = orderedRows.map((r) => r.id);
    const from = currentIds.indexOf(draggedId);
    const to = currentIds.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...currentIds];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    persistRowOrder(next);
  }
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
  const rowIdsKey = rows.map((x) => x.id).join(",");
  async function refreshCommentSummaries() {
    if (!rowIdsKey) {
      setCommentSummaries({});
      return;
    }
    try {
      const response = await fetch(`/api/comments/summary?ids=${rowIdsKey}`);
      const data = await response.json().catch(() => ({}));
      setCommentSummaries(response.ok ? (data.summaries ?? {}) : {});
    } catch {
      setCommentSummaries({});
    }
  }
  // Powers the 💬 icon's hover preview (only shown once a record has ≥1
  // comment) — refetched whenever the visible row set changes, and again
  // right after the comment modal closes so a just-added comment shows up.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yükleme/periyodik tazeleme; setState fetch sonucunda çalışır
    refreshCommentSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdsKey]);
  const title =
    kind === "cash"
      ? tx(language, "Kasa Kontrol Merkezi", "Cash Control Center", "Navenda Kontrola Qaseyan")
      : kind === "income"
        ? tx(language, "Gelirler", "Income", "Dahat")
        : tx(language, "Giderler", "Expenses", "Mesref");
  const recordWord = tx(language, "kayıt", "records", "qeyd");
  async function exportExcel(rowsToExport: RecordItem[] = orderedRows, suffix = "") {
    const columns = [
      tx(language, "Tarih", "Date", "Tarîx"),
      kind === "cash"
        ? tx(language, "Kasa Adı", "Cash Account", "Navê Qaseyê")
        : tx(language, "Ana Başlık", "Category", "Sernav"),
      tx(language, "Detay", "Detail", "Hûragahî"),
      tx(language, "Not", "Note", "Nîşe"),
      tx(language, "Kişi", "Person", "Kes"),
      tx(language, "Miktar", "Amount", "Meblağ"),
      tx(language, "Para Birimi", "Currency", "Yekeya Pere"),
      tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne"),
      tx(language, "Etiketler", "Tags", "Etîket"),
      tx(language, "Tür", "Type", "Cure"),
      tx(language, "Kasa", "Cash Account", "Qase"),
    ];
    const workbook = await newWorkbook();
    const sheet = workbook.addWorksheet("Kayitlar");
    sheet.addRow(columns);
    for (const x of rowsToExport) {
      sheet.addRow([
        date(x.date),
        x.source,
        x.detail,
        x.note,
        x.person,
        x.amount,
        x.currency,
        x.project,
        x.tags.join(", "),
        x.kind === "income" ? tx(language, "Gelir", "Income", "Dahat") : x.kind === "expense" ? tx(language, "Gider", "Expense", "Mesref") : tx(language, "Kasa", "Cash", "Qase"),
        x.kind === "cash" ? x.source : x.cashAccount,
      ]);
    }
    const safeName = (source === "Tümü" ? title : source).replace(/[\\/:*?"<>|]/g, "-");
    await downloadWorkbook(workbook, `${safeName}${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  async function importExcel(file?: File) {
    if (!file) return;
    try {
      const workbook = await newWorkbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error();
      const headerRow = sheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber] = String(cell.value ?? "").trim();
      });
      const raw: { rowNumber: number; row: Record<string, unknown> }[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: Record<string, unknown> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber];
          if (!header) return;
          const value = cell.value;
          record[header] = value && typeof value === "object" && "text" in (value as object)
            ? (value as { text: string }).text
            : value ?? "";
        });
        raw.push({ rowNumber, row: record });
      });
      const invalidDateRows: number[] = [];
      const imported = raw
        .map(({ rowNumber, row }): (Omit<RecordItem, "id"> & { rowNumber: number }) | null => {
          const values = Object.values(row);
          const get = (...names: string[]) => {
            for (const name of names)
              if (row[name] !== undefined && row[name] !== "") return row[name];
            return "";
          };
          const excelDate = get("Tarih", "Date", "Tarîx");
          // Import is the one place a bad date shouldn't silently become
          // "today" — that would misfile a transaction under the wrong day
          // without anyone noticing. Reject the row instead.
          const parsedDate = parseImportDate(excelDate || values[0]);
          if (!parsedDate) {
            invalidDateRows.push(rowNumber);
            return null;
          }
          const resolvedSource =
            source !== "Tümü"
              ? source
              : String(
                  get(
                    "Kasa Adı",
                    "Cash Account",
                    "Navê Qaseyê",
                    "Ana Başlık",
                    "Category",
                    "Sernav",
                  ) ||
                    values[1] ||
                    "Excel Aktarımı",
                );
          return {
            rowNumber,
            kind,
            date: parsedDate,
            source: resolvedSource,
            detail: String(
              get("Detay", "Detail", "Hûragahî") || values[2] || "",
            ),
            note: String(get("Not", "Note", "Nîşe") || ""),
            person: String(get("Kişi", "Person", "Kes") || ""),
            amount: Number(get("Miktar", "Amount", "Meblağ") || 0),
            currency: String(
              get("Para Birimi", "Currency", "Yekeya Pere") || "USD",
            ),
            project: String(
              get("Proje / Birim", "Project / Unit", "Proje / Yekîne") || "",
            ),
            tags: String(get("Etiketler", "Tags", "Etîket") || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            cashAccount: kind === "cash" ? "" : resolvedSource,
            listName: "",
          };
        })
        .filter((x): x is Omit<RecordItem, "id"> & { rowNumber: number } => x !== null && Boolean(x.source) && Number.isFinite(x.amount))
        .map(({ rowNumber: _rowNumber, ...record }) => record);
      if (!imported.length && !invalidDateRows.length) throw new Error();

      const duplicateCount = imported.filter((x) =>
        records.some((existing) => existing.date === x.date && existing.amount === x.amount && existing.currency === x.currency && existing.source === x.source),
      ).length;
      if (duplicateCount > 0) {
        const proceed = window.confirm(
          tx(
            language,
            `İçe aktarılacak ${imported.length} kayıttan ${duplicateCount} tanesi mevcut kayıtlarla aynı tarih, tutar ve başlığa sahip. Yine de içe aktarmak istiyor musunuz?`,
            `${duplicateCount} of the ${imported.length} rows to import match an existing record's date, amount and title. Import anyway?`,
            `${duplicateCount} ji ${imported.length} rêzên ku dê werin têxistin, bi heman tarîx, meblağ û sernavê qeydek heyî re li hev in. Dîsa jî têxistin?`,
          ),
        );
        if (!proceed) return;
      }

      if (imported.length) onImport(imported);
      const skippedNote = invalidDateRows.length
        ? tx(
            language,
            ` (${invalidDateRows.length} satır geçersiz tarih nedeniyle atlandı: satır ${invalidDateRows.join(", ")})`,
            ` (${invalidDateRows.length} row(s) skipped for invalid dates: row ${invalidDateRows.join(", ")})`,
            ` (${invalidDateRows.length} rêz ji ber tarîxa nederbasdar hatin derbasqilkirin: rêz ${invalidDateRows.join(", ")})`,
          )
        : "";
      notify(
        tx(
          language,
          `${imported.length} kayıt Excel'den eklendi.${skippedNote}`,
          `${imported.length} records imported from Excel.${skippedNote}`,
          `${imported.length} qeyd ji Excelê hatin têxistin.${skippedNote}`,
        ),
        "success",
      );
    } catch {
      notify(
        tx(
          language,
          "Excel dosyası okunamadı. Lütfen ilk satırda sütun başlıkları bulunan .xlsx dosyası seçin.",
          "The Excel file could not be read. Choose an .xlsx file with column headers in the first row.",
          "Pelê Excelê nehat xwendin. Pelek .xlsx ku di rêza yekem de sernavên stûnan heye hilbijêre.",
        ),
      );
    }
  }
  // Tek bir kolgroup/thead/tbody bloğu üretir — sütun sırası/genişliği ve
  // satır sürükleme tüm tablolarda aynı davransın diye Kasa detayındaki
  // Gelir/Gider ayrımında da (bkz. aşağıdaki kasaResultSplit) bu fonksiyon
  // yeniden kullanılıyor, tek bir birleşik tabloda da.
  function renderRecordsTable(tableRows: RecordItem[]) {
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
                  <span className="colHeaderLabel">{columnLabel(id)}</span>
                  <span
                    className="colResizeHandle"
                    draggable={false}
                    // eslint-disable-next-line react-hooks/refs -- ref yalnız fare olayında (startResize içinde) kullanılır, render sırasında değil
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
              const pendingTransfer =
                kind !== "cash" ? cashTransfers.find((t) => t.toRecordId === x.id && t.status === "pending") : undefined;
              const canApprove = pendingTransfer && cashAccounts.some((a) => a.id === pendingTransfer.toCashAccountId);
              return (
                <tr
                  key={x.id}
                  data-row-id={x.id}
                  className={`${selectedIds.has(x.id) ? "rowSelected " : ""}${pendingTransfer ? "pendingTransferRow" : ""}${draggedRowId === x.id ? " rowDragging" : ""}${dragOverRowId === x.id && draggedRowId !== null && draggedRowId !== x.id ? " rowDragOver" : ""}`}
                >
                  <td className="selectCell">
                    <input type="checkbox" aria-label={tx(language, "Satırı seç", "Select row", "Rêzê hilbijêre")} checked={selectedIds.has(x.id)} onChange={(e) => toggleMany([x], e.target.checked)} />
                  </td>
                  {cols.map((id) => (
                    <td key={id} className={columnCellClassName(id)}>
                      {renderCell(id, x, { pendingTransfer, canApprove })}
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
  // Bir kasa seçildiğinde (source !== "Tümü"), Gelir ve Gider kayıtları aynı
  // tabloda karışık görünmesin diye iki ayrı kutuya bölünür — kullanıcı
  // hangisinin gelir hangisinin gider olduğunu tabloya bakmadan, kutunun
  // rengi ve başlığından anlar. "Tümü" görünümünde ve Gelir/Gider
  // sayfalarında (kind !== "cash") tek, birleşik tablo olarak kalır.
  const kasaSplitActive = kind === "cash" && source !== "Tümü";
  // Kasalar sayfası: açılışta "kasa panosu" (boardMode), bir kasa seçilince kasanın kendi sayfası (detailMode).
  // Liste bağlamıyla açılan eski görünüm (activeList / showAllLists / activeKasa) olduğu gibi kalır.
  // Kasa Kontrol Merkezi yönetimi: sıralama kaydı, alan/bölüm düzenleme + yetkiler, bölüm/kasa ekleme.
  async function saveOrder(payload: { workspaces?: string[]; sections?: number[]; kasas?: number[] }) {
    try {
      const response = await fetch("/api/cash-order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notify(body.error || tx(language, "Sıralama kaydedilemedi.", "The order could not be saved.", "Rêz nehat tomarkirin."));
        return;
      }
      onRefreshData?.();
    } catch {
      notify(tx(language, "Sıralama kaydedilemedi.", "The order could not be saved.", "Rêz nehat tomarkirin."));
    }
  }
  function editWorkspaceOrSection(key: string, name: string, kasaNames: string[]) {
    const title = `${name} — ${tx(language, "Düzenle ve kimler görebilir?", "Edit and who can see it?", "Biguherîne û kî dikare bibîne?")}`;
    setAccessTarget({
      title,
      kasas: kasaNames
        .map((n) => {
          const acc = cashAccounts.find((c) => c.name === n);
          return { id: acc?.id ?? 0, name: n, ownerUserId: acc?.ownerUserId ?? null };
        })
        .filter((k) => k.id > 0),
      section: key.startsWith("sec-") ? sections.find((x) => x.id === Number(key.slice(4))) : undefined,
    });
  }
  const boardMode = kind === "cash" && source === "Tümü" && !activeList && !showAllLists && !activeKasa;
  const detailMode = kasaSplitActive;
  const boardActions = (name: string): BoardAction[] => {
    if (readOnly) return [];
    const account = cashAccounts.find((a) => a.name === name);
    if (!account) return [];
    const list: BoardAction[] = [{ label: tx(language, "Kasayı düzenle", "Edit cash account", "Qaseyê biguherîne"), onClick: () => setKasaEditTarget(account) }];
    if (isSuperAdmin) list.push({ label: tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?"), onClick: () => setAccessTarget({ title: `${account.name} — ${tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")}`, kasas: [{ id: account.id, name: account.name, ownerUserId: account.ownerUserId }] }) });
    list.push({ label: tx(language, "Çalışma alanına taşı", "Move to workspace", "Bibe qada xebatê"), onClick: () => setKasaMoveTarget(account) });
    list.push({ label: tx(language, "Kasayı sil", "Delete cash account", "Qaseyê jê bibe"), danger: true, onClick: () => setKasaDeleteTarget(account) });
    return list;
  };
  const detailKasa = detailMode ? cashWorkspaces.flatMap((w) => w.allKasas.map((k) => ({ k, w }))).find((x) => x.k.name === source) : undefined;
  const kasaDebt = kasaSplitActive ? kasaDebtByCurrency(allRecords, source) : {};
  const kasaIncomeRows = kasaSplitActive ? orderedRows.filter((x) => x.kind !== "expense") : [];
  const kasaExpenseRows = kasaSplitActive ? orderedRows.filter((x) => x.kind === "expense") : [];
  // Satır seçimi: seçili satırlar Excel'e çıkarılabilir, kopyalanabilir veya toplu silinebilir.
  const selectedRows = orderedRows.filter((x) => selectedIds.has(x.id));
  // Görünüm (kasa, alan, sayfa) değişince satır seçimi temizlenir; render sırasında, eski seçim hiç görünmeden.
  const selectionScope = JSON.stringify([source, activeWs, activeKasa, kind]);
  const [selectionScopeSeen, setSelectionScopeSeen] = useState(selectionScope);
  if (selectionScopeSeen !== selectionScope) {
    setSelectionScopeSeen(selectionScope);
    setSelectedIds(new Set());
  }
  function toggleMany(list: RecordItem[], on: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const r of list) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }
  async function copySelected() {
    const lines = selectedRows.map((x) => [date(x.date), x.kind === "cash" ? x.source : x.cashAccount, x.source, x.person, x.amount, x.currency, x.tags.join(", ")].join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // Pano erişimi yoksa sessizce geçilir.
    }
  }
  // Gelir/Gider sayfalarındaki "En Son Gelirler/Giderler" panosuyla aynı
  // düzen — kasa seçiliyken de sağda bu kasanın en son 5 hareketi (gelir +
  // gider karışık) görünsün diye, kullanıcının elle sıraladığı orderedRows
  // yerine `rows`'tan bağımsızca en güncel tarihe göre hesaplanır.
  const kasaLatestRows = kasaSplitActive
    ? [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5)
    : [];
  return (
    <div className="panel">
      <div className="toolbar">
        <Title
          title={title}
          inline
          sub={
            kind === "cash"
              ? tx(
                  language,
                  "Bir kasaya tıklayarak hareketlerini görün",
                  "Click a cash account to see its transactions",
                  "Li qaseyekê bitikîne û tevgerên wê bibîne",
                )
              : tx(
                  language,
                  "Ana başlığı seçerek farklı tarihlerdeki hareketleri görün",
                  "Select a main category to view transactions on different dates",
                  "Sernavê sereke hilbijêre û tevgerên tarîxên cuda bibîne",
                )
          }
        />
        <div>
          <div className="excelMenuWrap" onMouseLeave={() => setExcelMenuOpen(false)}>
            <button type="button" className="light excelMenuBtn" onClick={() => setExcelMenuOpen((x) => !x)} aria-expanded={excelMenuOpen} aria-haspopup="menu">
              ▦ {tx(language, "Excel ve Rapor", "Excel and Reports", "Excel û Rapor")} <span aria-hidden="true">⌄</span>
            </button>
            {excelMenuOpen && (
              <div className="excelMenu" role="menu">
                {!readOnly && (
                  <button type="button" role="menuitem" onClick={() => { setExcelMenuOpen(false); importFileRef.current?.click(); }}>
                    <i aria-hidden="true">⇧</i>
                    <span><b>{tx(language, "Excel ekle", "Import Excel", "Excel têxe")}</b><small>{tx(language, "Bu tablonun biçimindeki .xlsx dosyasını kayıt olarak ekler", "Adds an .xlsx file in this table's format as records", "Pelê .xlsx wekî qeyd zêde dike")}</small></span>
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setExcelMenuOpen(false); exportExcel(); }}>
                  <i aria-hidden="true">⇩</i>
                  <span><b>{tx(language, "Excel'e çıkar", "Export to Excel", "Derxe Excelê")}</b><small>{tx(language, "Görünen kayıtları .xlsx olarak indirir", "Downloads the visible records as .xlsx", "Qeydên xuya wekî .xlsx dadixe")}</small></span>
                </button>
                {!readOnly && (
                  <button type="button" role="menuitem" onClick={() => { setExcelMenuOpen(false); onGoUpload?.(); }}>
                    <i aria-hidden="true">▤</i>
                    <span><b>{tx(language, "Rapor yükle", "Upload report", "Raporê barke")}</b><small>{tx(language, "Excel raporunu çalışma alanı ve kasa seçerek aylık kayda çevirir", "Books an Excel report into a workspace and cash account", "Raporê Excel bi hilbijartina qaseyê dike qeyd")}</small></span>
                  </button>
                )}
              </div>
            )}
            {!readOnly && (
              <input
                ref={importFileRef}
                hidden
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  importExcel(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            )}
          </div>
          {kasaSplitActive && (
            <button className="light" onClick={() => setKasaResultOpen(true)}>
              📊 {tx(language, "Sonuç Oluştur", "Create Result", "Encamê Biafirîne")}
            </button>
          )}
          {kind === "cash" && !readOnly && (
            <button className="light" onClick={() => { setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(""); setNewWorkspaceOpen(true); }}>
              ＋ {tx(language, "Çalışma Alanı Ekle", "Add Workspace", "Qada Xebatê Zêde Bike")}
            </button>
          )}
          {!readOnly && (
            <div className="newRecordWrap" style={{ position: "relative" }} onMouseLeave={() => setNewMenuOpen(false)}>
              <button className="primary" onClick={() => setNewMenuOpen((x) => !x)} aria-expanded={newMenuOpen}>
                ＋ {tx(language, "Yeni Kayıt", "New Record", "Qeyda Nû")} ⌄
              </button>
              {newMenuOpen && (
                <div className="profileMenu" style={{ right: 0, left: "auto", top: "100%", minWidth: 180, zIndex: 30 }}>
                  <button onClick={() => { setNewMenuOpen(false); onAdd("income", kasaSplitActive ? source : undefined); }}>
                    ↗ {tx(language, "Gelir Ekle", "Add Income", "Dahat Zêde Bike")}
                  </button>
                  <button onClick={() => { setNewMenuOpen(false); onAdd("expense", kasaSplitActive ? source : undefined); }}>
                    ↘ {tx(language, "Gider Ekle", "Add Expense", "Mesref Zêde Bike")}
                  </button>
                  <button onClick={() => { setNewMenuOpen(false); onAdd("cash", undefined, activeSub ?? (activeWs && activeWs !== "__all" ? activeWs : undefined)); }}>
                    ▣ {tx(language, "Kasa Ekle", "Add Cash Account", "Qase Zêde Bike")}
                  </button>
                  {kind === "cash" && (
                    <>
                      <button onClick={() => { setNewMenuOpen(false); setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(activeWs && activeWs !== "__all" && !activeSub ? activeWs : "genel"); setNewWorkspaceOpen(true); }}>
                        ▤ {tx(language, "Bölüm Ekle", "Add Section", "Beş Zêde Bike")}
                      </button>
                      <button onClick={() => { setNewMenuOpen(false); setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(""); setNewWorkspaceOpen(true); }}>
                        ＋ {tx(language, "Çalışma Alanı Ekle", "Add Workspace", "Qada Xebatê Zêde Bike")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {readOnly && (
        <div className="readOnlyBanner">
          👁 {tx(
            language,
            "Bu, başka bir kullanıcının paylaştığı verilerdir — yalnızca görüntüleyebilirsiniz.",
            "This is another user's shared data — you can only view it.",
            "Ev daneyên bikarhênerek din in ku hatine parvekirin — hûn tenê dikarin bibînin.",
          )}
        </div>
      )}
      {kasaEditTarget && (
        <KasaEditModal
          language={language}
          account={kasaEditTarget}
          sections={sections}
          onClose={() => setKasaEditTarget(null)}
          onDone={() => {
            setSource("Tümü");
            setActiveKasa("");
            onRefreshData?.();
          }}
        />
      )}
      {newWorkspaceOpen && (
        <div className="overlay">
          <div className="modal kasaManageModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <h2>{newWorkspaceParent ? tx(language, "Yeni Bölüm", "New Section", "Beşa Nû") : tx(language, "Yeni Çalışma Alanı", "New Workspace", "Qada Xebatê ya Nû")}</h2>
                <p>{newWorkspaceParent ? tx(language, "Seçtiğiniz çalışma alanının içinde, kasaların önünde görünür.", "Appears inside the chosen workspace, before its cash accounts.", "Di nav qada hilbijartî de, li pêşiya qaseyan xuya dibe.") : tx(language, "ör. Proje Kasaları, Şirketler", "e.g. Project Cash Accounts, Companies", "mînak Qaseyên Projeyê, Şirket")}</p>
              </div>
              <button type="button" onClick={() => setNewWorkspaceOpen(false)}>×</button>
            </div>
            <div className="kasaManageBody">
              <label>
                {newWorkspaceParent ? tx(language, "Bölüm adı", "Section name", "Navê beşê") : tx(language, "Çalışma alanı adı", "Workspace name", "Navê qada xebatê")}
                <input
                  value={newWorkspaceName}
                  maxLength={120}
                  autoFocus
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createWorkspace();
                  }}
                />
              </label>
              <label>
                {tx(language, "Tür", "Type", "Cure")}
                <select value={newWorkspaceParent} onChange={(e) => setNewWorkspaceParent(e.target.value)}>
                  <option value="">{tx(language, "Çalışma alanı (kasaları doğrudan bağlanır)", "Workspace (cash accounts attach directly)", "Qada xebatê (qase rasterast girêdide)")}</option>
                  {parentWorkspaceOptions(sections, language).map((o) => (
                    <option key={o.key} value={o.key}>{tx(language, "Bölüm → ", "Section in → ", "Beş li → ")}{o.label}</option>
                  ))}
                </select>
                <small className="kasaManageHint">
                  {tx(language, "Bölüm oluşturursanız kasaları bölümün içinde açabilirsiniz (Kasa Ekle'de \"Üst › Bölüm\" olarak seçilir).", "If you create a section, you can add cash accounts inside it (pick \"Parent › Section\" in Add Cash Account).", "Heke beş çêkin, qase dikarin di nav de çêbin.")}
                </small>
              </label>
              {newWorkspaceError && <p className="kasaManageError">{newWorkspaceError}</p>}
            </div>
            <div className="modalActions">
              <button type="button" className="light" onClick={() => setNewWorkspaceOpen(false)}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
              <button type="button" className="primary" disabled={newWorkspaceBusy || !newWorkspaceName.trim()} onClick={createWorkspace}>
                {tx(language, "Oluştur", "Create", "Çêke")}
              </button>
            </div>
          </div>
        </div>
      )}
      {accessTarget && (
        <WorkspaceAccessModal
          language={language}
          title={accessTarget.title}
          kasas={accessTarget.kasas}
          section={accessTarget.section}
          sections={sections}
          accounts={cashAccounts}
          checkPassword={checkPassword}
          onClose={() => setAccessTarget(null)}
          onDone={() => onRefreshData?.()}
        />
      )}
      {kasaMoveTarget && (
        <KasaEditModal
          language={language}
          account={kasaMoveTarget}
          sections={sections}
          moveOnly
          onClose={() => setKasaMoveTarget(null)}
          onDone={() => {
            setActiveWs(null);
            onRefreshData?.();
          }}
        />
      )}
      {kasaDeleteTarget && (
        <KasaDeleteModal
          language={language}
          account={kasaDeleteTarget}
          recordCount={allRecords.filter((x) => (x.kind === "cash" ? x.source : x.cashAccount) === kasaDeleteTarget.name).length}
          onClose={() => setKasaDeleteTarget(null)}
          onDone={() => {
            setSource("Tümü");
            setActiveKasa("");
            setShowAllLists(false);
            onRefreshData?.();
          }}
        />
      )}
      {boardMode && (
        <KasaBoard
          language={language}
          workspaces={cashWorkspaces.map((w) => ({ key: w.key, name: w.name, color: w.color, kasas: w.kasas, subs: w.subs.map((x) => ({ key: x.key, name: x.name, color: x.color, kasas: x.kasas })) }))}
          cashAccounts={cashAccounts}
          allRecords={allRecords}
          exchangeRates={exchangeRates}
          summary={{ total: overallByCurrency, inBy: overallInOut.inBy, outBy: overallInOut.outBy }}
          onOpen={(name) => { setSource(name); setActiveKasa(""); setShowAllLists(false); }}
          actionsFor={boardActions}
          onShare={(account) => setShareTarget(account)}
          canManage={isSuperAdmin && !readOnly}
          onReorder={saveOrder}
          onEditGroup={editWorkspaceOrSection}
          onAddSection={(parentKey) => { setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(parentKey); setNewWorkspaceOpen(true); }}
          onAddKasa={(groupKey) => onAdd("cash", undefined, groupKey)}
          onAddWorkspace={() => { setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(""); setNewWorkspaceOpen(true); }}
        />
      )}
      {detailMode && (
        <div className="kbDetailHead">
          <button type="button" className="kbBack" onClick={() => { setSource("Tümü"); setActiveKasa(""); setActiveWs(null); setShowAllLists(false); setSelectedIds(new Set()); }}>
            ← {tx(language, "Tüm kasalar", "All cash accounts", "Hemû qase")}
          </button>
          <div className="kbDetailTitle">
            <h3>{localizeData(source, language)}</h3>
            <small>{detailKasa ? `${detailKasa.w.name} · ` : ""}{tx(language, "Bakiye", "Balance", "Balans")}: <b>{moneyBreakdown(detailKasa?.k.totalByCurrency ?? {})}</b></small>
          </div>
          <div className="kbDetailActions">
            {kasaActions(source, true)}
            {(() => { const acc = cashAccounts.find((a) => a.name === source); return acc ? <button type="button" className="light compact" onClick={() => setShareTarget(acc)}>🔗 {tx(language, "Paylaş", "Share", "Parve bike")}</button> : null; })()}
            {!readOnly && <button type="button" className="light compact" onClick={() => openCardRecord("source", source, "cash")}>🗂 {tx(language, "Kasa kaydı", "Cash entry", "Tomara qaseyê")}</button>}
          </div>
        </div>
      )}
      {!(boardMode || detailMode) && (
      <div className="groups">
        <button
          className={source === "Tümü" && !showAllLists && !activeKasa && (activeWs === null || activeWs === "__all") && !activeIeWorkspace ? "selected" : ""}
          onClick={() => {
            setSource("Tümü");
            setActiveKasa("");
            // Kasalar sayfasında "Tüm Kasalar" altta tüm kasaları açar/kapatır.
            setActiveWs(kind === "cash" && activeWs !== "__all" ? "__all" : null);
            setActiveIeWs(null);
            setShowAllLists(false);
          }}
        >
          <b>
            {kind === "cash"
              ? tx(language, "Tüm Kasalar", "All Cash Accounts", "Hemû Qase")
              : kind === "income"
                ? tx(language, "Tüm Gelirler", "All Income", "Hemû Dahat")
                : tx(language, "Tüm Giderler", "All Expenses", "Hemû Mesref")}{" "}
            <span className="groupCount">({kind === "cash" ? cashWorkspaces.reduce((acc, w) => acc + w.count, 0) : records.length})</span>
          </b>
          <strong>
            {moneyBreakdown(overallByCurrency)}
          </strong>
          {kind === "cash" && (
            <span className="groupInOut">
              <span className="in">↗ {moneyBreakdown(overallInOut.inBy)}</span>
              <span className="out">↘ {moneyBreakdown(overallInOut.outBy)}</span>
            </span>
          )}
        </button>
        {kind === "cash" && cashWorkspaces.filter((w) => isSuperAdmin || w.allKasas.length > 0).map((w) => {
          const tone = { background: `${w.color}14`, borderColor: `${w.color}66` };
          return (
            <div className="groupCard" key={w.key}>
              <button
                className={activeWs === w.key && source === "Tümü" ? "selected" : ""}
                style={{ ...tone, borderLeft: `4px solid ${w.color}` }}
                onClick={() => {
                  setActiveWs(activeWs === w.key ? null : w.key);
                  setSource("Tümü");
                  setSearch("");
                  setActiveList("");
                  setActiveKasa("");
                  setShowAllLists(false);
                }}
              >
                <b>{w.name} <span className="groupCount" style={{ color: w.color }}>({w.count})</span></b>
                <em className="groupKasaTag" style={{ background: `${w.color}22`, color: w.color }}>◆ {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")} · {w.allKasas.length} {tx(language, "kasa", "accounts", "qase")}{w.subs.length ? ` · ${w.subs.length} ${tx(language, "bölüm", "sections", "beş")}` : ""}</em>
                <strong style={{ color: w.color }}>{moneyBreakdown(w.totalBy)}</strong>
                <span className="groupInOut">
                  <span className="in">↗ {moneyBreakdown(w.inBy)}</span>
                  <span className="out">↘ {moneyBreakdown(w.outBy)}</span>
                </span>
              </button>
              {isSuperAdmin && (
                <span className="kasaActions">
                  <button
                    type="button"
                    title={tx(language, "Çalışma alanını düzenle", "Edit workspace", "Qada xebatê biguherîne")}
                    aria-label={tx(language, "Çalışma alanını düzenle", "Edit workspace", "Qada xebatê biguherîne")}
                    onClick={() =>
                      setAccessTarget({
                        title: `${w.name} — ${tx(language, "Çalışma alanını düzenle", "Edit workspace", "Qada xebatê biguherîne")}`,
                        kasas: w.allKasas
                          .map((k) => {
                            const acc = cashAccounts.find((c) => c.name === k.name);
                            return { id: acc?.id ?? 0, name: k.name, ownerUserId: acc?.ownerUserId ?? null };
                          })
                          .filter((k) => k.id > 0),
                        section: w.key.startsWith("sec-") ? sections.find((x) => x.id === Number(w.key.slice(4))) : undefined,
                      })
                    }
                  >
                    ✎
                  </button>
                </span>
              )}
            </div>
          );
        })}
        {(kind === "cash" ? [] : groups).map((g) => {
          const matchingAccount = g.kind === "cash" ? cashAccounts.find((a) => a.name === g.name) : undefined;
          return (
          <div className="groupCard" key={g.name}>
            <button
              className={source === g.name && !showAllLists ? "selected" : ""}
              onClick={() => {
                setSource(g.name);
                setActiveKasa("");
                setShowAllLists(false);
              }}
            >
              <b>{localizeData(g.name, language)} <span className="groupCount">({g.count})</span></b>
              {kind !== "cash" && g.kasas.length > 0 && <em className="groupKasaTag">▣ {g.kasas.map((n) => localizeData(n, language)).join(", ")}</em>}
              <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
              {kind === "cash" && (
                <span className="groupInOut">
                  <span className="in">↗ {moneyBreakdown(g.totalInByCurrency)}</span>
                  <span className="out">↘ {moneyBreakdown(g.totalOutByCurrency)}</span>
                </span>
              )}
            </button>
            {!readOnly && source === g.name && (
              <button
                className="cashEditIcon"
                title={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                aria-label={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                onClick={() => openCardRecord("source", g.name, g.kind)}
              >
                🗂
              </button>
            )}
            {source === g.name &&
              kind === "cash" &&
              matchingAccount && (
                // Shown even while readOnly (browsing a shared owner's workspace):
                // matchingAccount only ever exists here because the server already
                // scoped `cashAccounts` to kasas this user can see (owned or shared)
                // — anyone with visibility into a kasa may manage its sharing, not
                // just its owner (see canManageCashAccountAccess). readOnly still
                // blocks editing records themselves, just not who can see them.
                <button
                  className="cashEditIcon"
                  title={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
                  aria-label={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
                  onClick={() => setShareTarget(matchingAccount)}
                >
                  🔗
                </button>
              )}
            {kind === "cash" && kasaActions(g.name, source === g.name && !showAllLists)}
            {renderGroupTooltip(g, matchingAccount)}
          </div>
          );
        })}
        {kind !== "cash" && (
          <>
            {ieWorkspaces.map((w) => (
              <div className="groupCard" key={w.key}>
                <button
                  className={activeIeWs === w.key ? "selected" : ""}
                  style={{ background: `${w.color}14`, borderColor: `${w.color}66`, borderLeft: `4px solid ${w.color}` }}
                  onClick={() => {
                    setActiveIeWs(activeIeWs === w.key ? null : w.key);
                    setActiveKasa("");
                    setSource("Tümü");
                    setSearch("");
                    setActiveList("");
                    setShowAllLists(false);
                  }}
                >
                  <b>{w.name} <span className="groupCount" style={{ color: w.color }}>({w.count})</span></b>
                  <em className="groupKasaTag" style={{ background: `${w.color}22`, color: w.color }}>◆ {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")} · {w.kasas.length} {tx(language, "kasa", "accounts", "qase")}</em>
                  <strong style={{ color: w.color }}>{moneyBreakdown(w.totalByCurrency)}</strong>
                </button>
              </div>
            ))}
            {sectionBoxes.map(({ section, count, totalByCurrency }) => (
              <div className="groupCard sectionBox" key={`sec-${section.id}`}>
                <button
                  className={activeSection === section.id ? "selected" : ""}
                  style={{ background: `${section.color}14`, borderColor: activeSection === section.id ? section.color : `${section.color}66` }}
                  onClick={() => {
                    setActiveSection(activeSection === section.id ? null : section.id);
                    setActiveKasa("");
                    setSource("Tümü");
                    setSearch("");
                    setActiveList("");
                    setShowAllLists(false);
                  }}
                >
                  <b>{section.name} <span className="groupCount" style={{ color: section.color }}>({count})</span></b>
                  <em className="groupKasaTag" style={{ background: `${section.color}22`, color: section.color }}>◆ {kind === "income" ? tx(language, "Gelir bölümü", "Income section", "Beşa dahatê") : tx(language, "Gider bölümü", "Expense section", "Beşa mesrefê")}</em>
                  <strong style={{ color: section.color }}>{moneyBreakdown(totalByCurrency)}</strong>
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      )}
      {kind !== "cash" && activeIeWorkspace && (
        <div className="groups workspaceGroups" style={{ borderLeft: `4px solid ${activeIeWorkspace.color}` }}>
          {activeIeWorkspace.kasas.map((k) => (
            <div className="groupCard" key={k.name}>
              <button
                className={activeKasa === k.name ? "selected" : ""}
                style={{ background: `${activeIeWorkspace.color}14`, borderColor: `${activeIeWorkspace.color}66` }}
                onClick={() => {
                  setActiveKasa(activeKasa === k.name ? "" : k.name);
                  setSource("Tümü");
                  setSearch("");
                  setActiveList("");
                  setShowAllLists(false);
                }}
              >
                <b>{localizeData(k.name, language)} <span className="groupCount">({k.count})</span></b>
                <strong>{moneyBreakdown(k.totalByCurrency)}</strong>
              </button>
              {kasaActions(k.name, activeKasa === k.name && !showAllLists)}
            </div>
          ))}
        </div>
      )}
      {/* Listeler menüsü kapatıldı: "Tüm Liste Giderleri/Gelirleri" satırı artık gösterilmez; liste kasaları çalışma alanı kutusunda görünür. */}
      {false && (kind as string) !== "cash" && listGroups.length > 0 && (
        <div className="groups listGroups">
          <button
            className={showAllLists ? "selected" : ""}
            onClick={() => {
              setSource("Tümü");
              setActiveKasa("");
              setSearch("");
              setActiveList("");
              setShowAllLists(true);
            }}
          >
            <b>
              {kind === "cash"
                ? tx(language, "Tüm Liste Kasaları", "All List Accounts", "Hemû Qaseyên Lîsteyê")
                : kind === "income"
                  ? tx(language, "Tüm Liste Gelirleri", "All List Income", "Hemû Dahatên Lîsteyê")
                  : tx(language, "Tüm Liste Giderleri", "All List Expenses", "Hemû Mesrefên Lîsteyê")}{" "}
              <span className="groupCount">({listedRecords.length})</span>
            </b>
            <strong>
              {moneyBreakdown(overallListByCurrency)}
            </strong>
            {kind === "cash" && (
              <span className="groupInOut">
                <span className="in">↗ {moneyBreakdown(overallListInOut.inBy)}</span>
                <span className="out">↘ {moneyBreakdown(overallListInOut.outBy)}</span>
              </span>
            )}
          </button>
          {(kind === "cash" ? listGroups : []).map((g) => (
            <div className="groupCard" key={g.name}>
              <button
                className={activeList === g.name ? "selected" : ""}
                onClick={() => openList(g.name)}
              >
                <b>{localizeData(g.name, language)} <span className="groupCount">({g.count})</span></b>
                <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
                {kind === "cash" && (
                  <span className="groupInOut">
                    <span className="in">↗ {moneyBreakdown(g.totalInByCurrency)}</span>
                    <span className="out">↘ {moneyBreakdown(g.totalOutByCurrency)}</span>
                  </span>
                )}
              </button>
              {!readOnly && activeList === g.name && (
                <button
                  className="cashEditIcon"
                  title={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                  aria-label={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                  onClick={() => openCardRecord("listName", g.name)}
                >
                  🗂
                </button>
              )}
              {kind === "cash" && (
                <div className="groupCardTooltip">
                  <div>
                    <small>{tx(language, "Toplam Kasa", "Total In", "Giştî")}</small>
                    <strong>{moneyBreakdown(g.totalInByCurrency)}</strong>
                  </div>
                  <div>
                    <small>{tx(language, "Gider", "Expense", "Mesref")}</small>
                    <strong className="negative">{moneyBreakdown(g.totalOutByCurrency)}</strong>
                  </div>
                  <div>
                    <small>{tx(language, "Sonuç", "Result", "Encam")}</small>
                    <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
                  </div>
                </div>
              )}
            </div>
          ))}
          {kind !== "cash" &&
            listKasaBoxes.map((b) => (
              <div className="groupCard" key={b.name}>
                <button
                  className={activeKasa === b.name && showAllLists ? "selected" : ""}
                  onClick={() => {
                    const same = activeKasa === b.name && showAllLists;
                    setActiveKasa(same ? "" : b.name);
                    setSource("Tümü");
                    setSearch("");
                    setActiveList("");
                    setShowAllLists(true);
                  }}
                >
                  <b>
                    {localizeData(b.name, language)}
                    {(kind === "income" ? /gelir|income|dahat/i : /gider|expense|mesref/i).test(b.name)
                      ? ""
                      : ` ${kind === "income" ? tx(language, "Gelirleri", "Income", "Dahat") : tx(language, "Giderleri", "Expenses", "Mesref")}`}{" "}
                    <span className="groupCount">({b.count})</span>
                  </b>
                  <em className="groupKasaTag" title={b.lists.join(", ")}>
                    ▣ {b.lists.length ? b.lists.join(", ") : tx(language, "Liste Kasası", "List cash account", "Qaseya Lîsteyê")}
                  </em>
                  <strong>{moneyBreakdown(b.totalByCurrency)}</strong>
                </button>
                {kasaActions(b.name, activeKasa === b.name && showAllLists)}
              </div>
            ))}
        </div>
      )}
      {kind === "cash" && activeWs && !(boardMode || detailMode) && (
        <div className="groups workspaceGroups" style={{ borderLeft: `4px solid ${activeWorkspace?.color ?? "#315fe8"}` }}>
          {activeWorkspace?.subs.map((s) => (
            <div className="groupCard subSectionCard" key={s.key}>
              <button
                className={activeSub === s.key ? "selected" : ""}
                style={{ background: `${s.color}14`, borderColor: `${s.color}66`, borderLeft: `4px solid ${s.color}` }}
                onClick={() => {
                  setActiveSub(activeSub === s.key ? null : s.key);
                  setSource("Tümü");
                  setActiveKasa("");
                }}
              >
                <b>{s.name} <span className="groupCount" style={{ color: s.color }}>({s.count})</span></b>
                <em className="groupKasaTag" style={{ background: `${s.color}22`, color: s.color }}>{activeSub === s.key ? "▾" : "▸"} {tx(language, "Bölüm", "Section", "Beş")} · {s.kasas.length} {tx(language, "kasa", "accounts", "qase")}</em>
                <strong style={{ color: s.color }}>{moneyBreakdown(s.totalBy)}</strong>
                <span className="groupInOut">
                  <span className="in">↗ {moneyBreakdown(s.inBy)}</span>
                  <span className="out">↘ {moneyBreakdown(s.outBy)}</span>
                </span>
              </button>
              {isSuperAdmin && (
                <span className="kasaActions">
                  <button
                    type="button"
                    title={tx(language, "Bölümü düzenle", "Edit section", "Beşê biguherîne")}
                    aria-label={tx(language, "Bölümü düzenle", "Edit section", "Beşê biguherîne")}
                    onClick={() =>
                      setAccessTarget({
                        title: `${s.name} — ${tx(language, "Bölümü düzenle", "Edit section", "Beşê biguherîne")}`,
                        kasas: s.kasas
                          .map((k) => {
                            const acc = cashAccounts.find((c) => c.name === k.name);
                            return { id: acc?.id ?? 0, name: k.name, ownerUserId: acc?.ownerUserId ?? null };
                          })
                          .filter((k) => k.id > 0),
                        section: sections.find((x) => x.id === Number(s.key.slice(4))),
                      })
                    }
                  >
                    ✎
                  </button>
                </span>
              )}
            </div>
          ))}
          {activeKasaCards.map(({ g, color }) => renderKasaCard(g, { background: `${color}14`, borderColor: `${color}66` }))}
          {activeKasaCards.length === 0 && !activeWorkspace?.subs.length && (
            <small className="workspaceEmpty">{tx(language, "Bu çalışma alanında henüz kasa yok — kasa kaydında “Çalışma alanı” seçin.", "No cash accounts yet — pick “Workspace” on a cash record.", "Hê qase tune — di tomara qaseyê de “Qada xebatê” hilbijêre.")}</small>
          )}
        </div>
      )}
      {kind === "cash" && activeSubObj && !(boardMode || detailMode) && (
        <div className="groups workspaceGroups subGroups" style={{ borderLeft: `4px solid ${activeSubObj.color}` }}>
          <small className="subGroupsTitle">{activeSubObj.name}</small>
          {activeSubObj.kasas.map((g) => renderKasaCard(g, { background: `${activeSubObj.color}14`, borderColor: `${activeSubObj.color}66` }))}
          {activeSubObj.kasas.length === 0 && (
            <small className="workspaceEmpty">{tx(language, "Bu bölümde henüz kasa yok.", "No cash accounts in this section yet.", "Di vê beşê de hê qase tune.")}</small>
          )}
        </div>
      )}
      {!boardMode && (
      <div className="search">
        <span>⌕</span>
        {kind === "cash" && (
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveList("");
            }}
            placeholder={tx(
              language,
              "Kayıtlarda ara…",
              "Search records…",
              "Di qeydan de bigere…",
            )}
          />
        )}
        <button
          type="button"
          className={`light compact${activeFilterCount ? " filterActive" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          ▤ {tx(language, "Filtrele", "Filter", "Parzûn")}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <label className="sortSelect">
          <span>⇅</span>
          <select value={sortMode} onChange={(e) => changeSortMode(e.target.value as typeof sortMode)}>
            <option value="dateDesc">{tx(language, "Tarihe Göre (Yeni → Eski)", "By Date (Newest First)", "Li gorî Tarîxê (Ji Nû Ve Dawî)")}</option>
            <option value="dateAsc">{tx(language, "Tarihe Göre (Eski → Yeni)", "By Date (Oldest First)", "Li gorî Tarîxê (Ji Kevn Ve Nû)")}</option>
            <option value="addedDesc">{tx(language, "Son Eklenen (Yeni → Eski)", "Recently Added (Newest First)", "Ya Herî Dawî Hatiye Zêdekirin (Nû → Kevn)")}</option>
            <option value="addedAsc">{tx(language, "Son Eklenen (Eski → Yeni)", "Recently Added (Oldest First)", "Ya Herî Dawî Hatiye Zêdekirin (Kevn → Nû)")}</option>
          </select>
        </label>
        <small>
          {rows.length} {recordWord}
        </small>
      </div>
      )}
      {filtersOpen && !boardMode && (
        <div className="filterPanel">
          <label>
            {tx(language, "Başlangıç Tarihi", "From Date", "Ji Tarîxê")}
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </label>
          <label>
            {tx(language, "Bitiş Tarihi", "To Date", "Heta Tarîxê")}
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </label>
          <label>
            {tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke")}
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
              <option value="">{tx(language, "Tümü", "All", "Hemû")}</option>
              {filterSourceOptions.map((name) => (
                <option key={name} value={name}>
                  {localizeData(name, language)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx(language, "Kişi", "Person", "Kes")}
            <input value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)} />
          </label>
          <label>
            {tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne")}
            <input value={filterProject} onChange={(e) => setFilterProject(e.target.value)} />
          </label>
          <label>
            {tx(language, "Etiket", "Tag", "Etîket")}
            <input value={filterTag} onChange={(e) => setFilterTag(e.target.value)} />
          </label>
          <button type="button" className="light" onClick={clearFilters} disabled={!activeFilterCount}>
            {tx(language, "Filtreleri Temizle", "Clear Filters", "Parzûnan Paqij Bike")}
          </button>
        </div>
      )}
      {selectedRows.length > 0 && !boardMode && (
        <div className="selectionBar">
          <strong>{selectedRows.length} {tx(language, "kayıt seçili", "records selected", "tomar hatine hilbijartin")}</strong>
          <span className="selectionTotals">
            {selectedRows.some((x) => x.kind !== "expense") && (
              <em className="positive">{tx(language, "Gelir", "Income", "Dahat")}: {moneyBreakdown(combineByCurrency([{ rows: selectedRows.filter((x) => x.kind !== "expense") }]))}</em>
            )}
            {selectedRows.some((x) => x.kind === "expense") && (
              <em className="negative">{tx(language, "Gider", "Expense", "Mesref")}: {moneyBreakdown(combineByCurrency([{ rows: selectedRows.filter((x) => x.kind === "expense") }]))}</em>
            )}
          </span>
          <button type="button" className="light" onClick={() => exportExcel(selectedRows, "-secili")}>
            ⇩ {tx(language, "Seçilenleri Excel'e Çıkar", "Export Selected to Excel", "Hilbijartiyan Derxe Excelê")}
          </button>
          <button type="button" className="light" onClick={copySelected}>
            ⧉ {tx(language, "Kopyala", "Copy", "Kopî bike")}
          </button>
          {!readOnly && (
            <button type="button" className="light redText" onClick={() => setBulkDeleteOpen(true)}>
              🗑 {tx(language, "Seçilenleri Sil", "Delete Selected", "Hilbijartiyan Jêbibe")}
            </button>
          )}
          <button type="button" className="light" onClick={() => setSelectedIds(new Set())}>
            ✕ {tx(language, "Seçimi Temizle", "Clear Selection", "Hilbijartinê Paqij Bike")}
          </button>
        </div>
      )}
      {bulkDeleteOpen && (
        <DeleteConfirmModal
          language={language}
          itemLabel={`${selectedRows.length} ${tx(language, "kayıt", "records", "tomar")}`}
          checkPassword={checkPassword}
          onClose={() => setBulkDeleteOpen(false)}
          onConfirm={(reason) => {
            for (const x of selectedRows) onDelete(x, reason);
            setSelectedIds(new Set());
            setBulkDeleteOpen(false);
          }}
        />
      )}
      {!boardMode && (
      <div className={kind === "cash" && !kasaSplitActive ? "" : "recordsGrid"}>
        {kasaSplitActive ? (
          <div className="kasaResultSplit">
            <div className="kasaResultGroup kasaResultIncome">
              <div className="kasaResultGroupHead">
                <span>↗</span>
                <div>
                  <h3>
                    {tx(language, "Gelirler", "Income", "Dahat")}
                    <strong className="positive">
                      {moneyBreakdown(combineByCurrency([{ rows: kasaIncomeRows.filter((x) => !isDebtLeg(x)) }]))}
                    </strong>
                    {Object.keys(kasaDebt).length > 0 && (
                      <strong className="negative kasaDebtTag" title={tx(language, "Bu kasanın başka kasalara kalan borcu (Borç Detay sayfasına bakın)", "Outstanding debt of this kasa to other kasas (see Debt Details)", "Deynê mayî yê vê qaseyê (Hûrguliyên Deynê bibîne)")}>
                        {tx(language, "Borç Tutarı", "Debt Amount", "Mêjera Deynê")}: {moneyBreakdown(kasaDebt)}
                      </strong>
                    )}
                  </h3>
                  <small>
                    {kasaIncomeRows.length} {recordWord}
                  </small>
                </div>
                {!readOnly && (
                  <button type="button" className="light" style={{ marginLeft: "auto" }} onClick={() => onAdd("income", source)}>
                    ＋ {tx(language, "Gelir Ekle", "Add Income", "Dahat Zêde Bike")}
                  </button>
                )}
              </div>
              {renderRecordsTable(kasaIncomeRows)}
            </div>
            <div className="kasaResultGroup kasaResultExpense">
              <div className="kasaResultGroupHead">
                <span>↘</span>
                <div>
                  <h3>
                    {tx(language, "Giderler", "Expenses", "Mesref")}
                    <strong className="negative">
                      {moneyBreakdown(combineByCurrency([{ rows: kasaExpenseRows.filter((x) => x.debtRole !== "repay") }]))}
                    </strong>
                  </h3>
                  <small>
                    {kasaExpenseRows.length} {recordWord}
                  </small>
                </div>
                {!readOnly && (
                  <button type="button" className="light" style={{ marginLeft: "auto" }} onClick={() => onAdd("expense", source)}>
                    ＋ {tx(language, "Gider Ekle", "Add Expense", "Mesref Zêde Bike")}
                  </button>
                )}
              </div>
              {renderRecordsTable(kasaExpenseRows)}
            </div>
          </div>
        ) : (
          renderRecordsTable(orderedRows)
        )}
        {(kind !== "cash" || kasaSplitActive) && (
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
        )}
      </div>
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          language={language}
          itemLabel={`${localizeData(deleteTarget.source, language)} · ${money(deleteTarget.amount, deleteTarget.currency)}`}
          checkPassword={checkPassword}
          onClose={() => setDeleteTarget(null)}
          onConfirm={(reason) => {
            onDelete(deleteTarget, reason);
            setDeleteTarget(null);
          }}
        />
      )}
      {shareTarget && (
        <ShareKasaModal
          language={language}
          account={shareTarget}
          users={users}
          busyKey={shareBusyKey}
          onToggle={toggleShare}
          onToggleDashboardShare={toggleDashboardShare}
          dashboardShareBusy={dashboardShareBusy}
          onClose={() => setShareTarget(null)}
        />
      )}
      {detailViewTarget && (
        <DetailTableModal language={language} record={detailViewTarget} onClose={() => setDetailViewTarget(null)} />
      )}
      {commentTarget && (
        <RecordCommentsModal
          language={language}
          record={commentTarget}
          onRead={onCommentsRead}
          onClose={() => {
            setCommentTarget(null);
            refreshCommentSummaries();
          }}
        />
      )}
      {kasaResultOpen && kasaSplitActive && (
        <KasaResultModal
          language={language}
          initialKasaName={source}
          kasaOptions={groups.map((g) => g.name)}
          records={records}
          allRecords={allRecords}
          onClose={() => setKasaResultOpen(false)}
        />
      )}
    </div>
  );
}
