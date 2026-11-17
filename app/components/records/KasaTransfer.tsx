"use client";

import { useEffect, useState } from "react";
import { tx, localizeData } from "../../lib/i18n";
import { date, money } from "../../lib/finance";
import type { CashAccountSummary, CashTransfer, Language, UserAccount } from "../../lib/types";
import { notify } from "../../lib/notify";

// "Kasa Aktarımı": moves money from `account` to another kasa (existing or
// brand new), pending until the recipient side confirms receipt — see
// app/api/cash-transfers. Nothing here touches app/page.tsx's `records`
// state directly; a confirm calls `onTransfersChanged` so the parent
// refetches and every kasa's balance reflects the new ledger rows.
// The sender leg is an "expense" and the receiver leg an "income" record,
// both titled "Kasa Aktarımı".
export function KasaTransferSection({
  language,
  account,
  cashAccounts,
  users,
  onTransfersChanged,
  initialOpen = false,
  embedded = false,
}: {
  language: Language;
  account: CashAccountSummary;
  cashAccounts: CashAccountSummary[];
  users: UserAccount[];
  onTransfersChanged: () => void;
  initialOpen?: boolean;
  // Pencere içinde gösterilirken başlık ve aç/kapa düğmesi gizlenir (pencerenin kendi başlığı ve Kapat'ı var).
  embedded?: boolean;
}) {
  const thisAccount = cashAccounts.find((a) => a.id === account.id) ?? account;
  const [open, setOpen] = useState(initialOpen);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yükleme/periyodik tazeleme; setState fetch sonucunda çalışır
    loadTransfers();
    loadAllAccounts();
  }, [account.id]);

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
      // Both legs (and a brand-new target kasa, if one was named) exist right
      // away — refresh so balances and cards update immediately instead of
      // only after the next poll.
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
      {!embedded && <div className="cashTransferHead">
        <h3>{tx(language, "Kasa Aktarımı", "Kasa Transfer", "Veguhastina Qaseyê")}</h3>
        <button type="button" className="light" onClick={() => setOpen((o) => !o)}>
          {open
            ? tx(language, "Kapat", "Close", "Bigire")
            : tx(language, "Kasa Aktar", "Transfer Kasa", "Qaseyê Veguhezîne")}
        </button>
      </div>}

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

// Kasa kartının ⋯ menüsünden / kasa sayfasının başlığından açılan "Kasalar
// arası aktarım" penceresi: aktarım formu ve bu kasanın gelen/giden aktarımları.
export function KasaTransferModal({
  language,
  account,
  cashAccounts,
  users,
  onTransfersChanged,
  onClose,
}: {
  language: Language;
  account: CashAccountSummary;
  cashAccounts: CashAccountSummary[];
  users: UserAccount[];
  onTransfersChanged: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay">
      <div className="modal kasaTransferModal" role="dialog" aria-label={tx(language, "Kasalar arası aktarım", "Transfer between cash accounts", "Veguhastina navbera qaseyan")} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{tx(language, "Kasalar arası aktarım", "Transfer between cash accounts", "Veguhastina navbera qaseyan")}</h2>
            <p>{localizeData(account.name, language)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <KasaTransferSection language={language} account={account} cashAccounts={cashAccounts} users={users} onTransfersChanged={onTransfersChanged} initialOpen embedded />
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Kapat", "Close", "Bigire")}</button>
        </div>
      </div>
    </div>
  );
}
