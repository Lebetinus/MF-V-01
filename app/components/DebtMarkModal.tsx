"use client";

import { useEffect, useMemo, useState } from "react";
import { debtPairOfRecord, debtPairs, isPartyDebt, knownParties, type DebtPair } from "../lib/debts";
import { localizeData, tx } from "../lib/i18n";
import { date, money } from "../lib/finance";
import type { CashAccountSummary, Language, RecordItem } from "../lib/types";
import { notify } from "../lib/notify";

// "Borca çevir" / "Borçtan çıkar" penceresi (kayıt tablosundaki ⇄ düğmesi). Var olan bir kayıt silinmeden borç olarak
// işaretlenir (bkz. app/api/_lib/debts.ts markRecordAsKasaDebt / markRecordAsPartyDebt):
//  - Gider → verilen borç: bu kasanın bakiyesi aynı kalır, kayıt gider istatistiğinden çıkar, Borç Detay'da görünür.
//  - Gelir → borç tahsilatı: açık bir alacağı kapatır, ek gelir sayılmaz.
// Karşı taraf sistemdeki bir kasa / proje ise LİSTEDEN seçilir (elle yazılamaz) ve karşı kasaya ikiz kayıt yazılır;
// yalnız sistem dışı bir kasa / proje adı elle yazılır. İşaretli bir kayıt aynı düğmeyle normal kayda döndürülür.
export function DebtMarkModal({
  language,
  record: x,
  records,
  cashAccounts,
  onDone,
  onClose,
}: {
  language: Language;
  record: RecordItem;
  records: RecordItem[];
  cashAccounts: CashAccountSummary[];
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
  const kasaOptions = useMemo(
    () => cashAccounts.filter((a) => a.id !== x.cashAccountId).sort((a, b) => a.name.localeCompare(b.name, "tr")),
    [cashAccounts, x.cashAccountId],
  );
  // Kaydın ana başlığıyla aynı adlı bir kasa varsa önceden seçilir (büyük/küçük harf ve boşluk farkı gözetmeden).
  const sameNameKasa = useMemo(() => {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
    return kasaOptions.find((a) => norm(a.name) === norm(x.source));
  }, [kasaOptions, x.source]);

  // Verilen borcun karşı tarafı sonradan değiştirilebilir (gider kaydı); tahsilat kaydı yalnız borçtan çıkarılır.
  const canChange = marked && expense && (x.debtRole === "lent");
  // Gider → borç: karşı taraf sistemdeki kasa (varsayılan) ya da sistem dışı ad. İşaretli kayıtta şimdiki karşı taraf.
  const [outside, setOutside] = useState(() => marked && isPartyDebt(x));
  const [kasaId, setKasaId] = useState<number | null>(() => (marked ? x.debtCashAccountId ?? null : sameNameKasa?.id ?? null));
  const [party, setParty] = useState(() => (marked && isPartyDebt(x) ? x.debtParty ?? "" : x.source));
  const changed = !marked || (outside ? !isPartyDebt(x) || party.trim().toLocaleUpperCase("tr-TR") !== (x.debtParty ?? "").toLocaleUpperCase("tr-TR") : kasaId !== (x.debtCashAccountId ?? null));
  // Gelir → tahsilat: bu kasanın aynı para birimindeki açık alacakları (kasalar arası ve sistem dışı).
  const openForIncome = useMemo(
    () => debtPairs(records).filter((p) => p.creditorId === x.cashAccountId && p.currency === x.currency && p.outstanding > 0.004),
    [records, x.cashAccountId, x.currency],
  );
  const [pairKey, setPairKey] = useState(() => openForIncome[0]?.key ?? "");
  const chosenPair: DebtPair | undefined = openForIncome.find((p) => p.key === pairKey) ?? openForIncome[0];
  const tooMuch = !expense && !marked && chosenPair != null && x.amount > chosenPair.outstanding + 0.001;

  const [busy, setBusy] = useState(false);
  const pickerValid = expense ? (outside ? party.trim().length > 0 : kasaId != null) : chosenPair != null && !tooMuch;
  const valid = marked ? canChange && pickerValid && changed : pickerValid;
  const pair = marked ? debtPairOfRecord(records, x) : undefined;
  const kasaLeg = marked && !isPartyDebt(x);
  const counterpartName = x.debtParty || cashAccounts.find((a) => a.id === x.debtCashAccountId)?.name || "—";

  async function submit(unmark = false) {
    if ((!unmark && !valid) || busy) return;
    setBusy(true);
    try {
      let body: Record<string, unknown> | null = null;
      if (!unmark) {
        if (expense) body = outside ? { party: party.trim() } : { cashAccountId: kasaId };
        else body = chosenPair!.external ? { party: chosenPair!.debtorName } : { cashAccountId: chosenPair!.debtorId };
        body.updatedAt = x.updatedAt;
      }
      const response = await fetch(`/api/records/${x.id}/debt`, body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : { method: "DELETE" });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        notify(info.error && info.error !== "Validation failed" ? info.error : info.issues?.[0]?.message || tx(language, "Kayıt güncellenemedi.", "The record could not be updated.", "Qeyd nehat nûkirin."));
        return;
      }
      notify(
        unmark
          ? tx(language, "Borç işareti kaldırıldı.", "Debt mark removed.", "Nîşana deynê hat rakirin.")
          : marked
            ? tx(language, "Borcun karşı tarafı değiştirildi.", "The debt's counterpart was changed.", "Aliyê din ê deynê hat guhertin.")
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
    ? canChange
      ? tx(language, "Borç bilgisi", "Debt details", "Agahiya deynê")
      : tx(language, "Borçtan çıkar", "Remove debt mark", "Nîşana deynê rake")
    : expense
      ? tx(language, "Borca çevir", "Mark as debt", "Bike deyn")
      : tx(language, "Borç tahsilatı olarak işaretle", "Mark as debt collection", "Wek standina deynê nîşan bike");

  const intro = canChange
    ? tx(language, "Paranın verildiği kasayı / projeyi değiştirebilir ya da kaydı borçtan çıkarabilirsiniz. Sistem içi borçta ana başlık seçilen kasanın adı olur; borçtan çıkarılınca eski başlık geri gelir.", "You can change where the money went or remove the debt mark. For a debt inside the system the main category becomes the chosen kasa's name; removing the mark restores the old one.", "Hûn dikarin qase / projeya ku pere çûyê biguherînin an nîşana deynê rakin.")
    : marked
    ? kasaLeg
      ? tx(language, `Kayıt yeniden normal gelir / gider olur ve istatistiklere girer. ${counterpartName} kasasındaki karşı kayıt silinir (Arşiv'e taşınır).`, `The record becomes a normal income / expense again. Its counterpart in ${counterpartName} is deleted (moved to the Archive).`, `Qeyd dîsa dibe dahat / mesrefa asayî. Qeyda hevpar a di ${counterpartName} de tê jêbirin (diçe Arşîvê).`)
      : tx(language, "Kayıt yeniden normal gelir / gider olur ve istatistiklere girer. Tutarı, tarihi ve diğer bilgileri değişmez.", "The record becomes a normal income / expense again and counts in the statistics. Its amount, date and other details stay the same.", "Qeyd dîsa dibe dahat / mesrefa asayî û dikeve statîstîkan. Meblağ, dîrok û agahiyên din naguherin.")
    : expense
      ? outside
        ? tx(language, "Kayıt silinmez; tutarı, tarihi, ana başlığı ve kişisi aynen kalır. Kasa bakiyesi değişmez; kayıt gider istatistiğinden çıkar ve Borç Detay'da alacak olarak görünür.", "The record is kept with its amount, date, title and person. The balance does not change; it leaves the expense statistics and shows as a receivable in Debt Details.", "Qeyd nayê jêbirin; meblağ, dîrok, sernav û kes wek xwe dimînin. Balans naguhere; qeyd ji statîstîka mesrefê derdikeve û di Hûrguliyên Deynê de xuya dike.")
        : tx(language, "Kayıt silinmez; tutarı, tarihi, ana başlığı ve kişisi aynen kalır ve gider istatistiğinden çıkar. Seçilen kasaya aynı tutarda “Borç alındı” geliri yazılır; geri ödemeyi o kasa “Borç öde” ile yapar.", "The record is kept as it is and leaves the expense statistics. A matching “Borrowed” income is written to the chosen kasa, which repays with “Repay debt”.", "Qeyd wek xwe dimîne û ji statîstîka mesrefê derdikeve. Di qaseya hilbijartî de dahata “Deyn hat girtin” tê nivîsandin.")
      : tx(language, "Bu gelir, seçilen borcun geri ödemesi sayılır: bakiye aynı kalır, gelir istatistiğinden çıkar ve kalan alacak düşer. Borçlu sistemdeki bir kasaysa o kasaya aynı tutarda “Borç ödemesi” gideri yazılır.", "This income counts as a repayment of the chosen debt: the balance stays the same, it leaves the income statistics and the amount owed drops. If the debtor is a kasa in the system, a matching “Debt payment” expense is written there.", "Ev dahat wek vegerandina deynê hilbijartî tê hesibandin: balans naguhere û deynê mayî kêm dibe.");

  return (
    <div className="overlay">
      <div className="modal debtModal debtMarkModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{title}</h2>
            <p>{intro}</p>
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
              <dt>{tx(language, "Karşı kasa / proje", "Counterpart kasa / project", "Qase / projeya din")}</dt>
              <dd>{localizeData(counterpartName, language)}{!kasaLeg && <span className="debtOutsideTag">{tx(language, "sistem dışı", "outside", "derveyî")}</span>}</dd>
              {pair && <><dt>{tx(language, "Kalan borç", "Still owed", "Deynê mayî")}</dt><dd>{money(pair.outstanding, pair.currency)}</dd></>}
            </>
          )}
        </dl>
        {(!marked || canChange) && (
          <div className="formGrid">
            {expense ? (
              <>
                <div className="debtBorrowerKind wide" role="radiogroup" aria-label={tx(language, "Borç alan", "Borrower", "Deyndar")}>
                  <span>{tx(language, "Paranın verildiği", "Money went to", "Pere çû")}</span>
                  <button type="button" role="radio" aria-checked={!outside} className={!outside ? "on" : ""} onClick={() => setOutside(false)}>
                    ▣ {tx(language, "Sistemdeki kasa / proje", "Kasa / project in the system", "Qase / projeya di sîstemê de")}
                  </button>
                  <button type="button" role="radio" aria-checked={outside} className={outside ? "on" : ""} onClick={() => setOutside(true)}>
                    ◇ {tx(language, "Sistem dışı kasa / proje", "Kasa / project outside the system", "Qase / projeya derveyî sîstemê")}
                  </button>
                </div>
                {outside ? (
                  <label className="wide">
                    {tx(language, "Sistem dışı kasa / proje adı", "Name of the kasa / project outside the system", "Navê qase / projeya derveyî sîstemê")}
                    <input list="debtMarkParties" value={party} onChange={(e) => setParty(e.target.value)} maxLength={200} />
                    <datalist id="debtMarkParties">
                      {[...new Set([x.source, ...parties].filter(Boolean))].map((p) => <option key={p} value={p} />)}
                    </datalist>
                    <small className="debtHint">{tx(language, "Yalnız sistemde kasası olmayanlar için. Aynı ad aynı borç hesabında toplanır.", "Only for those without a kasa in the system. The same name adds up in one debt account.", "Tenê ji bo yên ku qaseya wan di sîstemê de tune.")}</small>
                  </label>
                ) : (
                  <label className="wide">
                    {tx(language, "Borç alan kasa / proje", "Borrowing kasa / project", "Qase / projeya deyndar")}
                    <select value={kasaId ?? ""} onChange={(e) => setKasaId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">{tx(language, "— Listeden seçin —", "— Pick from the list —", "— Ji lîsteyê hilbijêre —")}</option>
                      {kasaOptions.map((a) => <option key={a.id} value={a.id}>{localizeData(a.name, language)}</option>)}
                    </select>
                    <small className="debtHint">
                      {sameNameKasa
                        ? tx(language, "Ana başlıkla aynı adlı kasa seçildi; doğru değilse listeden değiştirin.", "The kasa named like the main category is selected; change it if it is not right.", "Qaseya bi navê sernavê hat hilbijartin.")
                        : tx(language, "Listede yoksa “Sistem dışı kasa / proje”yi seçin.", "If it is not in the list, choose “outside the system”.", "Heke di lîsteyê de tune be, “derveyî sîstemê” hilbijêre.")}
                    </small>
                  </label>
                )}
              </>
            ) : openForIncome.length === 0 ? (
              <p className="debtEmpty wide">{tx(language, `Bu kasanın ${x.currency} cinsinden açık alacağı yok.`, `This kasa has no open ${x.currency} receivable.`, `Ev qase bi ${x.currency} deynê vekirî tune.`)}</p>
            ) : (
              <label className="wide">
                {tx(language, "Geri ödeyen kasa / proje", "Repaying kasa / project", "Qase / projeya ku vedigerîne")}
                <select value={chosenPair?.key ?? ""} onChange={(e) => setPairKey(e.target.value)}>
                  {openForIncome.map((p) => (
                    <option key={p.key} value={p.key}>
                      {localizeData(p.debtorName, language)}{p.external ? ` (${tx(language, "sistem dışı", "outside", "derveyî")})` : ""} — {tx(language, "kalan", "remaining", "mayî")} {money(p.outstanding, p.currency)}
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
          {marked && (
            <button type="button" className={canChange ? "light redText" : "primary"} disabled={busy} onClick={() => submit(true)}>
              {tx(language, "Borçtan çıkar", "Remove debt mark", "Nîşana deynê rake")}
            </button>
          )}
          {(!marked || canChange) && (
            <button type="button" className="primary" disabled={!valid || busy} onClick={() => submit()}>
              {marked ? tx(language, "Değişikliği kaydet", "Save change", "Guhertinê tomar bike") : title}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
