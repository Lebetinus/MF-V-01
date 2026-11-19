"use client";

import { useEffect, useMemo, useState } from "react";
import { debtPairOfRecord, debtPairs, knownParties, partyKey } from "../lib/debts";
import { localizeData, tx } from "../lib/i18n";
import { date, money } from "../lib/finance";
import type { Language, RecordItem } from "../lib/types";
import { notify } from "../lib/notify";

// "Borca çevir" / "Borçtan çıkar" penceresi (kayıt tablosundaki ⇄ düğmesi). Var olan bir kayıt silinmeden sistem dışı
// bir kasaya / projeye borç olarak işaretlenir (bkz. app/api/_lib/debts.ts markRecordAsPartyDebt):
//  - Gider → verilen borç: bakiye aynı kalır, kayıt gider istatistiğinden çıkar, Borç Detay'da alacak olur.
//  - Gelir → borç tahsilatı: o kasanın aynı para birimindeki açık bir alacağını kapatır, ek gelir sayılmaz.
// İşaretli bir kayıt aynı düğmeyle yeniden normal gelir / gidere döndürülür.
export function DebtMarkModal({
  language,
  record: x,
  records,
  onDone,
  onClose,
}: {
  language: Language;
  record: RecordItem;
  records: RecordItem[];
  onDone: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const marked = Boolean(x.debtRole);
  const expense = x.kind === "expense";
  const parties = useMemo(() => knownParties(records), [records]);
  // Tahsilat olarak işaretlenecek gelir: bu kasanın bu para birimindeki açık sistem dışı alacakları.
  const openForIncome = useMemo(
    () => debtPairs(records).filter((p) => p.external && p.creditorId === x.cashAccountId && p.currency === x.currency && p.outstanding > 0.004),
    [records, x.cashAccountId, x.currency],
  );
  const [party, setParty] = useState(() => (expense ? x.source : openForIncome[0]?.debtorName ?? ""));
  const [busy, setBusy] = useState(false);
  const chosenOpen = openForIncome.find((p) => partyKey(p.debtorName) === partyKey(party));
  const tooMuch = !expense && !marked && chosenOpen != null && x.amount > chosenOpen.outstanding + 0.001;
  const valid = marked || (expense ? party.trim().length > 0 : chosenOpen != null && !tooMuch);
  const pair = marked ? debtPairOfRecord(records, x) : undefined;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/records/${x.id}/debt`, marked
        ? { method: "DELETE" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ party: party.trim(), updatedAt: x.updatedAt }) });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        notify(info.error && info.error !== "Validation failed" ? info.error : info.issues?.[0]?.message || tx(language, "Kayıt güncellenemedi.", "The record could not be updated.", "Qeyd nehat nûkirin."));
        return;
      }
      notify(
        marked
          ? tx(language, "Borç işareti kaldırıldı.", "Debt mark removed.", "Nîşana deynê hat rakirin.")
          : expense
            ? tx(language, "Gider borca çevrildi.", "Expense marked as debt.", "Mesref bû deyn.")
            : tx(language, "Gelir tahsilat olarak işaretlendi.", "Income marked as a collection.", "Dahat wek standin hat nîşankirin."),
        "success",
      );
      onDone();
      onClose();
    } catch {
      notify(tx(language, "Kayıt güncellenemedi.", "The record could not be updated.", "Qeyd nehat nûkirin."));
    } finally {
      setBusy(false);
    }
  }

  const title = marked
    ? tx(language, "Borçtan çıkar", "Remove debt mark", "Nîşana deynê rake")
    : expense
      ? tx(language, "Borca çevir", "Mark as debt", "Bike deyn")
      : tx(language, "Borç tahsilatı olarak işaretle", "Mark as debt collection", "Wek standina deynê nîşan bike");

  return (
    <div className="overlay">
      <div className="modal debtModal debtMarkModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{title}</h2>
            <p>
              {marked
                ? tx(language, "Kayıt yeniden normal gelir / gider olur ve istatistiklere girer. Tutarı, tarihi ve diğer bilgileri değişmez.", "The record becomes a normal income / expense again and counts in the statistics. Its amount, date and other details stay the same.", "Qeyd dîsa dibe dahat / mesrefa asayî û dikeve statîstîkan. Meblağ, dîrok û agahiyên din naguherin.")
                : expense
                  ? tx(language, "Kayıt silinmez; tutarı, tarihi, ana başlığı ve kişi bilgisi aynen kalır. Kasa bakiyesi değişmez; kayıt gider istatistiğinden çıkar ve Borç Detay'da alacak olarak görünür. Geri ödeme yapıldığında “Borç tahsil et” ile kasaya girer, ek gelir sayılmaz.", "The record is kept with its amount, date, title and person. The kasa balance does not change; the record leaves the expense statistics and shows as a receivable in Debt Details. When it is repaid, “Collect debt” puts the money back without counting it as extra income.", "Qeyd nayê jêbirin; meblağ, dîrok, sernav û kes wek xwe dimînin. Balansa qaseyê naguhere; qeyd ji statîstîka mesrefê derdikeve û di Hûrguliyên Deynê de wek deynê ku tê standin xuya dike.")
                  : tx(language, "Bu gelir, seçilen kasanın / projenin geri ödemesi sayılır: bakiye aynı kalır, gelir istatistiğinden çıkar ve kalan alacak düşer.", "This income counts as a repayment by the chosen kasa / project: the balance stays the same, it leaves the income statistics and the amount owed drops.", "Ev dahat wek vegerandina qase / projeya hilbijartî tê hesibandin: balans naguhere, ji statîstîka dahatê derdikeve û deynê mayî kêm dibe.")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <dl className="debtMarkFacts">
          <dt>{tx(language, "Kasa", "Cash account", "Qase")}</dt><dd>{localizeData(x.cashAccount, language)}</dd>
          <dt>{tx(language, "Tarih", "Date", "Tarîx")}</dt><dd>{date(x.date, language)}</dd>
          <dt>{tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke")}</dt><dd>{localizeData(x.source, language) || "—"}</dd>
          <dt>{expense ? tx(language, "Parayı alan kişi", "Received by", "Kesê ku pere girt") : tx(language, "Kişi", "Person", "Kes")}</dt><dd>{x.person ? localizeData(x.person, language) : "—"}</dd>
          <dt>{tx(language, "Tutar", "Amount", "Meblağ")}</dt><dd className={expense ? "negative" : "positive"}>{money(x.amount, x.currency)}</dd>
          {marked && (
            <>
              <dt>{tx(language, "Borç alan kasa / proje", "Borrowing kasa / project", "Qase / projeya deyndar")}</dt><dd>{localizeData(x.debtParty ?? "—", language)}</dd>
              {pair && <><dt>{tx(language, "Kalan alacak", "Still owed", "Deynê mayî")}</dt><dd>{money(pair.outstanding, pair.currency)}</dd></>}
            </>
          )}
        </dl>
        {!marked && (
          <div className="formGrid">
            {expense ? (
              <label className="wide">
                {tx(language, "Borç alan kasa / proje", "Borrowing kasa / project", "Qase / projeya deyndar")}
                <input list="debtMarkParties" value={party} onChange={(e) => setParty(e.target.value)} maxLength={200} autoFocus />
                <datalist id="debtMarkParties">
                  {[...new Set([x.source, ...parties].filter(Boolean))].map((p) => <option key={p} value={p} />)}
                </datalist>
                <small className="debtHint">{tx(language, "Varsayılan: kaydın ana başlığı. Aynı proje adı aynı borç hesabında toplanır.", "Default: the record's main category. The same project name adds up in one debt account.", "Pêşdanasîn: sernavê qeydê. Heman navê projeyê di yek hesabê deynê de tê berhevkirin.")}</small>
              </label>
            ) : openForIncome.length === 0 ? (
              <p className="debtEmpty wide">{tx(language, `Bu kasanın ${x.currency} cinsinden sistem dışı bir kasadan / projeden açık alacağı yok.`, `This kasa has no open ${x.currency} receivable from a kasa / project outside the system.`, `Ev qase ji qase / projeyeke derveyî sîstemê bi ${x.currency} deynê vekirî tune.`)}</p>
            ) : (
              <label className="wide">
                {tx(language, "Geri ödeyen kasa / proje", "Repaying kasa / project", "Qase / projeya ku vedigerîne")}
                <select value={chosenOpen?.key ? chosenOpen.debtorName : ""} onChange={(e) => setParty(e.target.value)}>
                  {openForIncome.map((p) => (
                    <option key={p.key} value={p.debtorName}>
                      {localizeData(p.debtorName, language)} — {tx(language, "kalan", "remaining", "mayî")} {money(p.outstanding, p.currency)}
                    </option>
                  ))}
                </select>
                {tooMuch && <small className="debtHint negative">{tx(language, "Bu tutar kalan alacaktan büyük.", "This amount is more than what is owed.", "Ev meblağ ji deynê mayî mezintir e.")}</small>}
              </label>
            )}
          </div>
        )}
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="button" className="primary" disabled={!valid || busy} onClick={submit}>{title}</button>
        </div>
      </div>
    </div>
  );
}
