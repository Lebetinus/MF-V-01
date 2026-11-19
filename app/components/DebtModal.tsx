"use client";

import { useEffect, useMemo, useState } from "react";
import { debtPairs, knownParties, type DebtPair } from "../lib/debts";
import { localizeData, tx } from "../lib/i18n";
import { money } from "../lib/finance";
import type { CashAccountSummary, Language, RecordItem } from "../lib/types";
import { notify } from "../lib/notify";

export type DebtModalMode = "lend" | "repay";

const CURRENCIES = ["USD", "IQD", "SYP", "TRY", "EUR"];
const today = () => new Date().toISOString().slice(0, 10);

// "Borç ver" / "Geri ödeme" penceresi (Borç Detay sayfası ve kasa sayfası). Borç alan iki türlü olabilir:
//  - Sistemdeki bir kasa: sunucu iki kaydı birlikte yazar (veren kasada gider + alan kasada gelir; bkz.
//    app/api/_lib/debts.ts). Geri ödemeyi borçlu kasa yapar.
//  - Sistem dışı bir kasa / proje (ör. C.GROUP): yalnız borç veren kasaya tek kayıt yazılır; parayı alan kişinin adı
//    kayıt bilgisidir. Geri ödeme alacaklı kasaya "tahsilat" olarak girer: bakiye artar, ek gelir sayılmaz.
// Parası çıkan / giren kasa yalnız kullanıcının yazabildiği kasalardan seçilir (sahibi ya da süper admin).
export function DebtModal({
  language,
  cashAccounts,
  records,
  isSuperAdmin = false,
  initialMode = "lend",
  kasaId,
  creditorId,
  pairKey: initialPairKey,
  preferCollect = false,
  onDone,
  onClose,
}: {
  language: Language;
  cashAccounts: CashAccountSummary[];
  records: RecordItem[];
  isSuperAdmin?: boolean;
  initialMode?: DebtModalMode;
  // Ön seçim: borç verirken borç veren kasa; geri ödemede borçlu kasa (ya da preferCollect ile tahsilatı alan kasa).
  kasaId?: number;
  // Geri ödemede ön seçili alacaklı kasa.
  creditorId?: number;
  // Geri ödemede ön seçili borç (Borç Detay'daki satır düğmesi).
  pairKey?: string;
  // Kasa sayfasındaki "Borç tahsil et": kasaId'nin sistem dışı alacakları önce seçilir.
  preferCollect?: boolean;
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
  const [outside, setOutside] = useState(false);
  const [borrowerId, setBorrowerId] = useState<number | null>(null);
  const [party, setParty] = useState("");
  const [person, setPerson] = useState("");
  const [currency, setCurrency] = useState("USD");
  const parties = useMemo(() => knownParties(records), [records]);

  // Geri ödeme: kalan borcu olan çiftler. Kasalar arası borcu borçlu kasa öder (yazabilmeli); sistem dışı borcun
  // tahsilatını alacaklı kasa yazar (yazabilmeli).
  const openPairs = useMemo(
    () => debtPairs(records).filter((p) => p.outstanding > 0.004 && writableIds.has(p.external ? p.creditorId : p.debtorId)),
    [records, writableIds],
  );
  const [pairKey, setPairKey] = useState<string>(() => {
    const pick = (fn: (p: DebtPair) => boolean) => openPairs.find(fn)?.key;
    if (initialPairKey && openPairs.some((p) => p.key === initialPairKey)) return initialPairKey;
    if (kasaId) {
      const collect = pick((p) => p.external && p.creditorId === kasaId);
      const pay = pick((p) => !p.external && p.debtorId === kasaId && (creditorId == null || p.creditorId === creditorId)) ?? pick((p) => !p.external && p.debtorId === kasaId);
      const chosen = preferCollect ? collect ?? pay : pay ?? collect;
      if (chosen) return chosen;
    }
    return openPairs[0]?.key ?? "";
  });
  const pair = openPairs.find((p) => p.key === pairKey) ?? openPairs[0];
  const pairLabel = (p: DebtPair) =>
    `${localizeData(p.debtorName || nameOf(p.debtorId) || "—", language)} → ${localizeData(p.creditorName || nameOf(p.creditorId) || "—", language)} — ${tx(language, "kalan", "remaining", "mayî")} ${money(p.outstanding, p.currency)}`;

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amountNum = Number(amount.replace(",", "."));
  const remaining = pair?.outstanding ?? 0;
  const amountOk = Number.isFinite(amountNum) && amountNum > 0;
  const valid = mode === "lend"
    ? lenderId != null && (outside ? party.trim().length > 0 : borrowerId != null && lenderId !== borrowerId) && amountOk
    : Boolean(pair) && amountOk && amountNum <= remaining + 0.001;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const body = mode === "lend"
        ? outside
          ? { lenderCashAccountId: lenderId, borrowerParty: party.trim(), person: person.trim(), amount: amountNum, currency, date, note }
          : { lenderCashAccountId: lenderId, borrowerCashAccountId: borrowerId, amount: amountNum, currency, date, note }
        : pair!.external
          ? { debtorParty: pair!.debtorName, creditorCashAccountId: pair!.creditorId, person: person.trim(), amount: amountNum, currency: pair!.currency, date, note }
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
      notify(
        mode === "lend"
          ? tx(language, "Borç verildi.", "Debt lent.", "Deyn hat dayîn.")
          : pair!.external
            ? tx(language, "Tahsilat kaydedildi.", "Collection saved.", "Standin hat tomarkirin.")
            : tx(language, "Borç ödemesi kaydedildi.", "Repayment saved.", "Dravdana deynê hat tomarkirin."),
        "success",
      );
      onDone();
      onClose();
    } catch {
      notify(tx(language, "Borç işlemi kaydedilemedi.", "The debt operation could not be saved.", "Karûbarê deynê nehat tomarkirin."));
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "lend" ? tx(language, "Borç ver", "Lend", "Deyn bide") : tx(language, "Geri ödeme / Tahsilat", "Repayment / Collection", "Vegerandin / Standin");
  const intro = mode === "lend"
    ? outside
      ? tx(language, "Borç veren kasaya tek kayıt yazılır: kasa bakiyesi düşer, gider istatistiğine girmez. Borç Detay'da alacak olarak görünür.", "One record is written in the lending kasa: its balance drops, but it does not count as an expense. It shows as a receivable in Debt Details.", "Yek qeyd di qaseya deyndêr de tê nivîsandin: balans kêm dibe, wek mesref nayê hesibandin. Di Hûrguliyên Deynê de wek deynê ku tê standin xuya dike.")
      : tx(language, "Borç veren kasada gider, borç alan kasada gelir olarak iki kayıt birlikte yazılır. Borç veren kasanın gelir/gider istatistiği değişmez; yalnız bakiyesi düşer.", "Two records are written together: an expense in the lending kasa and income in the borrowing kasa. The lender's income/expense statistics stay unchanged; only its balance drops.", "Du qeyd bi hev re têne nivîsandin: mesref di qaseya deyndêr de, dahat di qaseya deyndar de. Statîstîka deyndêr naguhere; tenê balans kêm dibe.")
    : pair?.external
      ? tx(language, "Geri ödenen para alacaklı kasaya tahsilat olarak girer: bakiye artar, ek gelir sayılmaz. Tutar kalan alacağı aşamaz.", "The repaid money enters the creditor kasa as a collection: the balance rises, but it does not count as extra income. The amount cannot exceed what is owed.", "Pereyê vegerî wek standin dikeve qaseya deyndêr: balans zêde dibe, wek dahata zêde nayê hesibandin. Meblağ nikare ji deynê mayî zêdetir be.")
      : tx(language, "Borçlu kasada gider, alacaklı kasada tahsilat olarak iki kayıt birlikte yazılır. Ödeme kalan borcu aşamaz.", "Two records are written together: an expense in the debtor kasa and a collection in the creditor kasa. The payment cannot exceed the remaining debt.", "Du qeyd bi hev re têne nivîsandin: mesref di qaseya deyndar de, berhevkirin di qaseya deyndêr de. Dravdan nikare ji deynê mayî zêdetir be.");

  return (
    <div className="overlay">
      <div className="modal debtModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{title}</h2>
            <p>{intro}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <div className="debtModeTabs" role="tablist" aria-label={tx(language, "Borç işlemi", "Debt operation", "Karûbarê deynê")}>
          {([["lend", tx(language, "Borç ver", "Lend", "Deyn bide")], ["repay", tx(language, "Geri ödeme / Tahsilat", "Repayment / Collection", "Vegerandin / Standin")]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setAmount(""); setPerson(""); if (id === "lend" && lenderId == null && kasaId && writableIds.has(kasaId)) setLenderId(kasaId); }}>{label}</button>
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
              <div className="debtBorrowerKind wide" role="radiogroup" aria-label={tx(language, "Borç alan", "Borrower", "Deyndar")}>
                <span>{tx(language, "Borç alan", "Borrower", "Deyndar")}</span>
                <button type="button" role="radio" aria-checked={!outside} className={!outside ? "on" : ""} onClick={() => setOutside(false)}>
                  ▣ {tx(language, "Sistemdeki kasa / proje", "Kasa / project in the system", "Qase / projeya di sîstemê de")}
                </button>
                <button type="button" role="radio" aria-checked={outside} className={outside ? "on" : ""} onClick={() => setOutside(true)}>
                  ◇ {tx(language, "Sistem dışı kasa / proje", "Kasa / project outside the system", "Qase / projeya derveyî sîstemê")}
                </button>
              </div>
              {outside ? (
                <>
                  <label>
                    {tx(language, "Borç alan kasa / proje", "Borrowing kasa / project", "Qase / projeya deyndar")}
                    <input list="debtPartyOptions" value={party} onChange={(e) => setParty(e.target.value)} placeholder={tx(language, "ör. C.GROUP", "e.g. C.GROUP", "mînak C.GROUP")} maxLength={200} />
                    <datalist id="debtPartyOptions">
                      {parties.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </label>
                  <label>
                    {tx(language, "Parayı alan kişi", "Received by", "Kesê ku pere girt")}
                    <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder={tx(language, "isteğe bağlı", "optional", "bijarte")} maxLength={200} />
                  </label>
                </>
              ) : (
                <label>
                  {tx(language, "Borç alan kasa / proje", "Borrowing kasa / project", "Qase / projeya deyndar")}
                  <select value={borrowerId ?? ""} onChange={(e) => setBorrowerId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">{tx(language, "— Listeden seçin —", "— Pick from the list —", "— Ji lîsteyê hilbijêre —")}</option>
                    {cashAccounts.filter((a) => a.id !== lenderId).map((a) => <option key={a.id} value={a.id}>{localizeData(a.name, language)}</option>)}
                  </select>
                </label>
              )}
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
            <p className="debtEmpty wide">{tx(language, "Ödenecek ya da tahsil edilecek açık borç yok.", "There is no open debt to repay or collect.", "Deynê vekirî yê ku were dayîn an standin tune.")}</p>
          ) : (
            <>
              <label className="wide">
                {tx(language, "Borç (borçlu → alacaklı)", "Debt (debtor → creditor)", "Deyn (deyndar → deyndêr)")}
                <select value={pair?.key ?? ""} onChange={(e) => { setPairKey(e.target.value); setAmount(""); }}>
                  {openPairs.map((p) => <option key={p.key} value={p.key}>{pairLabel(p)}</option>)}
                </select>
                {pair?.external && pair.people.length > 0 && (
                  <small className="debtHint">{tx(language, "Parayı alan", "Received by", "Kesê ku pere girt")}: {pair.people.join(", ")}</small>
                )}
              </label>
              <label>
                {pair?.external ? tx(language, "Tahsil edilen tutar", "Amount collected", "Meblağa hatî standin") : tx(language, "Ödeme tutarı", "Payment amount", "Mîqdara dravdanê")} ({pair?.currency})
                <div className="amountCurrency">
                  <input type="number" min="0" max={remaining} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                  <button type="button" className="light compact" onClick={() => setAmount(String(remaining))}>{tx(language, "Tamamı", "All", "Hemû")}</button>
                </div>
                <small className="debtHint">
                  {tx(language, "Kalan borç", "Remaining debt", "Deynê mayî")}: {money(remaining, pair?.currency ?? "USD")}
                  {amountOk && amountNum > remaining + 0.001 ? ` · ${tx(language, "Ödeme kalan borçtan büyük olamaz", "The payment cannot exceed the remaining debt", "Dravdan nikare ji deynê mayî mezintir be")}` : ""}
                </small>
              </label>
              {pair?.external && (
                <label>
                  {tx(language, "Ödeyen kişi", "Paid by", "Kesê ku da")}
                  <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder={tx(language, "isteğe bağlı", "optional", "bijarte")} maxLength={200} />
                </label>
              )}
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
          <button type="button" className="primary" disabled={!valid || submitting} onClick={submit}>
            {mode === "lend" ? title : pair?.external ? tx(language, "Tahsil et", "Collect", "Bistîne") : tx(language, "Ödeme yap", "Make payment", "Dravdan bike")}
          </button>
        </div>
      </div>
    </div>
  );
}
