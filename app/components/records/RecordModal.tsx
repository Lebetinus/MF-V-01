"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "../shared";
import { noWorkspaceLabel, workspaceKeyOf, workspaceOptions } from "../KasaManage";
import { tx, localizeData, noteRelationLabel } from "../../lib/i18n";
import { openAttachment } from "../../lib/attachments";
import { money, normalizeRecord } from "../../lib/finance";
import type { CashAccountSummary, FinanceNote, KasaSection, Kind, Language, NoteRelation, NoteStatus, RecordItem } from "../../lib/types";
import { notify } from "../../lib/notify";
import { DETAIL_MAX_CELL, DETAIL_MAX_COLS, DETAIL_MAX_ROWS, DetailTableEditor, parseClipboardTable } from "./detailTable";
import { SuggestInput, TagsInput } from "./inputs";
import { ExcelAttachmentModal } from "./documents";

export function RecordModal({
  language,
  kind: kindProp,
  initial,
  prefillCashAccount,
  records,
  onCreateNote,
  onClose,
  onSave,
  cashAccounts,
  sections = [],
}: {
  language: Language;
  kind: Kind;
  initial?: RecordItem;
  prefillCashAccount?: string;
  sections?: KasaSection[];
  records: RecordItem[];
  onCreateNote: (input: Omit<FinanceNote, "id" | "createdAt" | "updatedAt" | "isArchived" | "archivedAt">) => void;
  onClose: () => void;
  onSave: (x: Omit<RecordItem, "id">, id?: number) => void;
  cashAccounts: CashAccountSummary[];
}) {
  // Yeni Gelir/Gider kaydında tür, pencerenin içinden değiştirilebilir (borç: Borç ver / Borç öde penceresi).
  const [kind, setKindState] = useState<Kind>(kindProp);
  const defaultNoteRelation: NoteRelation = kind;
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
        .filter((x) => x.kind === financeNoteRelation)
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
        cashAccount: prefillCashAccount ?? "",
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
  const tone: "in" | "out" = kind === "income" ? "in" : "out";
  function switchType(next: "in" | "out") {
    const nextKind: Kind = next === "in" ? "income" : "expense";
    setKindState(nextKind);
    setFinanceNoteRelation(nextKind);
    setForm((f) => ({ ...f, kind: nextKind }));
  }
  // "Gider Detaylarını Görüntüle" bölümü kayıt penceresi her açıldığında
  // kapalı başlar (detay kayıtlıysa bile); açılınca tablonun tamamı görünür.
  const [detailTrimmed, setDetailTrimmed] = useState(false);
  const [detailPasteHint, setDetailPasteHint] = useState("");
  const [excelView, setExcelView] = useState<{ name: string; data: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const previous = (field: "source" | "person" | "project") => [
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
    onSave(form, initial?.id);
  }
  const rfHero = (
    <div className="wide rfHero">
      <div className="rfAmt">
        <span>{tx(language, "Tutar", "Amount", "Meblağ")}</span>
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
  const rfWsOptions = workspaceOptions(sections);
  const rfWsOf = (name: string) => {
    const a = cashAccounts.find((x) => x.name === name);
    const key = workspaceKeyOf(a?.sectionId, sections);
    return rfWsOptions.find((o) => o.key === key)?.label || noWorkspaceLabel(language);
  };
  const kasaGroups = (() => {
    const names = [...new Set([...cashAccounts.map((a) => a.name), form.cashAccount || ""].filter(Boolean))];
    const map = new Map<string, string[]>();
    for (const n of names) { const g = rfWsOf(n); map.set(g, [...(map.get(g) ?? []), n]); }
    const order = rfWsOptions.map((o) => o.label);
    return [...map.entries()]
      .sort((x, y) => (order.indexOf(x[0]) + 1 || 999) - (order.indexOf(y[0]) + 1 || 999))
      .map(([label, list]) => ({ label, names: list.sort((p, q) => p.localeCompare(q)) }));
  })();
  const toneLabel = tone === "in" ? tx(language, "Gelir", "Income", "Dahat") : tx(language, "Gider", "Expense", "Mesref");
  const rfSource = (          <label>
            <span>{kind === "income"
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
  const rfKasa = (
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
          <span className={`rfIcon ${tone}`} aria-hidden="true">{tone === "in" ? "↗" : "↘"}</span>
          <div className="rfTitle">
            <h2>
              {initial
                ? tx(language, "Kaydı Düzenle", "Edit Record", "Qeydê Biguherîne")
                : `${toneLabel} ${tx(language, "ekle", "add", "zêde bike")}`}
            </h2>
            <p>
              {initial
                ? tx(language, "Eski hali otomatik olarak Arşiv bölümünde saklanacaktır.", "The previous version will be stored automatically in Archive.", "Rewşa berê dê bixweber di Arşîvê de were parastin.")
                : tx(language, "Daha önce kullanılan bilgiler alanlarda öneri olarak görünür.", "Previously used information appears as suggestions.", "Agahiyên berê hatine bikaranîn wek pêşniyar xuya dibin.")}
            </p>
          </div>
          {!initial && (
            <div className="rfType" role="tablist" aria-label={tx(language, "Kayıt türü", "Record type", "Cureyê qeydê")}>
              {([["in", tx(language, "Gelir", "Income", "Dahat")], ["out", tx(language, "Gider", "Expense", "Mesref")]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tone === id} className={`${id}${tone === id ? " on" : ""}`} onClick={() => switchType(id)}>{label}</button>
              ))}
            </div>
          )}
          <button type="button" className="rfClose" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>
            ×
          </button>
        </div>
        <div className="formGrid">
          {rfHero}
          {sec(tx(language, "NEREYE", "WHERE", "KU"))}
          {rfKasa}
          {rfDate}
          {sec(tx(language, "NE İÇİN", "WHAT FOR", "BI ÇI"))}
          {rfSource}
          {rfPerson}
          {rfUnit}
          {rfDetail}
          {rfTags}
          {rfLink}
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
