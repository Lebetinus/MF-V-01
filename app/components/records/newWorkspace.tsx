"use client";

import { parentWorkspaceOptions } from "../KasaManage";
import { tx } from "../../lib/i18n";
import type { KasaSection, Language } from "../../lib/types";

// "Çalışma Alanı Ekle" / "Bölüm Ekle" penceresi; açık/kapalı durumu ve alan değerleri Records'ta tutulur.
export type NewWorkspaceContext = {
  language: Language;
  sections: KasaSection[];
  cashSections: KasaSection[];
  onRefreshData?: () => void;
  newWorkspaceName: string;
  setNewWorkspaceName: (v: string) => void;
  newWorkspaceParent: string;
  setNewWorkspaceParent: (v: string) => void;
  newWorkspaceBusy: boolean;
  setNewWorkspaceBusy: (v: boolean) => void;
  newWorkspaceError: string;
  setNewWorkspaceError: (v: string) => void;
  setNewWorkspaceOpen: (v: boolean) => void;
};

export function renderNewWorkspaceModal(c: NewWorkspaceContext) {
  const {
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
  } = c;
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
  return (
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
              {parentWorkspaceOptions(sections).map((o) => (
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
  );
}
