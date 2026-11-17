"use client";

import { useState } from "react";
import type { CashAccountSummary, KasaSection, Language } from "../lib/types";
import { tx } from "../lib/i18n";

// Çalışma alanı seçenekleri: yöneticinin oluşturduğu kasa çalışma alanları (kasa_sections, scope=cash), her birinin
// hemen altında bölümleri ("Alan › Bölüm"). Hazır/sabit bir alan yoktur.
export function workspaceOptions(sections: KasaSection[]): { key: string; label: string; isSub?: boolean }[] {
  const cash = sections.filter((x) => x.scope === "cash");
  const known = new Set(cash.map((x) => `sec-${x.id}`));
  const isChild = (x: KasaSection) => Boolean(x.parentKey) && known.has(x.parentKey as string);
  const tops = cash.filter((x) => !isChild(x)).map((x) => ({ key: `sec-${x.id}`, label: x.name }));
  return tops.flatMap((t) => [
    t as { key: string; label: string; isSub?: boolean },
    ...cash.filter((x) => isChild(x) && x.parentKey === t.key).map((x) => ({ key: `sec-${x.id}`, label: `${t.label} › ${x.name}`, isSub: true })),
  ]);
}

// Bölüm oluştururken seçilebilecek üst çalışma alanları (bölümün içine bölüm eklenemez).
export function parentWorkspaceOptions(sections: KasaSection[]): { key: string; label: string }[] {
  return workspaceOptions(sections).filter((o) => !o.isSub);
}

// Kasanın bulunduğu alan/bölüm anahtarı ("sec-<id>"); alanı yoksa ya da alanı silinmişse NO_WORKSPACE.
export const NO_WORKSPACE = "none";
// Alanı olmayan (ya da alanı silinmiş) kasaların, yalnız böyle bir kasa varken görünen kutusu.
export const noWorkspaceLabel = (language: Language) => tx(language, "Çalışma alanı yok", "No workspace", "Bê qada xebatê");
export function workspaceKeyOf(sectionId: number | null | undefined, sections: KasaSection[]): string {
  return sectionId != null && sections.some((x) => x.scope === "cash" && x.id === sectionId) ? `sec-${sectionId}` : NO_WORKSPACE;
}

// Seçilen anahtarın çalışma alanı / bölüm kimliği.
export function sectionIdOfKey(key: string): number | null {
  return key.startsWith("sec-") ? Number(key.slice(4)) : null;
}

// Seçili kasa için "Kasayı Düzenle" ve "Çalışma Alanına Taşı" (moveOnly) penceresi.
export function KasaEditModal({
  language,
  account,
  sections,
  moveOnly = false,
  onClose,
  onDone,
}: {
  language: Language;
  account: CashAccountSummary;
  sections: KasaSection[];
  moveOnly?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [wsKey, setWsKey] = useState(workspaceKeyOf(account.sectionId, sections));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = workspaceOptions(sections);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const sectionId = sectionIdOfKey(wsKey);
    try {
      const response = await fetch(`/api/cash-accounts/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), ...(sectionId != null ? { sectionId } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || tx(language, "Kasa kaydedilemedi.", "The cash account could not be saved.", "Qase nehat tomarkirin."));
        return;
      }
      onDone();
      onClose();
    } catch {
      setError(tx(language, "Kasa kaydedilemedi.", "The cash account could not be saved.", "Qase nehat tomarkirin."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <div className="modal kasaManageModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{moveOnly ? tx(language, "Kasayı Çalışma Alanına Taşı", "Move Cash Account to Workspace", "Qaseyê Bibe Qada Xebatê") : tx(language, "Kasayı Düzenle", "Edit Cash Account", "Qaseyê Biguherîne")}</h2>
            {moveOnly && <p>{account.name}</p>}
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="kasaManageBody">
          {!moveOnly && (
            <label>
              {tx(language, "Kasa adı", "Cash account name", "Navê qaseyê")}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
            </label>
          )}
          <label>
            {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")}
            <select value={wsKey} onChange={(e) => setWsKey(e.target.value)}>
              {wsKey === NO_WORKSPACE && <option value={NO_WORKSPACE} disabled>{tx(language, "Çalışma alanı seçin", "Select a workspace", "Qada xebatê hilbijêre")}</option>}
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
          <small className="kasaManageHint">
            {tx(language, "Kasalar çalışma alanlarında ve onların bölümlerinde gruplanır; taşımak kasanın kayıtlarını değiştirmez.", "Cash accounts are grouped in workspaces and their sections; moving one does not change its records.", "Qase di qadên xebatê û beşên wan de tên komkirin; barkirin tomarên qaseyê naguherîne.")}
          </small>
          {error && <p className="kasaManageError">{error}</p>}
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={save}>
            {moveOnly ? tx(language, "Taşı", "Move", "Bibe") : tx(language, "Kaydet", "Save", "Tomar bike")}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Yeni Kasa": kasa kendi başına açılır (POST /api/cash-accounts) — ad,
// çalışma alanı (seçili alanın içinde hızlıca yeni bölüm de açılabilir) ve
// isteğe bağlı açılış bakiyesi. Açılış bakiyesi kasaya "Açılış bakiyesi"
// başlıklı bir Gelir kaydı olarak yazılır.
export function NewKasaModal({
  language,
  sections,
  initialWorkspaceKey,
  onSectionsChanged,
  onClose,
  onDone,
}: {
  language: Language;
  sections: KasaSection[];
  initialWorkspaceKey?: string;
  onSectionsChanged?: () => void;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const options = workspaceOptions(sections);
  const [name, setName] = useState("");
  const [wsKey, setWsKey] = useState(() => (initialWorkspaceKey && options.some((o) => o.key === initialWorkspaceKey) ? initialWorkspaceKey : options[0]?.key ?? NO_WORKSPACE));
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionError, setSectionError] = useState("");

  // Seçili çalışma alanının içinde yeni bölüm (bölümün içine bölüm olmaz: seçili bir bölümse onun üst alanı kullanılır).
  // Henüz hiç çalışma alanı yoksa aynı düğme ilk çalışma alanını açar.
  const noWorkspace = options.length === 0;
  async function createSection() {
    const trimmed = sectionName.trim();
    if (!trimmed) return;
    const selected = sections.find((x) => `sec-${x.id}` === wsKey);
    const parentKey = noWorkspace ? null : selected?.parentKey ?? wsKey;
    try {
      const response = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "cash", name: trimmed, color: "#7b52bf", parentKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSectionError(
          response.status === 403
            ? tx(language, "Bölümü yalnızca yönetici oluşturabilir.", "Only an administrator can create a section.", "Beşê tenê rêvebir dikare çêke.")
            : response.status === 409
              ? tx(language, "Bu adla bir bölüm zaten var.", "A section with this name already exists.", "Beşa bi vî navî heye.")
              : body.error || tx(language, "Bölüm oluşturulamadı.", "The section could not be created.", "Beş nehat çêkirin."),
        );
        return;
      }
      setWsKey(`sec-${body.section.id}`);
      setSectionOpen(false);
      setSectionName("");
      setSectionError("");
      onSectionsChanged?.();
    } catch {
      setSectionError(tx(language, "Bölüm oluşturulamadı.", "The section could not be created.", "Beş nehat çêkirin."));
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    const sectionId = sectionIdOfKey(wsKey);
    if (sectionId == null) {
      setError(tx(language, "Bir çalışma alanı seçin.", "Select a workspace.", "Qada xebatê hilbijêre."));
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/cash-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          sectionId,
          openingAmount: amount > 0 ? amount : 0,
          currency,
          date: openingDate,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          response.status === 409
            ? tx(language, "Bu isimde bir kasa zaten var.", "A cash account with this name already exists.", "Qaseyek bi vî navî heye.")
            : response.status === 403 && (!body.error || body.error === "Forbidden")
              ? tx(language, "Kasa açma yetkiniz yok.", "You are not allowed to create a cash account.", "Destûra te ya vekirina qaseyê tune.")
              : body.error || tx(language, "Kasa oluşturulamadı.", "The cash account could not be created.", "Qase nehat çêkirin."),
        );
        return;
      }
      onDone(trimmed);
      onClose();
    } catch {
      setError(tx(language, "Kasa oluşturulamadı.", "The cash account could not be created.", "Qase nehat çêkirin."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <form
        className="modal kasaManageModal newKasaModal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="modalHead">
          <div>
            <h2>{tx(language, "Yeni Kasa", "New Cash Account", "Qaseya Nû")}</h2>
            <p>{tx(language, "Kasa açılır; gelir ve giderler sonra bu kasaya eklenir.", "Opens the cash account; income and expenses are added to it afterwards.", "Qase tê vekirin; dahat û mesref paşê lê tên zêdekirin.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <div className="kasaManageBody">
          <label>
            {tx(language, "Kasa adı", "Cash account name", "Navê qaseyê")}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
          </label>
          <label>
            {tx(language, "Çalışma alanı", "Workspace", "Qada xebatê")}
            <select value={wsKey} onChange={(e) => setWsKey(e.target.value)} disabled={noWorkspace}>
              {noWorkspace && <option value={NO_WORKSPACE}>{tx(language, "Henüz çalışma alanı yok", "No workspace yet", "Hê qada xebatê tune")}</option>}
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
          <small className="kasaManageHint">
            {noWorkspace
              ? tx(language, "Kasa açmadan önce bir çalışma alanı oluşturun.", "Create a workspace before opening a cash account.", "Berî vekirina qaseyê qadeke xebatê çêke.")
              : tx(language, "Her kasa bir çalışma alanında (ya da onun bir bölümünde) açılır.", "Every cash account opens in a workspace (or one of its sections).", "Her qase di qadeke xebatê (an beşekî wê) de vedibe.")}
          </small>
          <div className="inlineSectionRow">
            {!sectionOpen ? (
              <button type="button" className="light compact" onClick={() => setSectionOpen(true)}>
                ＋ {noWorkspace
                  ? tx(language, "Çalışma alanı oluştur", "Create workspace", "Qada xebatê çêke")
                  : tx(language, "Bölüm oluştur (seçili çalışma alanında)", "Create section (in selected workspace)", "Beş çêke (di qada hilbijartî de)")}
              </button>
            ) : (
              <>
                <input
                  value={sectionName}
                  autoFocus
                  maxLength={80}
                  placeholder={noWorkspace ? tx(language, "Çalışma alanı adı", "Workspace name", "Navê qada xebatê") : tx(language, "Bölüm adı", "Section name", "Navê beşê")}
                  onChange={(e) => setSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createSection();
                    }
                  }}
                />
                <button type="button" className="primary compact" disabled={!sectionName.trim()} onClick={createSection}>{tx(language, "Oluştur", "Create", "Çêke")}</button>
                <button type="button" className="light compact" onClick={() => { setSectionOpen(false); setSectionError(""); }}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
              </>
            )}
            {sectionError && <small className="kasaManageError">{sectionError}</small>}
          </div>
          <label>
            {tx(language, "Açılış bakiyesi (isteğe bağlı)", "Opening balance (optional)", "Bakiya destpêkê (bijarte)")}
            <span className="newKasaAmount">
              <input type="number" min="0" step="any" inputMode="decimal" placeholder="0,00" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={tx(language, "Para birimi", "Currency", "Yekeya Pere")}>
                {["USD", "EUR", "IQD", "SYP", "TRY"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </span>
          </label>
          {amount > 0 && (
            <label>
              {tx(language, "Açılış tarihi", "Opening date", "Tarîxa destpêkê")}
              <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
            </label>
          )}
          <small className="kasaManageHint">{tx(language, "Açılış bakiyesi kasaya “Açılış bakiyesi” başlıklı bir gelir kaydı olarak eklenir.", "The opening balance is added to the account as an income record titled “Açılış bakiyesi”.", "Bakiya destpêkê wek tomareke dahatê bi sernavê “Açılış bakiyesi” tê zêdekirin.")}</small>
          {error && <p className="kasaManageError">{error}</p>}
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="submit" className="primary" disabled={busy || !name.trim() || noWorkspace}>{tx(language, "Kasayı oluştur", "Create cash account", "Qaseyê çêke")}</button>
        </div>
      </form>
    </div>
  );
}

export function KasaDeleteModal({
  language,
  account,
  recordCount,
  onClose,
  onDone,
}: {
  language: Language;
  account: CashAccountSummary;
  recordCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (!password || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/cash-accounts/${account.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || tx(language, "Kasa silinemedi.", "The cash account could not be deleted.", "Qase nehat jêbirin."));
        return;
      }
      onDone();
      onClose();
    } catch {
      setError(tx(language, "Kasa silinemedi.", "The cash account could not be deleted.", "Qase nehat jêbirin."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <div className="modal kasaManageModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{tx(language, "Kasayı Sil", "Delete Cash Account", "Qaseyê Jê Bibe")}</h2>
            <p>{account.name}</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="kasaManageBody">
          <p className="kasaManageWarn">
            {tx(
              language,
              `Bu kasa ve ona bağlı ${recordCount} kayıt (gelir, gider) silinecek. Silinen kayıtlar Arşiv'e düşer; kasa ve çalışma alanı ayarları geri alınamaz.`,
              `This cash account and its ${recordCount} linked records (income, expense) will be deleted. Deleted records go to the Archive; the account and its workspace settings cannot be restored.`,
              `Ev qase û ${recordCount} tomarên girêdayî (dahat, mesref) wê werin jêbirin. Tomarên jêbirî diçin Arşîvê; qase û mîhengên qada xebatê venagerin.`,
            )}
          </p>
          <label>
            {tx(language, "Silme gerekçesi (zorunlu)", "Reason for deleting (required)", "Sedema jêbirinê (pêwîst)")}
            <textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            {tx(language, "Onay için şifrenizi girin", "Enter your password to confirm", "Ji bo erêkirinê şîfreya xwe binivîse")}
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmDelete();
              }}
            />
          </label>
          {error && <p className="kasaManageError">{error}</p>}
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="button" className="danger" disabled={busy || !password || reason.trim().length < 3} onClick={confirmDelete}>
            {tx(language, "Kasayı Kalıcı Sil", "Delete Permanently", "Bi Temamî Jê Bibe")}
          </button>
        </div>
      </div>
    </div>
  );
}
