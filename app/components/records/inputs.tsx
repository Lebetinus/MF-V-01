"use client";

import { useState } from "react";
import { tx } from "../../lib/i18n";
import type { CashAccountSummary, Language, UserAccount } from "../../lib/types";

export function ShareKasaModal({
  language,
  account,
  users,
  onToggle,
  busyKey,
  onToggleDashboardShare,
  dashboardShareBusy,
  onClose,
}: {
  language: Language;
  account: CashAccountSummary;
  users: UserAccount[];
  onToggle: (userId: number, grant: boolean) => void;
  busyKey: string | null;
  onToggleDashboardShare: (enabled: boolean) => void;
  dashboardShareBusy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}</h2>
            <small>{account.name}</small>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="userPermissionOptions">
          {users.map((u) => {
            const key = `${account.id}-${u.id}`;
            const shared = account.sharedWithUserIds.includes(u.id);
            const isOwner = account.ownerUserId === u.id;
            return (
              <label key={u.id} className="userPermissionOption">
                <input
                  type="checkbox"
                  checked={shared || isOwner}
                  disabled={isOwner || busyKey === key}
                  onChange={(e) => onToggle(u.id, e.target.checked)}
                />
                {u.name} {isOwner ? `(${tx(language, "sahibi", "owner", "xwedî")})` : ""}
              </label>
            );
          })}
        </div>
        <label className="wide check dashboardShareOption">
          <input
            type="checkbox"
            checked={account.dashboardShareEnabled}
            disabled={dashboardShareBusy}
            onChange={(e) => onToggleDashboardShare(e.target.checked)}
          />
          <span>
            <b>{tx(language, "Süper Admin'in Ana Sayfa'sında göster", "Show in Super Admin's Ana Sayfa", "Di Ana Sayfaya Super Admin de nîşan bide")}</b>
            <small>
              {tx(
                language,
                "İşaretlerseniz, süper admin isterse (Ayarlar > Görüntüle) bu kasanın sonuçlarını kendi Ana Sayfa toplamlarına dahil edebilir.",
                "If checked, a super admin can choose (Ayarlar > Görüntüle) to fold this kasa's results into their own Ana Sayfa totals.",
                "Heke hatibe nîşankirin, super admin dikare (Ayarlar > Nîşandan) encamên vê qaseyê têxe nav giştiyên Ana Sayfaya xwe.",
              )}
            </small>
          </span>
        </label>
        <div className="modalActions">
          <button type="button" onClick={onClose}>
            {tx(language, "Kapat", "Close", "Bigire")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const filtered = options
    .filter((o) => o.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="suggestField">
      <input
        required={required}
        disabled={disabled}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && filtered.length > 0 && (
        <div className="suggestList">
          {filtered.map((o) => (
            <button
              type="button"
              key={o}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                setOpen(false);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Virgülle ayrılmış çoklu etiket girişi — SuggestInput'tan farklı olarak
// önerileri tüm metne değil, en son (henüz yazılmakta olan) etikete göre
// filtreler, böylece "sa" yazınca daha önce girilmiş "sabit" gibi bir
// etiket baş harfleri eşleşir eşleşmez seçenek olarak çıkar. Yerel metin
// tamponu (text state) tutuyor ki kullanıcı virgül yazıp yeni bir etikete
// geçerken input değeri elindeki yazının altından kaymasın.
export function TagsInput({
  tags,
  onChange,
  options,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  options: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState(tags.join(", "));
  const [open, setOpen] = useState(false);
  const segments = text.split(",");
  const draft = (segments[segments.length - 1] ?? "").trim();
  const confirmed = segments.slice(0, -1).map((s) => s.trim()).filter(Boolean);
  const confirmedLower = new Set(confirmed.map((t) => t.toLowerCase()));
  const filtered = options
    .filter((o) => !confirmedLower.has(o.toLowerCase()))
    .filter((o) => (draft ? o.toLowerCase().startsWith(draft.toLowerCase()) : true))
    .filter((o) => o.toLowerCase() !== draft.toLowerCase())
    .slice(0, 8);

  function commitText(next: string) {
    setText(next);
    onChange(
      next
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
  }
  function pick(tag: string) {
    commitText([...confirmed, tag].join(", ") + ", ");
  }

  return (
    <div className="suggestField">
      <input
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          commitText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && filtered.length > 0 && (
        <div className="suggestList">
          {filtered.map((o) => (
            <button
              type="button"
              key={o}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
