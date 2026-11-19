"use client";

import { useEffect, useRef, useState } from "react";
import { Title, DeleteConfirmModal } from "./shared";
import { debtPairs, isDebtLeg, kasaDebtByCurrency, kasaDebtStatus } from "../lib/debts";
import { DebtModal, type DebtModalMode } from "./DebtModal";
import { DebtMarkModal } from "./DebtMarkModal";
import { FxExchangeModal } from "./FxModals";
import { KasaBoard, type BoardAction } from "./KasaBoard";
import { RecordCommentsModal } from "./Comments";
import { KasaDeleteModal, KasaEditModal, NewKasaModal, NO_WORKSPACE, parentWorkspaceOptions, workspaceOptions } from "./KasaManage";
import { WorkspaceAccessModal, type AccessKasa } from "./WorkspaceAccess";
import { tx, localizeData } from "../lib/i18n";
import { combineByCurrency, date, money, moneyBreakdown, type ExchangeRates } from "../lib/finance";
import type { CashAccountSummary, CashTransfer, FinanceNote, KasaSection, Kind, Language, RecordItem, RecordsView, UserAccount } from "../lib/types";
import { notify } from "../lib/notify";
import { DetailTableModal } from "./records/detailTable";
import { ShareKasaModal } from "./records/inputs";
import { KasaResultModal } from "./records/KasaResultModal";
import { KasaTransferModal } from "./records/KasaTransfer";
import { useColumnLayout } from "./records/useColumnLayout";
import { createRowDrag, useOrderedRows, useRowOrder } from "./records/useRowOrder";
import { useKasaSummaries, type CardGroup } from "./records/useKasaSummaries";
import { exportRecordsExcel, importRecordsExcel } from "./records/excelIO";
import { renderRecordsTable as renderRecordsTableView } from "./records/cells";
import { useKasaSharing, useTransferApproval } from "./records/useKasaSharing";
import { renderFilterPanel, useRecordFilters } from "./records/filters";
import {
  renderGroupTooltip as renderGroupTooltipView,
  renderKasaActions,
  renderKasaCard as renderKasaCardView,
  type KasaCardContext,
} from "./records/kasaCards";
import { renderNewWorkspaceModal } from "./records/newWorkspace";
import { renderLatestPanel } from "./records/latestPanel";

// Tablo sütun düzeni: records/useColumnLayout.ts · satır sırası: records/useRowOrder.ts ·
// kasa/çalışma alanı özetleri: records/useKasaSummaries.ts · Excel: records/excelIO.ts ·
// hücre/tablo çizimi: records/cells.tsx · kasa kartları: records/kasaCards.tsx · paylaşım/onay:
// records/useKasaSharing.ts · filtreler: records/filters.tsx · yeni çalışma alanı penceresi:
// records/newWorkspace.tsx · sağdaki "En Son" panosu: records/latestPanel.tsx.

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
  loading = false,
  isSuperAdmin = false,
  onGoUpload,
}: {
  language: Language;
  // Sayfa: "cash" = Kasa Kontrol Merkezi (tüm gelir/gider kayıtları kasalarına göre), "income"/"expense" = Gelir/Gider.
  kind: RecordsView;
  records: RecordItem[];
  allRecords: RecordItem[];
  onAdd: (kind: Kind, cashAccount?: string) => void;
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
  // İlk veri henüz gelmedi (kasa panosu "Yükleniyor…" gösterir).
  loading?: boolean;
  isSuperAdmin?: boolean;
  onGoUpload?: () => void;
}) {
  // Kasa Kontrol Merkezi sayfası mı (sayfa kimliği; kayıt türü değil — kayıtlar yalnız gelir/giderdir).
  const kasaPage = kind === "cash";
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
  const { rowOrder, draggedRowId, setDraggedRowId, dragOverRowId, setDragOverRowId, persistRowOrder, sortMode, changeSortMode } = useRowOrder(kind);
  const { columnOrder, columnWidths, draggedColumn, setDraggedColumn, reorderColumn, startResize } = useColumnLayout();

  const wsOptions = workspaceOptions(sections);
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
  // "Yeni Kasa" penceresi: null = kapalı, "" = varsayılan çalışma alanı, aksi halde açılacağı alan anahtarı.
  const [newKasaKey, setNewKasaKey] = useState<string | null>(null);
  // "Kasalar arası aktarım" penceresinin kaynak kasası.
  const [transferTarget, setTransferTarget] = useState<CashAccountSummary | null>(null);
  // Kasa sayfasındaki "Borç ver" / "Borç öde" penceresi (bu kasa ön seçili).
  const [debtTarget, setDebtTarget] = useState<{ mode: DebtModalMode; kasaId: number; collect?: boolean } | null>(null);
  // "Borca çevir" / "Borçtan çıkar" penceresinin kaydı.
  const [debtMarkTarget, setDebtMarkTarget] = useState<RecordItem | null>(null);
  // "Döviz bozdur" penceresinin kasası.
  const [fxTarget, setFxTarget] = useState<{ id: number; name: string } | null>(null);
  const { shareBusyKey, dashboardShareBusy, toggleShare, toggleDashboardShare } = useKasaSharing({ language, shareTarget, setShareTarget, onCashAccountsChange });
  const { approvingId, approveTransfer } = useTransferApproval({ language, onTransfersChanged });
  const [source, setSource] = useState("Tümü");
  // Gelir/Gider sayfalarında kasa kutusuyla (ör. "Ana Kasa Giderleri") süzülen kasa adı.
  const [activeKasa, setActiveKasa] = useState("");
  // Gelir/Gider sayfalarında bölüm kutusuyla süzülen bölüm (Ayarlar > Bölümler).
  // Kasalar sayfasında çalışma alanı başlığıyla süzülen alan anahtarı (sec-<id>).
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
  const filters = useRecordFilters();
  const { filtersOpen, setFiltersOpen, filterFrom, filterTo, filterSource, filterPerson, filterProject, filterTag, activeFilterCount } = filters;
  const {
    cashSections,
    groups,
    overallByCurrency,
    overallInOut,
    cashWorkspaces,
    ieWorkspaces,
  } = useKasaSummaries({ records, allRecords, kind, cashAccounts, sections, language, workspaceOrder });
  const filterSourceOptions = [...new Set(records.map((x) => x.source).filter(Boolean))];

  // Gelir/Gider başlık kutusundaki 🗂: o başlığın en son kaydını düzenlemeye açar.
  const openCardRecord = (value: string) => {
    const candidates = records.filter((x) => x.source === value);
    const rec = [...candidates].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (rec) onEdit(rec);
  };
  // Kasa kartları, kart özet balonu ve seçili kartın düğmeleri records/kasaCards.tsx'te çizilir.
  const kasaCardCtx = (): KasaCardContext => ({
    language,
    readOnly,
    isSuperAdmin,
    cashAccounts,
    allRecords,
    source,
    setSource,
    setActiveKasa,
    setShareTarget,
    setKasaEditTarget,
    setKasaMoveTarget,
    setKasaDeleteTarget,
    setAccessTarget,
    setTransferTarget,
  });
  const kasaActions = (name: string, selected: boolean) => renderKasaActions(name, selected, kasaCardCtx());
  const renderGroupTooltip = (g: CardGroup, matchingAccount: CashAccountSummary | undefined) => renderGroupTooltipView(g, matchingAccount, language, allRecords);
  const renderKasaCard = (g: CardGroup, tone?: { background: string; borderColor: string }) => renderKasaCardView(g, tone, kasaCardCtx());
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [subWs, setSubWs] = useState(activeWs);
  if (subWs !== activeWs) {
    setSubWs(activeWs);
    setActiveSub(null);
  }
  const activeWsObj = cashWorkspaces.find((w) => w.key === activeWs);
  const activeSubObj = activeSub ? activeWsObj?.subs.find((s) => s.key === activeSub) ?? null : null;
  const activeWsNames = new Set((activeSubObj ? activeSubObj.kasas : activeWsObj?.allKasas ?? []).map((k) => k.name));
  const activeIeWorkspace = !kasaPage && activeIeWs ? ieWorkspaces.find((w) => w.key === activeIeWs) ?? null : null;
  const activeIeNames = new Set((activeIeWorkspace?.kasas ?? []).map((k) => k.name));
  // "Tüm Kasalar" seçiliyken (activeWs === "__all") çalışma alanlarına dağıtılmış tüm kasalar tek sırada, kendi alanının renginde gösterilir.
  const activeWorkspace = kasaPage && activeWs && activeWs !== "__all" ? cashWorkspaces.find((w) => w.key === activeWs) ?? null : null;
  const activeKasaCards: { g: CardGroup; color: string }[] =
    !kasaPage || !activeWs
      ? []
      : activeWs === "__all"
        ? cashWorkspaces.flatMap((w) => [...w.kasas.map((g) => ({ g, color: w.color })), ...w.subs.flatMap((s) => s.kasas.map((g) => ({ g, color: s.color })))]).sort((a, b) => a.g.name.localeCompare(b.g.name))
        : (activeWorkspace?.kasas ?? []).map((g) => ({ g, color: activeWorkspace!.color }));
  // Kasa Kontrol Merkezi'nde `records` tüm gelir/gider kayıtlarıdır; bir kasa seçilince (source) o kasanın kayıtları
  // (kasa adına göre) gösterilir. Gelir/Gider sayfalarında `source` bir ana başlık kutusudur.
  const rows = records.filter(
    (x) =>
      (source === "Tümü" || (kasaPage ? x.cashAccount === source : x.source === source || x.cashAccount === source)) &&
      (!activeKasa || x.cashAccount === activeKasa) &&
      (!activeIeWorkspace || activeIeNames.has(x.cashAccount)) &&
      (activeWs === null || activeWs === "__all" || !kasaPage || activeWsNames.has(x.cashAccount)) &&
      (!filterFrom || x.date >= filterFrom) &&
      (!filterTo || x.date <= filterTo) &&
      (!filterSource || x.source === filterSource) &&
      (!filterPerson || x.person.toLowerCase().includes(filterPerson.toLowerCase())) &&
      (!filterProject || x.project.toLowerCase().includes(filterProject.toLowerCase())) &&
      (!filterTag || x.tags.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))) &&
      JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
  );
  const orderedRows = useOrderedRows(rows, sortMode, rowOrder);
  const { startRowDrag } = createRowDrag(orderedRows, persistRowOrder, setDraggedRowId, setDragOverRowId);
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
    kasaPage
      ? tx(language, "Kasa Kontrol Merkezi", "Cash Control Center", "Navenda Kontrola Qaseyan")
      : kind === "income"
        ? tx(language, "Gelirler", "Income", "Dahat")
        : tx(language, "Giderler", "Expenses", "Mesref");
  const recordWord = tx(language, "kayıt", "records", "qeyd");
  function exportExcel(rowsToExport: RecordItem[] = orderedRows, suffix = "") {
    return exportRecordsExcel(rowsToExport, suffix, { language, source, title });
  }
  // Excel'den kayıt ekleme yalnız Gelir/Gider sayfalarındadır (Kasa Kontrol Merkezi'nde kasalar "Yeni Kasa" ile açılır).
  function importExcel(file?: File) {
    if (kasaPage) return;
    return importRecordsExcel(file, { language, kind, source, records, onImport });
  }
  // Tablo çizimi records/cells.tsx'te (renderRecordsTable); burada Records'un durumu bağlam olarak verilir.
  function renderRecordsTable(tableRows: RecordItem[]) {
    return renderRecordsTableView(tableRows, {
      language,
      kind,
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
      onDebtMark: setDebtMarkTarget,
      startRowDrag,
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
    });
  }
  // Bir kasa seçildiğinde (source !== "Tümü"), Gelir ve Gider kayıtları aynı
  // tabloda karışık görünmesin diye iki ayrı kutuya bölünür — kullanıcı
  // hangisinin gelir hangisinin gider olduğunu tabloya bakmadan, kutunun
  // rengi ve başlığından anlar. "Tümü" görünümünde ve Gelir/Gider
  // sayfalarında (!kasaPage) tek, birleşik tablo olarak kalır.
  const kasaSplitActive = kasaPage && source !== "Tümü";
  // Kasalar sayfası: açılışta "kasa panosu" (boardMode), bir kasa seçilince kasanın kendi sayfası (detailMode).
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
  const boardMode = kasaPage && source === "Tümü" && !activeKasa;
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
  // Bu kasanın borç alan olarak kalan borcu ("Borç öde" düğmesi) ve "Borç durumu" kutusu (borç veren / alan olarak).
  // Bu rakamlar Gelir/Gider kutularına girmez.
  const kasaDebt = kasaSplitActive ? kasaDebtByCurrency(allRecords, source) : {};
  const debtStatus = kasaSplitActive ? kasaDebtStatus(allRecords, source) : { lender: null, borrower: null };
  // Bu kasanın sistem dışı kasalardan / projelerden açık alacağı var mı ("Tahsil et" düğmesi).
  const kasaPartyReceivable = kasaSplitActive && debtPairs(allRecords).some((p) => p.external && p.creditorName === source && p.outstanding > 0.004);
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
    // Başka bir kasaya/görünüme geçilince yandaki kayıt detayı da kapanır (önceki kasanın kaydı kalmasın).
    setViewTarget(null);
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
    const lines = selectedRows.map((x) => [date(x.date), x.cashAccount, x.source, x.person, x.amount, x.currency, x.tags.join(", ")].join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // Pano erişimi yoksa sessizce geçilir.
    }
  }
  return (
    <div className="panel">
      <div className="toolbar">
        <Title
          title={title}
          inline
          sub={
            kasaPage
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
                {!readOnly && !kasaPage && (
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
            {!readOnly && !kasaPage && (
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
          {kasaPage && !readOnly && (
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
                  <button onClick={() => { setNewMenuOpen(false); setNewKasaKey(activeSub ?? (activeWs && activeWs !== "__all" ? activeWs : "")); }}>
                    ▣ {tx(language, "Kasa Ekle", "Add Cash Account", "Qase Zêde Bike")}
                  </button>
                  {kasaPage && (
                    <>
                      <button onClick={() => { setNewMenuOpen(false); setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(activeWs && activeWs !== "__all" && activeWs !== NO_WORKSPACE && !activeSub ? activeWs : parentWorkspaceOptions(sections)[0]?.key ?? ""); setNewWorkspaceOpen(true); }}>
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
      {newWorkspaceOpen &&
        renderNewWorkspaceModal({
          language,
          sections,
          cashSections,
          onRefreshData,
          newWorkspaceName,
          setNewWorkspaceName,
          newWorkspaceParent,
          setNewWorkspaceParent,
          newWorkspaceBusy,
          setNewWorkspaceBusy,
          newWorkspaceError,
          setNewWorkspaceError,
          setNewWorkspaceOpen,
        })}
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
          recordCount={allRecords.filter((x) => x.cashAccount === kasaDeleteTarget.name).length}
          onClose={() => setKasaDeleteTarget(null)}
          onDone={() => {
            setSource("Tümü");
            setActiveKasa("");
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
          loading={loading}
          summary={{ total: overallByCurrency, inBy: overallInOut.inBy, outBy: overallInOut.outBy }}
          onOpen={(name) => { setSource(name); setActiveKasa(""); }}
          actionsFor={boardActions}
          onShare={(account) => setShareTarget(account)}
          canManage={isSuperAdmin && !readOnly}
          onReorder={saveOrder}
          onEditGroup={editWorkspaceOrSection}
          onAddSection={(parentKey) => { setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(parentKey); setNewWorkspaceOpen(true); }}
          onAddKasa={(groupKey) => setNewKasaKey(groupKey)}
          onAddWorkspace={() => { setNewWorkspaceName(""); setNewWorkspaceError(""); setNewWorkspaceParent(""); setNewWorkspaceOpen(true); }}
          onTransfer={readOnly ? undefined : (account) => setTransferTarget(account)}
        />
      )}
      {detailMode && (
        <div className="kbDetailHead">
          <button type="button" className="kbBack" onClick={() => { setSource("Tümü"); setActiveKasa(""); setActiveWs(null); setSelectedIds(new Set()); }}>
            ← {tx(language, "Tüm kasalar", "All cash accounts", "Hemû qase")}
          </button>
          <div className="kbDetailTitle">
            <h3>{localizeData(source, language)}</h3>
            <small>{detailKasa ? `${detailKasa.w.name} · ` : ""}{tx(language, "Bakiye", "Balance", "Balans")}: <b>{moneyBreakdown(detailKasa?.k.totalByCurrency ?? {})}</b></small>
          </div>
          <div className="kbDetailActions">
            {kasaActions(source, true)}
            {(() => { const acc = cashAccounts.find((a) => a.name === source); return acc && !readOnly && (acc.isOwner || isSuperAdmin) ? <button type="button" className="light compact" onClick={() => setShareTarget(acc)}>🔗 {tx(language, "Paylaş", "Share", "Parve bike")}</button> : null; })()}
            {(() => { const acc = cashAccounts.find((a) => a.name === source); return acc && !readOnly && (acc.isOwner || isSuperAdmin) ? <button type="button" className="light compact" onClick={() => setTransferTarget(acc)}>⇄ {tx(language, "Kasalar arası aktarım", "Transfer to another cash account", "Veguhastin bo qaseyeke din")}</button> : null; })()}
            {(() => {
              // Borç düğmeleri aktarım düğmesi gibi: parası çıkan kasa bu kasadır, yazma yetkisi gerekir.
              const acc = cashAccounts.find((a) => a.name === source);
              if (!acc || readOnly || !(acc.isOwner || isSuperAdmin)) return null;
              return (
                <>
                  <button type="button" className="light compact" onClick={() => setFxTarget({ id: acc.id, name: acc.name })}>⇆ {tx(language, "Döviz bozdur", "Exchange currency", "Dirav biguherîne")}</button>
                  <button type="button" className="light compact" onClick={() => setDebtTarget({ mode: "lend", kasaId: acc.id })}>↗ {tx(language, "Borç ver", "Lend", "Deyn bide")}</button>
                  {Object.keys(kasaDebt).length > 0 && (
                    <button type="button" className="light compact" onClick={() => setDebtTarget({ mode: "repay", kasaId: acc.id })}>↩ {tx(language, "Borç öde", "Repay debt", "Deyn vegerîne")}</button>
                  )}
                  {kasaPartyReceivable && (
                    <button type="button" className="light compact" onClick={() => setDebtTarget({ mode: "repay", kasaId: acc.id, collect: true })}>↙ {tx(language, "Borç tahsil et", "Collect debt", "Deyn bistîne")}</button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
      {detailMode && (debtStatus.lender || debtStatus.borrower) && (
        <div className="debtStatusCard" role="group" aria-label={tx(language, "Borç durumu", "Debt status", "Rewşa deynê")}>
          <h3>
            ⇄ {tx(language, "Borç durumu", "Debt status", "Rewşa deynê")}
            <small>{tx(language, "Ayrıntı için Borç Detay.", "See Debt Details for more.", "Ji bo hûrguliyan Hûrguliyên Deynê bibîne.")}</small>
          </h3>
          <div className="debtStatusSides">
            {debtStatus.lender && (
              <div className="debtStatusSide">
                <b>{tx(language, "Borç veren olarak", "As lender", "Wek deyndêr")}</b>
                <small>{tx(language, "Gelir/Gider toplamlarına girmez; yalnız bakiyeyi etkiler.", "Not part of the income/expense totals; affects the balance only.", "Nakeve giştiya dahat/mesrefê; tenê bandorê li bakiyeyê dike.")}</small>
                <dl>
                  <dt>{tx(language, "Verilen borç", "Lent", "Deynê hatî dayîn")}</dt>
                  <dd>{moneyBreakdown(debtStatus.lender.given)}</dd>
                  <dt>{tx(language, "Geri alınan", "Collected", "Hatî standin")}</dt>
                  <dd className="pos">{moneyBreakdown(debtStatus.lender.returned)}</dd>
                  <dt>{tx(language, "Alacak", "Receivable", "Deynê ku tê standin")}</dt>
                  <dd className="pos">{moneyBreakdown(debtStatus.lender.receivable)}</dd>
                </dl>
              </div>
            )}
            {debtStatus.borrower && (
              <div className="debtStatusSide">
                <b>{tx(language, "Borç alan olarak", "As borrower", "Wek deyndar")}</b>
                <small>{tx(language, "Alınan borç gelire, ödemeler gidere dahildir.", "Borrowed money counts as income, repayments as expenses.", "Deynê hatî girtin di dahatê de, dravdan di mesrefê de têne hesibandin.")}</small>
                <dl>
                  <dt>{tx(language, "Alınan borç", "Borrowed", "Deynê hatî girtin")}</dt>
                  <dd>{moneyBreakdown(debtStatus.borrower.borrowed)}</dd>
                  <dt>{tx(language, "Ödenen", "Repaid", "Hatî dayîn")}</dt>
                  <dd className="pos">{moneyBreakdown(debtStatus.borrower.repaid)}</dd>
                  <dt>{tx(language, "Kalan borç", "Remaining debt", "Deynê mayî")}</dt>
                  <dd className="neg">{moneyBreakdown(debtStatus.borrower.remaining)}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
      {!(boardMode || detailMode) && (
      <div className="groups">
        <button
          className={source === "Tümü" && !activeKasa && (activeWs === null || activeWs === "__all") && !activeIeWorkspace ? "selected" : ""}
          onClick={() => {
            setSource("Tümü");
            setActiveKasa("");
            // Kasalar sayfasında "Tüm Kasalar" altta tüm kasaları açar/kapatır.
            setActiveWs(kasaPage && activeWs !== "__all" ? "__all" : null);
            setActiveIeWs(null);
          }}
        >
          <b>
            {kasaPage
              ? tx(language, "Tüm Kasalar", "All Cash Accounts", "Hemû Qase")
              : kind === "income"
                ? tx(language, "Tüm Gelirler", "All Income", "Hemû Dahat")
                : tx(language, "Tüm Giderler", "All Expenses", "Hemû Mesref")}{" "}
            <span className="groupCount">({kasaPage ? cashWorkspaces.reduce((acc, w) => acc + w.count, 0) : records.length})</span>
          </b>
          <strong>
            {moneyBreakdown(overallByCurrency)}
          </strong>
          {kasaPage && (
            <span className="groupInOut">
              <span className="in">↗ {moneyBreakdown(overallInOut.inBy)}</span>
              <span className="out">↘ {moneyBreakdown(overallInOut.outBy)}</span>
            </span>
          )}
        </button>
        {kasaPage && cashWorkspaces.filter((w) => isSuperAdmin || w.allKasas.length > 0).map((w) => {
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
                  setActiveKasa("");
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
        {(kasaPage ? [] : groups).map((g) => {
          return (
          <div className="groupCard" key={g.name}>
            <button
              className={source === g.name ? "selected" : ""}
              onClick={() => {
                setSource(g.name);
                setActiveKasa("");
              }}
            >
              <b>{localizeData(g.name, language)} <span className="groupCount">({g.count})</span></b>
              {g.kasas.length > 0 && <em className="groupKasaTag">▣ {g.kasas.map((n) => localizeData(n, language)).join(", ")}</em>}
              <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
            </button>
            {!readOnly && source === g.name && (
              <button
                className="cashEditIcon"
                title={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                aria-label={tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")}
                onClick={() => openCardRecord(g.name)}
              >
                🗂
              </button>
            )}
            {renderGroupTooltip(g, undefined)}
          </div>
          );
        })}
        {!kasaPage && (
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
                  }}
                >
                  <b>{w.name} <span className="groupCount" style={{ color: w.color }}>({w.count})</span></b>
                  <em className="groupKasaTag" style={{ background: `${w.color}22`, color: w.color }}>◆ {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")} · {w.kasas.length} {tx(language, "kasa", "accounts", "qase")}</em>
                  <strong style={{ color: w.color }}>{moneyBreakdown(w.totalByCurrency)}</strong>
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      )}
      {!kasaPage && activeIeWorkspace && (
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
                }}
              >
                <b>{localizeData(k.name, language)} <span className="groupCount">({k.count})</span></b>
                <strong>{moneyBreakdown(k.totalByCurrency)}</strong>
              </button>
              {kasaActions(k.name, activeKasa === k.name)}
            </div>
          ))}
        </div>
      )}
      {kasaPage && activeWs && !(boardMode || detailMode) && (
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
            <small className="workspaceEmpty">{tx(language, "Bu çalışma alanında henüz kasa yok — “Yeni Kayıt › Kasa Ekle” ile açın.", "No cash accounts yet — open one with “New Record › Add Cash Account”.", "Hê qase tune — bi “Qeyda Nû › Qase Zêde Bike” veke.")}</small>
          )}
        </div>
      )}
      {kasaPage && activeSubObj && !(boardMode || detailMode) && (
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
        {kasaPage && (
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
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
      {filtersOpen && !boardMode && renderFilterPanel(filters, filterSourceOptions, language)}
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
      <div className={kasaPage && !kasaSplitActive ? "" : "recordsGrid"}>
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
                      {moneyBreakdown(combineByCurrency([{ rows: kasaExpenseRows.filter((x) => !isDebtLeg(x)) }]))}
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
        {(!kasaPage || kasaSplitActive) &&
          renderLatestPanel({
            language,
            kind,
            kasaSplitActive,
            readOnly,
            records,
            rows,
            notes,
            viewTarget,
            setViewTarget,
            onEdit,
            setCommentTarget,
            setDetailViewTarget,
          })}
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
      {newKasaKey !== null && (
        <NewKasaModal
          language={language}
          sections={sections}
          initialWorkspaceKey={newKasaKey || undefined}
          onSectionsChanged={onRefreshData}
          onClose={() => setNewKasaKey(null)}
          onDone={(name) => {
            onRefreshData?.();
            // Kasa Kontrol Merkezi'nde yeni kasanın sayfası açılır (boş kasa panoda varsayılan olarak gizlidir).
            if (kasaPage) {
              setSource(name);
              setActiveKasa("");
            }
          }}
        />
      )}
      {transferTarget && (
        <KasaTransferModal
          language={language}
          account={transferTarget}
          cashAccounts={cashAccounts}
          users={users}
          onTransfersChanged={onTransfersChanged}
          onClose={() => setTransferTarget(null)}
        />
      )}
      {fxTarget && (
        <FxExchangeModal
          language={language}
          kasa={fxTarget}
          records={allRecords}
          exchangeRates={exchangeRates}
          onDone={onTransfersChanged}
          onClose={() => setFxTarget(null)}
        />
      )}
      {debtMarkTarget && (
        <DebtMarkModal
          language={language}
          record={debtMarkTarget}
          records={allRecords}
          cashAccounts={cashAccounts}
          onDone={onTransfersChanged}
          onClose={() => setDebtMarkTarget(null)}
        />
      )}
      {debtTarget && (
        <DebtModal
          language={language}
          cashAccounts={cashAccounts}
          records={allRecords}
          isSuperAdmin={isSuperAdmin}
          initialMode={debtTarget.mode}
          kasaId={debtTarget.kasaId}
          preferCollect={debtTarget.collect}
          onDone={onTransfersChanged}
          onClose={() => setDebtTarget(null)}
        />
      )}
      {kasaResultOpen && kasaSplitActive && (
        <KasaResultModal
          language={language}
          initialKasaName={source}
          kasaOptions={[...new Set(cashWorkspaces.flatMap((w) => w.allKasas.map((k) => k.name)))]}
          allRecords={allRecords}
          onClose={() => setKasaResultOpen(false)}
        />
      )}
    </div>
  );
}
