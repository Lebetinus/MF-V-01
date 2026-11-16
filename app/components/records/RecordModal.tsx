"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "../shared";
import { debtPairs } from "../../lib/debts";
import { workspaceKeyOf, workspaceOptions, workspaceState } from "../KasaManage";
import { tx, localizeData, noteRelationLabel } from "../../lib/i18n";
import { openAttachment } from "../../lib/attachments";
import { date, money, normalizeRecord, total } from "../../lib/finance";
import type { CashAccountSummary, CashTransfer, FinanceNote, KasaSection, Kind, Language, NoteRelation, NoteStatus, RecordItem, UserAccount } from "../../lib/types";
import { notify } from "../../lib/notify";
import { DETAIL_MAX_CELL, DETAIL_MAX_COLS, DETAIL_MAX_ROWS, DetailTableEditor, parseClipboardTable } from "./detailTable";
import { SuggestInput, TagsInput } from "./inputs";
import { ExcelAttachmentModal } from "./documents";

export function RecordModal({
  language,
  kind: kindProp,
  initial,
  prefillCashAccount,
  prefillWorkspaceKey,
  onSectionsChanged,
  records,
  onCreateNote,
  onClose,
  onSave,
  cashAccounts,
  users,
  onTransfersChanged,
  sections = [],
}: {
  language: Language;
  kind: Kind;
  initial?: RecordItem;
  prefillCashAccount?: string;
  prefillWorkspaceKey?: string;
  onSectionsChanged?: () => void;
  sections?: KasaSection[];
  records: RecordItem[];
  onCreateNote: (input: Omit<FinanceNote, "id" | "createdAt" | "updatedAt" | "isArchived" | "archivedAt">) => void;
  onClose: () => void;
  onSave: (x: Omit<RecordItem, "id">, id?: number) => void;
  cashAccounts: CashAccountSummary[];
  users: UserAccount[];
  onTransfersChanged: () => void;
}) {
  // Yeni Gelir/Gider/Borç kaydında tür, pencerenin içinden değiştirilebilir.
  const [kind, setKindState] = useState<Kind>(kindProp);
  const defaultNoteRelation: NoteRelation =
    kind === "cash" ? "cash" : kind === "income" ? "income" : "expense";
  const [financeNote, setFinanceNote] = useState("");
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [financeNoteStatus, setFinanceNoteStatus] = useState<NoteStatus>("pending");
  const [financeNoteRelation, setFinanceNoteRelation] = useState<NoteRelation>(defaultNoteRelation);
  const [financeNoteRelationDetail, setFinanceNoteRelationDetail] = useState("");
  const financeNoteStatusOptions: { id: NoteStatus; label: string }[] = [
    { id: "important", label: tx(language, "Önemli Notlar", "Important Notes", "Nîşeyên Girîng") },
    { id: "urgent", label: tx(language, "Acil Notlar", "Urgent Notes", "Nîşeyên Acîl") },
    { id: "pending", label: tx(language, "Bekleyen Notlar", "Pending Notes", "Nîşeyên Li Bendê") },
    { id: "completed", label: tx(language, "Tamamlanmış Notlar", "Completed Notes", "Nîşeyên Qediyayî") },
  ];
  const financeNoteRelationOptions: NoteRelation[] = ["none", "cash", "income", "expense", "reports", "archive", "other"];
  const financeNoteTitleOptions = [
    ...new Set(
      records
        .filter(
          (x) =>
            x.kind === financeNoteRelation ||
            (financeNoteRelation === "income" && x.kind === "cash"),
        )
        .map((x) => x.source)
        .filter(Boolean),
    ),
  ];
  const base = initial
    ? normalizeRecord(initial)
    : {
        kind,
        date: new Date().toISOString().slice(0, 10),
        source: "",
        detail: "",
        note: "",
        person: "",
        amount: 0,
        currency: "USD",
        project: "",
        tags: [],
        link: "",
        cashAccount: kind === "cash" ? "" : prefillCashAccount ?? "",
        listName: "",
        attachments: [],
        detailTable: [],
        detailTableLayout: { cols: [], rows: [], colAlign: [], cellAlign: {} },
      };
  // Always seed the form with the raw stored values, never the display-only
  // Kurdish demo translations — otherwise saving without touching a field
  // (or picking a translated autocomplete suggestion below) would write the
  // translated string back to the database, breaking cashAccount name
  // matching and silently corrupting data across languages.
  const [form, setForm] = useState<Omit<RecordItem, "id">>(base);
  const debtModeNow = form.debtMode ?? "";
  const tone: "cash" | "in" | "out" | "debt" = kind === "cash" ? "cash" : kind === "income" ? "in" : debtModeNow !== "" ? "debt" : "out";
  function switchType(next: "in" | "out" | "debt") {
    const nextKind: Kind = next === "in" ? "income" : "expense";
    setKindState(nextKind);
    setSectionId(null);
    setFinanceNoteRelation(nextKind);
    setForm((f) => ({ ...f, kind: nextKind, debtMode: next === "debt" ? (f.debtMode || "lent") : "", debtCashAccountId: null }));
  }
  // "Liste Kasası": işaretlenen kasa Listeler sayfasında otomatik çalışma alanı olur ve Kasalar'daki Liste Kasaları bölümüne gelir.
  const [sectionId, setSectionId] = useState<number | null>(() => (prefillWorkspaceKey && !initial && kind === "cash" ? workspaceState(prefillWorkspaceKey, { rjKasa: false, listKasa: false }).sectionId : kind === "cash" ? cashAccounts?.find((a) => a.name === base.source)?.sectionId ?? null : (base as RecordItem).sectionId ?? null));
  const [rjKasa, setRjKasa] = useState(() => (prefillWorkspaceKey && !initial && kind === "cash" ? workspaceState(prefillWorkspaceKey, { rjKasa: false, listKasa: false }).rjKasa : kind === "cash" && !!cashAccounts?.some((a) => a.name === base.source && a.isRjKasa)));
  const [listKasa, setListKasa] = useState(() => (prefillWorkspaceKey && !initial && kind === "cash" ? workspaceState(prefillWorkspaceKey, { rjKasa: false, listKasa: false }).listKasa : kind === "cash" && !!cashAccounts?.some((a) => a.name === base.source && a.isListWorkspace)));
  // Gider eklerken "Borç" işareti: lent = başka bir kasaya borç veriyorum, repay = borcumu ödüyorum (karşı kasa seçilir).
  // Karşı kasa yalnız kullanıcının erişebildiği kasalardan seçilir (sunucu da aynı kuralı uygular).
  const debtMode = form.debtMode ?? "";
  const ownKasaId = cashAccounts.find((a) => a.name === form.cashAccount)?.id;
  // Borcumu öderken: bu kasanın borcu olduğu (seçili para biriminde kalan borcu bulunan) alacaklı kasalar.
  const repayOptions = debtPairs(records).filter((p) => p.debtorName === form.cashAccount && p.currency === form.currency && p.outstanding > 0.004);
  const lentOptions = cashAccounts.filter((k) => k.id !== ownKasaId).map((k) => ({ id: k.id, name: k.name }));
  const pickDebtKasa = (idText: string) => {
    const id = idText ? Number(idText) : null;
    let amount = form.amount;
    if (debtMode === "repay" && id) {
      const remaining = repayOptions.find((p) => p.creditorId === id)?.outstanding ?? 0;
      // Ödeme tutarı kalan borca göre otomatik düzenlenir.
      if (remaining > 0 && (!amount || amount > remaining)) amount = remaining;
    }
    setForm({ ...form, debtCashAccountId: id, amount });
  };
  // Kasa formundan, seçili çalışma alanının içinde hızlıca yeni bölüm oluşturur ve onu seçer.
  const [inlineSectionOpen, setInlineSectionOpen] = useState(false);
  const [inlineSectionName, setInlineSectionName] = useState("");
  const [inlineSectionError, setInlineSectionError] = useState("");
  async function createInlineSection() {
    const name = inlineSectionName.trim();
    if (!name) return;
    const key = workspaceKeyOf({ sectionId, rjKasa, listKasa }, sections);
    const selected = key.startsWith("sec-") ? sections.find((x) => `sec-${x.id}` === key) : undefined;
    const parentKey = selected?.parentKey ?? key; // bölümün içine bölüm yok: üst alanını kullan
    try {
      const response = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "cash", name, color: "#7b52bf", parentKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInlineSectionError(response.status === 403 ? tx(language, "Bölümü yalnızca yönetici oluşturabilir.", "Only an administrator can create a section.", "Beşê tenê rêvebir dikare çêke.") : response.status === 409 ? tx(language, "Bu adla bir bölüm zaten var.", "A section with this name already exists.", "Beşa bi vî navî heye.") : body.error || tx(language, "Bölüm oluşturulamadı.", "The section could not be created.", "Beş nehat çêkirin."));
        return;
      }
      setSectionId(body.section.id);
      setRjKasa(false);
      setListKasa(false);
      setInlineSectionOpen(false);
      setInlineSectionName("");
      setInlineSectionError("");
      onSectionsChanged?.();
    } catch {
      setInlineSectionError(tx(language, "Bölüm oluşturulamadı.", "The section could not be created.", "Beş nehat çêkirin."));
    }
  }
  // Yeni kasa kaydında mevcut bir kasanın adı yazılırsa o kasanın çalışma alanı yüklenir (yanlışlıkla değiştirilmesin).
  useEffect(() => {
    if (kind !== "cash" || initial) return;
    const account = cashAccounts?.find((a) => a.name === form.source.trim());
    if (!account) return;
    setSectionId(account.sectionId ?? null);
    setRjKasa(!!account.isRjKasa);
    setListKasa(!!account.isListWorkspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.source]);
  // "Gider Detaylarını Görüntüle" bölümü kayıt penceresi her açıldığında
  // kapalı başlar (detay kayıtlıysa bile); açılınca tablonun tamamı görünür.
  const [detailTrimmed, setDetailTrimmed] = useState(false);
  const [detailPasteHint, setDetailPasteHint] = useState("");
  const [excelView, setExcelView] = useState<{ name: string; data: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const previous = (field: "source" | "person" | "project" | "listName") => [
    ...new Set(
      records
        .filter((x) => field !== "source" || x.kind === kind)
        .map((x) => x[field])
        .filter(Boolean),
    ),
  ];
  const previousTags = [...new Set(records.flatMap((x) => x.tags))];
  // Excel/Office/PDF ekleri (birden fazla olabilir) — avatar/logo ile aynı
  // desen: her dosya base64 data URL'e çevrilip form state'teki diziye
  // eklenir, kayıtla birlikte gönderilir. Sunucudaki sınırlarla aynı
  // seviyede burada da erken uyarı verilir.
  const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
  const MAX_ATTACHMENTS = 5;
  // Dosya okunurken (FileReader eşzamansız) Kaydet'e basılırsa belge kayda girmiyordu: okuma bitene kadar Kaydet bekletilir.
  const [readingFiles, setReadingFiles] = useState(0);
  function pickAttachments(files: FileList | null) {
    if (!files || !files.length) return;
    const room = MAX_ATTACHMENTS - (form.attachments?.length ?? 0);
    if (room <= 0) {
      notify(
        tx(
          language,
          `En fazla ${MAX_ATTACHMENTS} dosya eklenebilir.`,
          `You can attach at most ${MAX_ATTACHMENTS} files.`,
          `Herî zêde ${MAX_ATTACHMENTS} pel dikarin werin pêvekirin.`,
        ),
      );
      return;
    }
    const selected = Array.from(files).slice(0, room);
    for (const file of selected) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        notify(
          tx(
            language,
            `"${file.name}" çok büyük (en fazla 6MB).`,
            `"${file.name}" is too large (max 6MB).`,
            `"${file.name}" pir mezin e (herî zêde 6MB).`,
          ),
        );
        continue;
      }
      const reader = new FileReader();
      setReadingFiles((n) => n + 1);
      reader.onerror = () => {
        setReadingFiles((n) => Math.max(0, n - 1));
        notify(tx(language, `"${file.name}" okunamadı.`, `"${file.name}" could not be read.`, `"${file.name}" nehat xwendin.`));
      };
      // Functional update — birden çok dosya aynı anda seçildiğinde her
      // FileReader kendi temposunda tamamlanır; kapalı (closure) bir
      // `form` üzerinden yazmak eş zamanlı okumalardan birini kaybettirir.
      reader.onload = () => {
        setForm((f) => ({
          ...f,
          attachments: [...(f.attachments ?? []), { name: file.name, data: String(reader.result) }],
        }));
        setReadingFiles((n) => Math.max(0, n - 1));
      };
      reader.readAsDataURL(file);
    }
  }
  function removeAttachment(index: number) {
    setForm({ ...form, attachments: (form.attachments ?? []).filter((_, i) => i !== index) });
  }
  // "İndir" — her dosya türü için, bu uygulamadaki "Excel'e Çıkar" ile aynı,
  // kanıtlanmış yöntem: download özellikli gizli bir <a>. target="_blank"
  // kullanılmıyor; bu yüzden hiçbir popup/engelleme sorunu yaşanmıyor.
  function downloadAttachment(attachment: { name: string; data: string }) {
    try {
      openAttachment(attachment, { forceDownload: true });
    } catch {
      const link = document.createElement("a");
      link.href = attachment.data;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }
  const detailBodyRef = useRef<HTMLDivElement>(null);
  // "Yapıştır" butonu: panodaki tabloyu okur. Tarayıcı pano okumaya izin
  // vermezse (izin istemi reddedildi / desteklenmiyor) kullanıcıya Ctrl+V'yi
  // önerir ve alanı odaklar — Ctrl+V her zaman çalışır (aşağıdaki onPaste).
  async function pasteDetailFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        pasteDetailTable(text);
        return;
      }
      setDetailPasteHint(tx(language, "Panoda yapıştırılacak bir tablo yok. Excel veya Google Sheets'ten hücreleri kopyalayıp tekrar deneyin.", "There is no table on the clipboard. Copy cells from Excel or Google Sheets and try again.", "Di panoyê de tablo tune. Şaneyan ji Excel an Google Sheets kopî bike û dîsa biceribîne."));
    } catch {
      // Tarayıcı/uygulama panoyu doğrudan okutmuyorsa: kutuya odaklan ve
      // kullanıcıdan Ctrl+V'ye basmasını iste (kutu Ctrl+V'yi doğrudan işler).
      detailBodyRef.current?.focus();
      setDetailPasteHint(tx(language, "Şimdi klavyeden Ctrl+V tuşlarına basın — kopyaladığınız tablo yapıştırılacak.", "Now press Ctrl+V on your keyboard — the copied table will be pasted.", "Niha Ctrl+V bitikîne — tabloya kopîkirî dê bê bi cih kirin."));
    }
  }
  function pasteDetailTable(text: string) {
    const raw = parseClipboardTable(text);
    if (!raw.length) return;
    const parsed = raw
      .slice(0, DETAIL_MAX_ROWS)
      .map((r) => r.slice(0, DETAIL_MAX_COLS).map((c) => c.slice(0, DETAIL_MAX_CELL)));
    // Sunucunun kabul ettiği sınırlara göre kırpıldıysa kullanıcıya haber ver
    // (sessizce veri kaybı olmasın).
    setDetailTrimmed(
      raw.length > DETAIL_MAX_ROWS ||
        raw.some((r) => r.length > DETAIL_MAX_COLS || r.some((c) => c.length > DETAIL_MAX_CELL)),
    );
    setDetailPasteHint("");
    setForm((f) => ({ ...f, detailTable: parsed, detailTableLayout: { cols: [], rows: [], colAlign: [], cellAlign: {} } }));
  }
  function commitSave() {
    if (financeNote.trim()) {
      onCreateNote({
        title: form.source.trim() || tx(language, "Mali Özel Not", "Private Finance Note", "Nîşeya Darayî ya Taybet"),
        content: financeNote.trim(),
        status: financeNoteStatus,
        relation: financeNoteRelation,
        relationDetail: financeNoteRelation === "none" ? "" : (financeNoteRelationDetail.trim() || form.source),
        assignedUserIds: [],
      });
    }
    onSave(kind === "cash" ? { ...form, listKasa, rjKasa, sectionId } : { ...form, sectionId }, initial?.id);
  }
  const rfHero = (
    <div className="wide rfHero">
      <div className="rfAmt">
        <span>{kind === "cash" ? tx(language, "Açılış bakiyesi", "Opening balance", "Bakiya destpêkê") : tx(language, "Tutar", "Amount", "Meblağ")}</span>
        <div>
          <i aria-hidden="true">{form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "TRY" ? "₺" : form.currency}</i>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder="0,00"
            value={form.amount || ""}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            aria-label={tx(language, "Tutar", "Amount", "Meblağ")}
          />
        </div>
      </div>
      <div className="rfCur" role="group" aria-label={tx(language, "Para birimi", "Currency", "Yekeya Pere")}>
        {["USD", "EUR", "IQD", "SYP", "TRY"].map((c) => (
          <button key={c} type="button" className={form.currency === c ? "on" : ""} aria-pressed={form.currency === c} onClick={() => setForm({ ...form, currency: c })}>{c}</button>
        ))}
      </div>
    </div>
  );
  const sec = (text: string) => <div className="wide rfSec"><span>{text}</span></div>;
  // Kasa seçimi: Çalışma Alanı › Bölüm başlıkları altında gruplanır.
  const rfWsOptions = workspaceOptions(sections, language);
  const rfWsOf = (name: string) => {
    const a = cashAccounts.find((x) => x.name === name);
    const key = a ? workspaceKeyOf({ sectionId: a.sectionId ?? null, rjKasa: !!a.isRjKasa, listKasa: !!a.isListWorkspace }, sections) : "genel";
    return rfWsOptions.find((o) => o.key === key)?.label || tx(language, "Diğer", "Other", "Yên din");
  };
  const kasaGroups = (() => {
    const names = [...new Set([...records.filter((x) => x.kind === "cash").map((x) => x.source), ...cashAccounts.map((a) => a.name), form.cashAccount || ""].filter(Boolean))];
    const map = new Map<string, string[]>();
    for (const n of names) { const g = rfWsOf(n); map.set(g, [...(map.get(g) ?? []), n]); }
    const order = rfWsOptions.map((o) => o.label);
    return [...map.entries()]
      .sort((x, y) => (order.indexOf(x[0]) + 1 || 999) - (order.indexOf(y[0]) + 1 || 999))
      .map(([label, list]) => ({ label, names: list.sort((p, q) => p.localeCompare(q)) }));
  })();
  const toneLabel = tone === "in" ? tx(language, "Gelir", "Income", "Dahat") : tone === "out" ? tx(language, "Gider", "Expense", "Mesref") : tone === "debt" ? tx(language, "Borç", "Debt", "Deyn") : tx(language, "Kasa", "Cash account", "Qase");
  const rfSource = (          <label>
            <span>{kind === "cash"
              ? tx(language, "Kasa Adı", "Cash Account", "Navê Qaseyê")
              : kind === "income"
                ? tx(
                    language,
                    "Gelir Ana Başlığı",
                    "Income Category",
                    "Sernavê Dahatê",
                  )
                : tx(
                    language,
                    "Gider Ana Başlığı",
                    "Expense Category",
                    "Sernavê Mesrefê",
                  )} <b className="rfReq">*</b></span>
            <SuggestInput
              required
              value={form.source}
              onChange={(v) => setForm({ ...form, source: v })}
              options={previous("source")}
            />
          </label>
);
  const rfDate = (          <label>
            {tx(language, "Tarih", "Date", "Tarîx")}
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
);
  const rfPerson = (          <label>
            {tx(language, "Kişi", "Person", "Kes")}
            <SuggestInput
              value={form.person}
              onChange={(v) => setForm({ ...form, person: v })}
              options={previous("person")}
            />
          </label>
);
  const rfUnit = (          <label>
            {tx(language, "Birim Adı", "Unit Name", "Navê Yekîneyê")}
            <SuggestInput
              value={form.project}
              onChange={(v) => setForm({ ...form, project: v })}
              options={previous("project")}
            />
          </label>
);
  const rfDetail = (          <label>
            {tx(language, "Detay", "Detail", "Hûragahî")}
            <input
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
            />
          </label>
);
  const rfTags = (          <label>
            {tx(language, "Etiketler", "Tags", "Etîket")}
            <TagsInput
              tags={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
              options={previousTags}
              placeholder={tx(
                language,
                "Örn: maaş, sabit, solar",
                "E.g. salary, fixed, solar",
                "Mînak: mûçe, sabît, solar",
              )}
            />
          </label>
);
  const linkValue = (form.link ?? "").trim();
  const linkHref = /^https?:\/\//i.test(linkValue) ? linkValue : linkValue ? `https://${linkValue}` : "";
  const rfLink = (
    <label>
      {tx(language, "Link", "Link", "Lînk")}
      <span className="rfLinkRow">
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          value={form.link ?? ""}
          placeholder="https://…"
          onChange={(e) => setForm({ ...form, link: e.target.value })}
        />
        {linkHref && (
          <a className="rfLinkOpen" href={linkHref} target="_blank" rel="noopener noreferrer" title={tx(language, "Bağlantıyı yeni sekmede aç", "Open the link in a new tab", "Lînkê di tabeke nû de veke")}>↗</a>
        )}
      </span>
    </label>
  );
  const rfKasa = kind !== "cash" && (
            <label>
              <span>{tx(language, "Kasa", "Cash account", "Qase")} <b className="rfReq">*</b></span>
              <select
                required
                value={form.cashAccount || ""}
                onChange={(e) => setForm({ ...form, cashAccount: e.target.value })}
              >
                <option value="" disabled>
                  {tx(language, "Kasa seçin (zorunlu)", "Select a cash account (required)", "Qaseyekê hilbijêre (mecbûrî)")}
                </option>
                {kasaGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.names.map((name) => <option key={name} value={name}>{localizeData(name, language)}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          );
  const rfDebt = kind === "expense" && !initial && debtMode !== "" && (
            <div className="wide debtBlock">
              {(
                <div className="debtBlockBody">
                  <label>
                    {tx(language, "Borç türü", "Debt type", "Cureyê deynê")}
                    <select value={debtMode} onChange={(e) => setForm({ ...form, debtMode: e.target.value as "lent" | "repay", debtCashAccountId: null })}>
                      <option value="lent">{tx(language, "Borç veriyorum (başka kasaya)", "I am lending (to another kasa)", "Deyn didim (ji qaseyeke din re)")}</option>
                      <option value="repay">{tx(language, "Borcumu ödüyorum", "I am repaying a debt", "Deynê xwe didim")}</option>
                    </select>
                  </label>
                  <label>
                    {debtMode === "lent" ? tx(language, "Borç verilen kasa", "Kasa lent to", "Qaseya deyn lê hat dayîn") : tx(language, "Borcun ödeneceği kasa", "Kasa to repay", "Qaseya deyn lê tê dayîn")}
                    <select required value={form.debtCashAccountId ?? ""} onChange={(e) => pickDebtKasa(e.target.value)}>
                      <option value="" disabled>{tx(language, "Kasa seçin", "Select a kasa", "Qaseyekê hilbijêre")}</option>
                      {debtMode === "lent"
                        ? lentOptions.map((k) => <option key={k.id} value={k.id}>{localizeData(k.name, language)}</option>)
                        : repayOptions.map((p) => <option key={p.creditorId} value={p.creditorId}>{localizeData(p.creditorName, language)} — {tx(language, "kalan", "remaining", "mayî")} {money(p.outstanding, p.currency)}</option>)}
                    </select>
                  </label>
                  {debtMode === "repay" && repayOptions.length === 0 && (
                    <small className="debtHint">{tx(language, "Bu kasanın seçili para biriminde kalan borcu yok.", "This kasa has no outstanding debt in the selected currency.", "Vê qaseyê bi vê diravê deynê mayî tune.")}</small>
                  )}
                  <small className="debtHint">
                    {debtMode === "lent"
                      ? tx(language, "Tutar bu kasanın giderinde görünür; borç alan kasaya otomatik giriş yazılır ve orada “Borç Tutarı” olarak görünür.", "The amount is shown as this kasa's expense; the borrowing kasa automatically gets an entry and shows it as “Debt Amount”.", "Mêjer wekî mesrefa vê qaseyê xuya dibe; qaseya deyn digire bixwe tê tomarkirin.")
                      : tx(language, "Ödeme, borç alan kasanın giderinde görünür; borç miktarı ve borç veren kasanın verdiği gider ödeme kadar otomatik azalır.", "The payment appears in this kasa's expenses; the debt and the lender's lent expense decrease automatically by the amount paid.", "Dravdan di mesrefa vê qaseyê de xuya dibe; deyn û mesrefa qaseya deyn daye bixwe kêm dibin.")}
                  </small>
                </div>
              )}
            </div>
          );
  const rfSection = kind !== "cash" && sections.some((x) => x.scope === kind) && (
            <label>
              {tx(language, "Bölüm", "Section", "Beş")}
              <select value={sectionId ?? ""} onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{tx(language, "Bölümsüz", "No section", "Bê beş")}</option>
                {sections.filter((x) => x.scope === kind).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </label>
          );
  return (
    <div className="overlay overlayScrollThrough">
      <form
        className={`modal recordModal rf-${tone}`}
        onSubmit={(e) => {
          e.preventDefault();
          const duplicate = records.find((x) => x.id !== initial?.id && x.kind === kind && x.date === form.date && x.amount === form.amount && x.currency === form.currency && (x.cashAccount || "") === (form.cashAccount || "") && x.source === form.source);
          if (duplicate) {
            setDuplicateConfirmOpen(true);
            return;
          }
          commitSave();
        }}
      >
        <div className="modalHead rfHead">
          <span className={`rfIcon ${tone}`} aria-hidden="true">{tone === "in" ? "↗" : tone === "out" ? "↘" : tone === "debt" ? "⇄" : "▣"}</span>
          <div className="rfTitle">
            <h2>
              {initial
                ? tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")
                : kind === "cash"
                  ? tx(language, "Yeni kasa", "New cash account", "Qaseya nû")
                  : `${toneLabel} ${tx(language, "ekle", "add", "zêde bike")}`}
            </h2>
            <p>
              {initial
                ? tx(language, "Eski hali otomatik olarak Arşiv bölümünde saklanacaktır.", "The previous version will be stored automatically in Archive.", "Rewşa berê dê bixweber di Arşîvê de were parastin.")
                : tx(language, "Daha önce kullanılan bilgiler alanlarda öneri olarak görünür.", "Previously used information appears as suggestions.", "Agahiyên berê hatine bikaranîn wek pêşniyar xuya dibin.")}
            </p>
          </div>
          {!initial && kind !== "cash" && (
            <div className="rfType" role="tablist" aria-label={tx(language, "Kayıt türü", "Record type", "Cureyê qeydê")}>
              {([["in", tx(language, "Gelir", "Income", "Dahat")], ["out", tx(language, "Gider", "Expense", "Mesref")], ["debt", tx(language, "Borç", "Debt", "Deyn")]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tone === id} className={`${id}${tone === id ? " on" : ""}`} onClick={() => switchType(id)}>{label}</button>
              ))}
            </div>
          )}
          <button type="button" className="rfClose" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>
            ×
          </button>
        </div>
        <div className="formGrid">
          {kind !== "cash" && rfHero}
          {sec(kind === "cash" ? tx(language, "KASA", "CASH ACCOUNT", "QASE") : tx(language, "NEREYE", "WHERE", "KU"))}
          {kind === "cash" ? rfSource : rfKasa}
          {rfDate}
          {rfDebt}
          {rfSection}
          {kind === "cash" && rfHero}
          {sec(kind === "cash" ? tx(language, "AYRINTILAR", "DETAILS", "HÛRGULÎ") : tx(language, "NE İÇİN", "WHAT FOR", "BI ÇI"))}
          {kind !== "cash" && rfSource}
          {rfPerson}
          {rfUnit}
          {rfDetail}
          {rfTags}
          {rfLink}
          {kind === "cash" && (
          <fieldset className="wide listFieldset">
            <legend>{tx(language, "Çalışma Alanı", "Workspace", "Qada Xebatê")}</legend>
            <label>
                {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")}
                <select
                  value={workspaceKeyOf({ sectionId, rjKasa, listKasa }, sections)}
                  onChange={(e) => {
                    const next = workspaceState(e.target.value, { rjKasa, listKasa });
                    setSectionId(next.sectionId);
                    setRjKasa(next.rjKasa);
                    setListKasa(next.listKasa);
                    if (next.listKasa) {
                      setForm((f) => ({ ...f, listName: f.listName || f.source.trim() }));
                    }
                  }}
                >
                  {workspaceOptions(sections, language).map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <small className="listKasaHint">{tx(language, "Her kasa mutlaka bir çalışma alanına (ya da onun bir bölümüne) bağlıdır.", "Every cash account belongs to a workspace (or one of its sections).", "Her qase girêdayî qada xebatê (an beşekî wê) ye.")}</small>
            </label>
            {!initial && (
              <div className="inlineSectionRow">
                {!inlineSectionOpen ? (
                  <button type="button" className="light compact" onClick={() => setInlineSectionOpen(true)}>
                    ＋ {tx(language, "Bölüm oluştur (seçili çalışma alanında)", "Create section (in selected workspace)", "Beş çêke (di qada hilbijartî de)")}
                  </button>
                ) : (
                  <>
                    <input value={inlineSectionName} autoFocus maxLength={80} placeholder={tx(language, "Bölüm adı", "Section name", "Navê beşê")} onChange={(e) => setInlineSectionName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createInlineSection(); } }} />
                    <button type="button" className="primary compact" disabled={!inlineSectionName.trim()} onClick={createInlineSection}>{tx(language, "Oluştur", "Create", "Çêke")}</button>
                    <button type="button" className="light compact" onClick={() => { setInlineSectionOpen(false); setInlineSectionError(""); }}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
                  </>
                )}
                {inlineSectionError && <small className="kasaManageError">{inlineSectionError}</small>}
              </div>
            )}
          </fieldset>
          )}
          {sec(tx(language, "EK BİLGİ", "EXTRA", "ZÊDE"))}
          <label className="wide">
            {tx(language, "Belgeler", "Documents", "Belge")}
            <div className="rfDrop">
              <b aria-hidden="true">⇪</b>
              <span>{tx(language, "Dosyayı sürükleyip bırakın veya ", "Drag a file here or ", "Pelê bikişîne vir an ")}<u>{tx(language, "bilgisayardan seçin", "browse", "hilbijêre")}</u></span>
              <small>{tx(language, "Excel, Office, PDF · en fazla 5 dosya · her biri 6 MB", "Excel, Office, PDF · up to 5 files · 6 MB each", "Excel, Office, PDF · heta 5 pel · her yek 6 MB")}</small>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.pdf"
                disabled={(form.attachments?.length ?? 0) >= MAX_ATTACHMENTS}
                onChange={(e) => {
                  pickAttachments(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {(form.attachments?.length ?? 0) > 0 && (
              <ul className="attachmentList">
                {form.attachments!.map((att, index) => (
                  <li key={`${att.name}-${index}`}>
                    <small className="attachmentFieldName">{att.name}</small>
                    {/\.(xlsx|xlsm)$/i.test(att.name) && (
                      <button type="button" className="light compact" onClick={() => setExcelView(att)}>
                        ▦ {tx(language, "Excel Detayı", "Excel Detail", "Hûrguliyên Excelê")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="light compact"
                      onClick={() => downloadAttachment(att)}
                    >
                      ⇩ {tx(language, "İndir", "Download", "Daxîne")}
                    </button>
                    <button
                      type="button"
                      className="light compact"
                      onClick={() => removeAttachment(index)}
                    >
                      {tx(language, "Kaldır", "Remove", "Rake")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          {excelView && createPortal(<ExcelAttachmentModal language={language} attachment={excelView} onClose={() => setExcelView(null)} />, document.body)}
          {kind === "expense" && (
            <details
              className="wide detailTableBox"
              open={detailOpen}
              onToggle={(e) => setDetailOpen(e.currentTarget.open)}
              onPaste={(e) => {
                // Hücre içindeki yapıştırma kendi işleyicisinde ele alınır (tek
                // değer normal yapıştırılır, çok hücreli blok hücreden itibaren
                // yerleşir); hücre dışında Ctrl+V tüm tabloyu yapıştırır.
                if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
                e.preventDefault();
                pasteDetailTable(e.clipboardData.getData("text/plain"));
              }}
            >
              <summary>
                {tx(language, "Gider Detaylarını Görüntüle", "View Expense Details", "Hûrguliyên Mesrefê Nîşan Bide")}
                {(form.detailTable?.length ?? 0) > 0 && (
                  <em>
                    {form.detailTable!.length} {tx(language, "satır", "rows", "rêz")}
                  </em>
                )}
              </summary>
              <div
                className="detailTableBody"
                ref={detailBodyRef}
                tabIndex={0}
              >
                {detailTrimmed && (
                  <small className="detailTrimNote">
                    {tx(
                      language,
                      `Tablo çok büyük olduğu için ilk ${DETAIL_MAX_ROWS} satır, ${DETAIL_MAX_COLS} sütun ve hücre başına ${DETAIL_MAX_CELL} karakter alındı.`,
                      `The table was too large, so only the first ${DETAIL_MAX_ROWS} rows, ${DETAIL_MAX_COLS} columns and ${DETAIL_MAX_CELL} characters per cell were kept.`,
                      `Tablo pir mezin bû, tenê ${DETAIL_MAX_ROWS} rêzên pêşîn, ${DETAIL_MAX_COLS} stûn û ${DETAIL_MAX_CELL} tîpên her şaneyê hatin girtin.`,
                    )}
                  </small>
                )}
                <DetailTableEditor
                  language={language}
                  table={form.detailTable ?? []}
                  layout={form.detailTableLayout ?? { cols: [], rows: [] }}
                  onChange={(table, layout) => setForm((f) => ({ ...f, detailTable: table, detailTableLayout: layout }))}
                />
                <div className="detailActions">
                  <button type="button" className="light compact" onClick={pasteDetailFromClipboard}>
                    ⎘ {tx(language, "Yapıştır (Ctrl+V)", "Paste (Ctrl+V)", "Bi cih bike (Ctrl+V)")}
                  </button>
                  {detailPasteHint && <small className="detailTrimNote">{detailPasteHint}</small>}
                  {(form.detailTable?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      className="light compact"
                      onClick={() => setForm((f) => ({ ...f, detailTable: [], detailTableLayout: { cols: [], rows: [], colAlign: [], cellAlign: {} } }))}
                    >
                      {tx(language, "Detayı Temizle", "Clear Details", "Hûrguliyan Paqij Bike")}
                    </button>
                  )}
                </div>
              </div>
            </details>
          )}
          <div className="wide notesRow">
            <label>
              {tx(language, "Not", "Note", "Nîşe")}
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            <label>
              {tx(language, "Mali Özel Not", "Private Finance Note", "Nîşeya Darayî ya Taybet")}
              <textarea
                rows={3}
                value={financeNote}
                onChange={(e) => setFinanceNote(e.target.value)}
                placeholder={tx(
                  language,
                  "Bu kayıtla ilişkili mali özel not…",
                  "A private finance note linked to this record…",
                  "Nîşeyeke darayî ya taybet a girêdayî vê qeydê…",
                )}
              />
            </label>
          </div>
          {financeNote.trim() && (
            <div className="wide notesRow noteExpand">
              <label>
                {tx(language, "Not Durumu", "Note Status", "Rewşa Nîşeyê")}
                <select
                  value={financeNoteStatus}
                  onChange={(e) => setFinanceNoteStatus(e.target.value as NoteStatus)}
                >
                  {financeNoteStatusOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tx(language, "İlişkili Bölüm", "Linked Section", "Beşa Girêdayî")}
                <select
                  value={financeNoteRelation}
                  onChange={(e) => {
                    setFinanceNoteRelation(e.target.value as NoteRelation);
                    setFinanceNoteRelationDetail("");
                  }}
                >
                  {financeNoteRelationOptions.map((option) => (
                    <option key={option} value={option}>
                      {noteRelationLabel(option, language)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                {tx(language, "İlişkili Başlık", "Linked Title", "Sernavê Girêdayî")}
                <SuggestInput
                  disabled={financeNoteRelation === "none"}
                  value={financeNoteRelationDetail}
                  onChange={setFinanceNoteRelationDetail}
                  options={financeNoteTitleOptions}
                  placeholder={
                    financeNoteRelation === "none"
                      ? ""
                      : form.source ||
                        tx(language, "Başlık seçin veya yazın", "Choose or type a title", "Sernav hilbijêre an binivîse")
                  }
                />
              </label>
            </div>
          )}
        </div>
        {kind === "cash" && initial && (
          <div className="cashHistory">
            <h3>
              {tx(language, "Kasa Hareketleri", "Cash Account History", "Tevgerên Qaseyê")}
            </h3>
            {(() => {
              const linkedIncome = total(
                records.filter(
                  (x) => x.kind === "income" && x.cashAccount === initial.source,
                ),
              );
              const linkedExpense = total(
                records.filter(
                  (x) => x.kind === "expense" && x.cashAccount === initial.source,
                ),
              );
              const totalIn = initial.amount + linkedIncome;
              const totalOut = linkedExpense;
              const net = totalIn - totalOut;
              const remainingPercent = totalIn
                ? Math.round((net / totalIn) * 100)
                : 0;
              return (
                <div className="cashHistoryStats">
                  <div>
                    <small>{tx(language, "Toplam Giriş", "Total In", "Giştî Têketin")}</small>
                    <strong>{money(totalIn)}</strong>
                  </div>
                  <div>
                    <small>{tx(language, "Toplam Gider", "Total Out", "Giştî Derketin")}</small>
                    <strong className="negative">{money(totalOut)}</strong>
                  </div>
                  <div>
                    <small>{tx(language, "Net Bakiye", "Net Balance", "Bakiya Paqij")}</small>
                    <strong>{money(net)}</strong>
                  </div>
                  <div>
                    <small>{tx(language, "Kalan %", "Remaining %", "% Mayî")}</small>
                    <strong>%{remainingPercent}</strong>
                  </div>
                </div>
              );
            })()}
            <div className="cashHistoryList">
              {records
                .filter((x) => x.kind !== "cash" && x.cashAccount === initial.source)
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((x) => (
                  <div className="cashHistoryRow" key={x.id}>
                    <span>{date(x.date, language)}</span>
                    <span>
                      {x.kind === "income"
                        ? tx(language, "Gelir", "Income", "Dahat")
                        : tx(language, "Gider", "Expense", "Mesref")}
                    </span>
                    <span>{localizeData(x.source, language)}</span>
                    <strong className={x.kind === "expense" ? "negative" : ""}>
                      {x.kind === "income" ? "+" : "−"}
                      {money(x.amount, x.currency)}
                    </strong>
                  </div>
                ))}
              {!records.some(
                (x) => x.kind !== "cash" && x.cashAccount === initial.source,
              ) && (
                <div className="cashHistoryEmpty">
                  {tx(
                    language,
                    "Bu kasaya bağlı hareket yok.",
                    "No transactions linked to this cash account.",
                    "Tevgerek girêdayî vê qaseyê tune.",
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {kind === "cash" && initial && (
          <KasaTransferSection
            language={language}
            kasa={initial}
            cashAccounts={cashAccounts}
            users={users}
            onTransfersChanged={onTransfersChanged}
          />
        )}
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>
            {tx(language, "Vazgeç", "Cancel", "Betal")}
          </button>
          <button className={`primary rfSave ${tone}`} disabled={readingFiles > 0} title={readingFiles > 0 ? tx(language, "Dosya okunuyor, lütfen bekleyin", "Reading file, please wait", "Pel tê xwendin, ji kerema xwe bisekine") : undefined}>
            {readingFiles > 0
              ? tx(language, "⏳ Dosya yükleniyor…", "⏳ Loading file…", "⏳ Pel tê barkirin…")
              : initial
              ? tx(
                  language,
                  "Değişiklikleri Kaydet",
                  "Save Changes",
                  "Guherînan Tomar Bike",
                )
              : kind === "cash"
              ? tx(language, "Kasayı kaydet", "Save cash account", "Qaseyê tomar bike")
              : `${toneLabel} ${tx(language, "kaydet", "save", "tomar bike")}`}
          </button>
        </div>
      </form>
      {duplicateConfirmOpen && (
        <ConfirmModal
          language={language}
          message={tx(
            language,
            `Aynı tarih ve tutarla benzer bir kayıt bulundu (${form.date} · ${money(form.amount, form.currency)}). Bu kaydı yine de eklemek istediğinizden emin misiniz?`,
            `A similar record exists with the same date and amount (${form.date} · ${money(form.amount, form.currency)}). Save anyway?`,
            `Qeydek mîna vê bi heman tarîx û meblağê heye. Dîsa tomar bike?`,
          )}
          onClose={() => setDuplicateConfirmOpen(false)}
          onConfirm={() => {
            setDuplicateConfirmOpen(false);
            commitSave();
          }}
        />
      )}
    </div>
  );
}

// "Kasa Aktarımı": moves money from `kasa` to another kasa (existing or
// brand new), pending until the recipient side confirms receipt — see
// app/api/cash-transfers. Nothing here touches app/page.tsx's `records`
// state directly; a confirm calls `onTransfersChanged` so the parent
// refetches and every kasa's balance reflects the new ledger rows.
export function KasaTransferSection({
  language,
  kasa,
  cashAccounts,
  users,
  onTransfersChanged,
}: {
  language: Language;
  kasa: RecordItem;
  cashAccounts: CashAccountSummary[];
  users: UserAccount[];
  onTransfersChanged: () => void;
}) {
  const thisAccount = cashAccounts.find((a) => a.name === kasa.source);
  const [open, setOpen] = useState(false);
  const [transfers, setTransfers] = useState<CashTransfer[] | null>(null);
  const [allAccounts, setAllAccounts] = useState<{ id: number; name: string }[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [targetId, setTargetId] = useState("");
  const [newKasaName, setNewKasaName] = useState("");
  const [recipientPerson, setRecipientPerson] = useState("");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [tDate, setTDate] = useState(new Date().toISOString().slice(0, 10));
  const [tAmount, setTAmount] = useState(0);
  const [tCurrency, setTCurrency] = useState("USD");
  const [tDetail, setTDetail] = useState("");
  const [tNote, setTNote] = useState("");
  const [sentConfirmed, setSentConfirmed] = useState(false);

  async function loadTransfers() {
    try {
      const response = await fetch("/api/cash-transfers");
      const data = await response.json().catch(() => ({}));
      setTransfers(response.ok ? (data.cashTransfers ?? []) : []);
    } catch {
      setTransfers([]);
    }
  }

  async function loadAllAccounts() {
    try {
      const response = await fetch("/api/cash-accounts/all");
      const data = await response.json().catch(() => ({}));
      setAllAccounts(response.ok ? (data.cashAccounts ?? []) : []);
    } catch {
      setAllAccounts([]);
    }
  }

  useEffect(() => {
    loadTransfers();
    loadAllAccounts();
     
  }, [kasa.source]);

  const outgoing = (transfers ?? []).filter((t) => t.fromCashAccountId === thisAccount?.id);
  const incoming = (transfers ?? []).filter((t) => t.toCashAccountId === thisAccount?.id);
  // Every kasa in the system, not just the ones this user can already see —
  // sending money to a kasa shouldn't require having view access to it.
  const otherAccounts = (allAccounts ?? cashAccounts).filter((a) => a.id !== thisAccount?.id);
  const valid = Boolean(thisAccount) && tAmount > 0 && Boolean(targetId || newKasaName.trim()) && sentConfirmed;

  async function submitTransfer() {
    if (!thisAccount || !valid) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/cash-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCashAccountId: thisAccount.id,
          ...(targetId ? { toCashAccountId: Number(targetId) } : { toCashAccountName: newKasaName.trim() }),
          amount: tAmount,
          currency: tCurrency,
          date: tDate,
          detail: tDetail,
          note: tNote,
          recipientPerson,
          ...(recipientUserId ? { recipientUserId: Number(recipientUserId) } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notify(body.error || tx(language, "Aktarım oluşturulamadı.", "The transfer could not be created.", "Veguhastin nehat afirandin."));
        return;
      }
      setTargetId("");
      setNewKasaName("");
      setRecipientPerson("");
      setRecipientUserId("");
      setTAmount(0);
      setTDetail("");
      setTNote("");
      setSentConfirmed(false);
      await loadTransfers();
      // A brand-new target kasa gets a zero-balance placeholder record on
      // creation (see POST /api/cash-transfers) — refresh so it shows up
      // immediately instead of only after the next full reload.
      onTransfersChanged();
    } catch {
      notify(tx(language, "Aktarım oluşturulamadı.", "The transfer could not be created.", "Veguhastin nehat afirandin."));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmTransfer(id: number) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/cash-transfers/${id}/confirm`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notify(body.error || tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
        return;
      }
      await loadTransfers();
      onTransfersChanged();
    } catch {
      notify(tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
    } finally {
      setBusyId(null);
    }
  }

  const statusLabel = (s: CashTransfer["status"]) =>
    s === "pending"
      ? tx(language, "Bekliyor", "Pending", "Li benda")
      : s === "confirmed"
        ? tx(language, "Onaylandı", "Confirmed", "Hat erêkirin")
        : tx(language, "İptal", "Cancelled", "Betal");

  return (
    <div className="cashTransferSection">
      <div className="cashTransferHead">
        <h3>{tx(language, "Kasa Aktarımı", "Kasa Transfer", "Veguhastina Qaseyê")}</h3>
        <button type="button" className="light" onClick={() => setOpen((o) => !o)}>
          {open
            ? tx(language, "Kapat", "Close", "Bigire")
            : tx(language, "Kasa Aktar", "Transfer Kasa", "Qaseyê Veguhezîne")}
        </button>
      </div>

      {open && thisAccount && (
        <div className="formGrid cashTransferForm">
          <label>
            {tx(language, "Aktarılacak Kasa", "Target Kasa", "Qaseya Armanc")}
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                if (e.target.value) setNewKasaName("");
              }}
            >
              <option value="">
                {tx(language, "— Seçin —", "— Select —", "— Hilbijêre —")}
              </option>
              {otherAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx(language, "Yeni Kasa Adı", "New Kasa Name", "Navê Qaseya Nû")}
            <input
              value={newKasaName}
              disabled={Boolean(targetId)}
              onChange={(e) => setNewKasaName(e.target.value)}
              placeholder={tx(
                language,
                "Listede yoksa buraya yazın",
                "Type here if not in the list above",
                "Heke ne di lîsteyê de be li vir binivîse",
              )}
            />
          </label>
          <label>
            {tx(language, "Aktarılacak Kişi", "Recipient", "Kesê Wergir")}
            <input value={recipientPerson} onChange={(e) => setRecipientPerson(e.target.value)} />
          </label>
          <label>
            {tx(language, "Alıcı Kullanıcı", "Recipient User", "Bikarhênerê Wergir")}
            <select value={recipientUserId} onChange={(e) => setRecipientUserId(e.target.value)}>
              <option value="">{tx(language, "Belirtilmedi", "Unspecified", "Nehatiye diyarkirin")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx(language, "Tarih", "Date", "Tarîx")}
            <input type="date" value={tDate} onChange={(e) => setTDate(e.target.value)} />
          </label>
          <label>
            {tx(language, "Miktar / Para Birimi", "Amount / Currency", "Meblağ / Yekeya Pere")}
            <div className="amountCurrency">
              <input type="number" min="0" value={tAmount} onChange={(e) => setTAmount(Number(e.target.value))} />
              <select value={tCurrency} onChange={(e) => setTCurrency(e.target.value)}>
                <option>USD</option>
                <option>IQD</option>
              <option>SYP</option>
                <option>TRY</option>
                <option>EUR</option>
              </select>
            </div>
          </label>
          <label>
            {tx(language, "Detay", "Detail", "Hûragahî")}
            <input value={tDetail} onChange={(e) => setTDetail(e.target.value)} />
          </label>
          <label className="wide">
            {tx(language, "Not", "Note", "Nîşe")}
            <textarea rows={2} value={tNote} onChange={(e) => setTNote(e.target.value)} />
          </label>
          <label className="wide check">
            <input type="checkbox" checked={sentConfirmed} onChange={(e) => setSentConfirmed(e.target.checked)} />
            <span>
              <b>{tx(language, "Kasa aktarıldı", "Kasa has been sent", "Qase hat veguhastin")}</b>
              <small>
                {tx(
                  language,
                  "Tutar bu kasadan hemen düşülür ve hedef kasada gelir olarak görünür; karşı taraf onaylayana kadar o kayıt 'Onay Bekliyor' tonunda gösterilir.",
                  "The amount is deducted from this kasa immediately and appears as income in the target kasa right away; that record shows an 'Awaiting Approval' tone until the other side confirms it.",
                  "Meblağ tavilê ji vê qaseyê tê kêmkirin û di qaseya armanc de wek dahat xuya dike; heta alîyê din erê neke, ew qeyd bi rengê 'Li Benda Erêkirinê' tê nîşandan.",
                )}
              </small>
            </span>
          </label>
          <button type="button" className="wide primary" disabled={!valid || submitting} onClick={submitTransfer}>
            {tx(language, "Kasayı Aktar", "Transfer Kasa", "Qaseyê Veguhezîne")}
          </button>
        </div>
      )}

      {(outgoing.length > 0 || incoming.length > 0) && (
        <div className="cashTransferList">
          {outgoing.length > 0 && (
            <div>
              <small>{tx(language, "Gönderilen Aktarımlar", "Outgoing Transfers", "Veguhastinên Şandî")}</small>
              {outgoing.map((t) => (
                <div className="cashTransferRow" key={t.id}>
                  <span>{date(t.date, language)}</span>
                  <span>{localizeData(t.toCashAccountName, language)}</span>
                  <span>{t.recipientPerson || t.recipientUserName || "—"}</span>
                  <strong>{money(t.amount, t.currency)}</strong>
                  <em className={`transferStatus transferStatus-${t.status}`}>{statusLabel(t.status)}</em>
                </div>
              ))}
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <small>{tx(language, "Bu Kasaya Gelen Aktarımlar", "Incoming Transfers", "Veguhastinên Hatî")}</small>
              {incoming.map((t) => (
                <div className="cashTransferRow" key={t.id}>
                  <span>{date(t.date, language)}</span>
                  <span>{localizeData(t.fromCashAccountName, language)}</span>
                  <span>{t.recipientPerson || t.recipientUserName || "—"}</span>
                  <strong>{money(t.amount, t.currency)}</strong>
                  {t.status === "pending" ? (
                    <label className="check transferConfirm">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busyId === t.id}
                        onChange={() => confirmTransfer(t.id)}
                      />
                      {tx(language, "Aktarılan Kasa Alındı", "Received", "Hat Wergirtin")}
                    </label>
                  ) : (
                    <em className={`transferStatus transferStatus-${t.status}`}>{statusLabel(t.status)}</em>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
