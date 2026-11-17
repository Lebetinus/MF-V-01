"use client";

import { useEffect, useMemo, useState } from "react";
import { debtPairs } from "../lib/debts";
import { localizeData, tx } from "../lib/i18n";
import { money } from "../lib/finance";
import type { CashAccountSummary, Language, RecordItem } from "../lib/types";
import { notify } from "../lib/notify";

export type DebtModalMode = "lend" | "repay";

const CURRENCIES = ["USD", "IQD", "SYP", "TRY", "EUR"];
const today = () => new Date().toISOString().slice(0, 10);

// "Borç ver" / "Borç öde" penceresi (Borç Detay sayfası ve kasa sayfası). Her işlem sunucuda iki kaydı birlikte
// yazar (bkz. app/api/_lib/debts.ts): borç verirken veren kasada gider + alan kasada gelir; öderken borçlu kasada
// gider + alacaklı kasada gelir. Parası çıkan kasa yalnız kullanıcının yazabildiği kasalardan seçilir (sahibi ya
// da süper admin); karşı kasa erişebildiği kasalardan.
export function DebtModal({
  language,
  cashAccounts,
  records,
  isSuperAdmin = false,
  initialMode = "lend",
  kasaId,
  creditorId,
  onDone,
  onClose,
}: {
  language: Language;
  cashAccounts: CashAccountSummary[];
  records: RecordItem[];
  isSuperAdmin?: boolean;
  initialMode?: DebtModalMode;
  // Ön seçim: borç verirken borç veren kasa, öderken borçlu kasa.
  kasaId?: number;
  // Ödemede ön seçili alacaklı kasa (Borç Detay'daki "Ödeme yap" düğmesi).
  creditorId?: number;
  onDone: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [mode, setMode] = useState<DebtModalMode>(initialMode);
  const writable = useMemo(() => cashAccounts.filter((a) => a.isOwner || isSuperAdmin), [cashAccounts, isSuperAdmin]);
  const writableIds = useMemo(() => new Set(writable.map((a) => a.id)), [writable]);
  const nameOf = (id: number | null) => cashAccounts.find((a) => a.id === id)?.name ?? "";

  // Borç ver
  const [lenderId, setLenderId] = useState<number | null>(() => (initialMode === "lend" && kasaId && writableIds.has(kasaId) ? kasaId : null));
  const [borrowerId, setBorrowerId] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");

  // Borç öde: yalnız kalan borcu olan (borçlu, alacaklı, para birimi) çiftleri; borçlu kasa yazılabilir olmalı.
  const openPairs = useMemo(() => debtPairs(records).filter((p) => p.outstanding > 0.004 && writableIds.has(p.debtorId)), [records, writableIds]);
  const debtorOptions = [...new Map(openPairs.map((p) => [p.debtorId, p.debtorName || nameOf(p.debtorId)])).entries()];
  const [debtorId, setDebtorId] = useState<number | null>(() => {
    if (initialMode === "repay" && kasaId && openPairs.some((p) => p.debtorId === kasaId)) return kasaId;
    return openPairs[0]?.debtorId ?? null;
  });
  const pairsOfDebtor = openPairs.filter((p) => p.debtorId === debtorId);
  const [pairKey, setPairKey] = useState<string>(() => {
    const own = openPairs.filter((p) => p.debtorId === (initialMode === "repay" && kasaId ? kasaId : openPairs[0]?.debtorId));
    return (own.find((p) => p.creditorId === creditorId) ?? own[0])?.key ?? "";
  });
  const pair = pairsOfDebtor.find((p) => p.key === pairKey) ?? pairsOfDebtor[0];

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountNum = Number(amount.replace(",", "."));
  const remaining = pair?.outstanding ?? 0;
  const amountOk = Number.isFinite(amountNum) && amountNum > 0;
  const valid = mode === "lend"
    ? lenderId != null && borrowerId != null && lenderId !== borrowerId && amountOk
    : Boolean(pair) && amountOk && amountNum <= remaining + 0.001;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const body = mode === "lend"
        ? { lenderCashAccountId: lenderId, borrowerCashAccountId: borrowerId, amount: amountNum, currency, date, note }
        : { debtorCashAccountId: pair!.debtorId, creditorCashAccountId: pair!.creditorId, amount: amountNum, currency: pair!.currency, date, note };
      const response = await fetch(mode === "lend" ? "/api/debts" : "/api/debts/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        notify(info.error && info.error !== "Validation failed" ? info.error : info.issues?.[0]?.message || tx(language, "Borç işlemi kaydedilemedi.", "The debt operation could not be saved.", "Karûbarê deynê nehat tomarkirin."));
        return;
      }
      notify(mode === "lend" ? tx(language, "Borç verildi.", "Debt lent.", "Deyn hat dayîn.") : tx(language, "Borç ödemesi kaydedildi.", "Repayment saved.", "Dravdana deynê hat tomarkirin."), "success");
      onDone();
      onClose();
    } catch {
      notify(tx(language, "Borç işlemi kaydedilemedi.", "The debt operation could not be saved.", "Karûbarê deynê nehat tomarkirin."));
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "lend" ? tx(language, "Borç ver", "Lend", "Deyn bide") : tx(language, "Borç öde", "Repay debt", "Deyn bide vegerîne");

  return (
    <div className="overlay">
      <div className="modal debtModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{title}</h2>
            <p>
              {mode === "lend"
                ? tx(language, "Borç veren kasada gider, borç alan kasada gelir olarak iki kayıt birlikte yazılır. Borç veren kasanın gelir/gider istatistiği değişmez; yalnız bakiyesi düşer.", "Two records are written together: an expense in the lending kasa and income in the borrowing kasa. The lender's income/expense statistics stay unchanged; only its balance drops.", "Du qeyd bi hev re têne nivîsandin: mesref di qaseya deyndêr de, dahat di qaseya deyndar de. Statîstîka deyndêr naguhere; tenê balans kêm dibe.")
                : tx(language, "Borçlu kasada gider, alacaklı kasada tahsilat olarak iki kayıt birlikte yazılır. Ödeme kalan borcu aşamaz.", "Two records are written together: an expense in the debtor kasa and a collection in the creditor kasa. The payment cannot exceed the remaining debt.", "Du qeyd bi hev re têne nivîsandin: mesref di qaseya deyndar de, berhevkirin di qaseya deyndêr de. Dravdan nikare ji deynê mayî zêdetir be.")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <div className="debtModeTabs" role="tablist" aria-label={tx(language, "Borç işlemi", "Debt operation", "Karûbarê deynê")}>
          {([["lend", tx(language, "Borç ver", "Lend", "Deyn bide")], ["repay", tx(language, "Borç öde", "Repay", "Deyn vegerîne")]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setAmount(""); if (id === "lend" && lenderId == null && kasaId && writableIds.has(kasaId)) setLenderId(kasaId); }}>{label}</button>
          ))}
        </div>
        <div className="formGrid">
          {mode === "lend" ? (
            <>
              <label>
                {tx(language, "Borç veren kasa", "Lending kasa", "Qaseya deyndêr")}
                <select value={lenderId ?? ""} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; setLenderId(id); if (id === borrowerId) setBorrowerId(null); }}>
                  <option value="">{tx(language, "— Seçin —", "— Select —", "— Hilbijêre —")}</option>
                  {writable.map((a) => <option key={a.id} value={a.id}>{localizeData(a.name, language)}</option>)}
                </select>
              </label>
              <label>
                {tx(language, "Borç alan kasa", "Borrowing kasa", "Qaseya deyndar")}
                <select value={borrowerId ?? ""} onChange={(e) => setBorrowerId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{tx(language, "— Seçin —", "— Select —", "— Hilbijêre —")}</option>
                  {cashAccounts.filter((a) => a.id !== lenderId).map((a) => <option key={a.id} value={a.id}>{localizeData(a.name, language)}</option>)}
                </select>
              </label>
              <label>
                {tx(language, "Tutar / Para birimi", "Amount / Currency", "Meblağ / Yekeya pere")}
                <div className="amountCurrency">
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </label>
            </>
          ) : openPairs.length === 0 ? (
            <p className="debtEmpty wide">{tx(language, "Ödenecek açık borç yok.", "There is no open debt to repay.", "Deynê vekirî yê ku were dayîn tune.")}</p>
          ) : (
            <>
              <label>
                {tx(language, "Borçlu kasa (ödeyen)", "Debtor kasa (paying)", "Qaseya deyndar (dide)")}
                <select value={debtorId ?? ""} onChange={(e) => { const id = Number(e.target.value); setDebtorId(id); setPairKey(openPairs.find((p) => p.debtorId === id)?.key ?? ""); setAmount(""); }}>
                  {debtorOptions.map(([id, name]) => <option key={id} value={id}>{localizeData(name, language)}</option>)}
                </select>
              </label>
              <label>
                {tx(language, "Alacaklı kasa", "Creditor kasa", "Qaseya deyndêr")}
                <select value={pair?.key ?? ""} onChange={(e) => { setPairKey(e.target.value); setAmount(""); }}>
                  {pairsOfDebtor.map((p) => (
                    <option key={p.key} value={p.key}>
                      {localizeData(p.creditorName || nameOf(p.creditorId) || "—", language)} — {tx(language, "kalan", "remaining", "mayî")} {money(p.outstanding, p.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tx(language, "Ödeme tutarı", "Payment amount", "Mîqdara dravdanê")} ({pair?.currency})
                <div className="amountCurrency">
                  <input type="number" min="0" max={remaining} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                  <button type="button" className="light compact" onClick={() => setAmount(String(remaining))}>{tx(language, "Tamamı", "All", "Hemû")}</button>
                </div>
                <small className="debtHint">
                  {tx(language, "Kalan borç", "Remaining debt", "Deynê mayî")}: {money(remaining, pair?.currency ?? "USD")}
                  {amountOk && amountNum > remaining + 0.001 ? ` · ${tx(language, "Ödeme kalan borçtan büyük olamaz", "The payment cannot exceed the remaining debt", "Dravdan nikare ji deynê mayî mezintir be")}` : ""}
                </small>
              </label>
            </>
          )}
          <label>
            {tx(language, "Tarih", "Date", "Tarîx")}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="wide">
            {tx(language, "Not", "Note", "Nîşe")}
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="button" className="primary" disabled={!valid || submitting} onClick={submit}>{title}</button>
        </div>
      </div>
    </div>
  );
}
