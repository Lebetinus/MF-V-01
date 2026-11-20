"use client";

import { useEffect, useMemo, useState } from "react";
import { combineByCurrency, date, money, type ExchangeRates } from "../lib/finance";
import { FX_CURRENCIES, fxConvert, fxRateLabel, fxRateUnits, suggestedRate } from "../lib/fx";
import { localizeData, tx } from "../lib/i18n";
import { notify } from "../lib/notify";
import type { Language, RecordItem } from "../lib/types";

const today = () => new Date().toISOString().slice(0, 10);

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Kur alanı: Ayarlar'daki kur önerilir, kullanıcı elle yazabilir; "Önerilen kur" düğmesi öneriye döner.
function RateField({ language, from, to, rate, setRate, suggested }: { language: Language; from: string; to: string; rate: string; setRate: (v: string) => void; suggested: number | null }) {
  const [one, other] = fxRateUnits(from, to);
  return (
    <label className="wide">
      {tx(language, "Kur", "Exchange rate", "Kur")}
      <div className="fxRate">
        <span>1 {one} =</span>
        <input type="number" min="0" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
        <span>{other}</span>
        {suggested != null && Number(rate) !== suggested && (
          <button type="button" className="light compact" onClick={() => setRate(String(suggested))}>
            {tx(language, "Önerilen kur", "Suggested rate", "Kurê pêşniyarkirî")}: {suggested.toLocaleString("tr-TR", { maximumFractionDigits: 8 })}
          </button>
        )}
      </div>
      <small className="debtHint">
        {suggested != null
          ? tx(language, "Önerilen kur Ayarlar > Döviz Kurları'ndan gelir; gerçekte kullanılan kuru elle yazabilirsiniz.", "The suggested rate comes from Settings > Exchange Rates; you can type the rate actually used.", "Kurê pêşniyarkirî ji Mîheng > Kurên Diravan tê; hûn dikarin kurê rastîn binivîsin.")
          : tx(language, "Ayarlar'da bu birim için kur yok; kullanılan kuru elle yazın.", "There is no rate for this currency in Settings; type the rate used.", "Ji bo vê diravê kur tune; kurê bikaranî binivîsin.")}
      </small>
    </label>
  );
}

// "Döviz bozdur": kasa içinde bir para biriminden ötekine geçiş (bkz. app/api/_lib/fx.ts runFxExchange). Verilen birimde
// gider + alınan birimde gelir yazılır; bakiye iki birimde de değişir, gelir/gider istatistiğine girmez.
export function FxExchangeModal({
  language,
  kasa,
  records,
  exchangeRates,
  onDone,
  onClose,
}: {
  language: Language;
  kasa: { id: number; name: string };
  records: RecordItem[];
  exchangeRates: ExchangeRates;
  onDone: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  // Kasanın para birimine göre bakiyesi (verilecek birim önce bakiyesi olanlardan seçilir).
  const balances = useMemo(() => {
    const rows = records.filter((r) => r.cashAccountId === kasa.id);
    return combineByCurrency([{ rows: rows.filter((r) => r.kind === "income") }, { rows: rows.filter((r) => r.kind === "expense"), sign: -1 }]);
  }, [records, kasa.id]);
  const firstNonUsd = Object.entries(balances).filter(([c, v]) => c !== "USD" && v > 0.004).sort((a, b) => b[1] - a[1])[0]?.[0];
  const [from, setFrom] = useState(firstNonUsd ?? "SYP");
  const [to, setTo] = useState(from === "USD" ? "SYP" : "USD");
  const suggested = suggestedRate(from, to, exchangeRates);
  // null = kullanıcı kuru yazmadı → önerilen kur kullanılır (kurlar pencere açıldıktan sonra da gelebilir).
  const [rateInput, setRate] = useState<string | null>(null);
  const rate = rateInput ?? (suggested != null ? String(suggested) : "");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const pickFrom = (c: string) => {
    const nextTo = c === to ? (c === "USD" ? "SYP" : "USD") : to;
    setFrom(c);
    setTo(nextTo);
    setRate(null);
  };
  const pickTo = (c: string) => {
    setTo(c);
    setRate(null);
  };

  const amountNum = Number(amount.replace(",", "."));
  const rateNum = Number(rate.replace(",", "."));
  const ok = Number.isFinite(amountNum) && amountNum > 0 && Number.isFinite(rateNum) && rateNum > 0 && from !== to;
  const result = ok ? fxConvert(amountNum, from, to, rateNum) : 0;
  const available = balances[from] ?? 0;
  const overBalance = ok && amountNum > available + 0.004;
  // Kasanın bakiyesi olan birimleri (kartlar) ve işlemden sonraki bakiyeler.
  const held = Object.entries(balances).filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => (a[0] === "USD" ? 1 : 0) - (b[0] === "USD" ? 1 : 0) || b[1] - a[1]);
  const afterFrom = available - (ok ? amountNum : 0);
  const afterTo = (balances[to] ?? 0) + (ok ? result : 0);

  async function submit() {
    if (!ok || result <= 0 || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/fx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashAccountId: kasa.id, fromCurrency: from, toCurrency: to, amount: amountNum, rate: rateNum, date: day, note }),
      });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        notify(info.error && info.error !== "Validation failed" ? info.error : info.issues?.[0]?.message || tx(language, "Döviz bozdurma kaydedilemedi.", "The exchange could not be saved.", "Guhertina diravê nehat tomarkirin."));
        return;
      }
      notify(tx(language, "Döviz bozduruldu.", "Currency exchanged.", "Dirav hat guhertin."), "success");
      onDone();
      onClose();
    } catch {
      notify(tx(language, "Döviz bozdurma kaydedilemedi.", "The exchange could not be saved.", "Guhertina diravê nehat tomarkirin."));
    } finally {
      setBusy(false);
    }
  }

  const title = tx(language, "Döviz bozdur", "Exchange currency", "Dirav biguherîne");
  return (
    <div className="overlay">
      <div className="modal debtModal fxModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{title} · {localizeData(kasa.name, language)}</h2>
            <p>{tx(language, "Kasadaki bir para birimini ötekine çevirir (ör. SYP'yi dolara bozdurmak): bozdurulan para kasadan çıkar, karşılığı kasaya girer; iki kayıt birlikte yazılır. Bakiye iki birimde de değişir; gelir/gider istatistiğine girmez. Çevrilen tutar ve kur kayıtta bilgi olarak kalır.", "Converts one currency of the kasa into another: an expense in the given currency and income in the received one are written together. The balance changes in both currencies but income/expense statistics do not. The converted amount and the rate stay on the record.", "Diravekî qaseyê dike diravekî din: du qeyd bi hev re têne nivîsandin. Balans di her du diravan de diguhere; statîstîka dahat/mesrefê naguhere.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <div className="fxHeld">
          <span>{tx(language, "Kasadaki para — bozdurulacak parayı seçin", "Money in the kasa — pick the money to exchange", "Pereyê di qaseyê de — pereyê ku were guhertin hilbijêrin")}</span>
          {held.length === 0 ? (
            <small className="debtHint">{tx(language, "Bu kasada bakiye yok.", "This kasa has no balance.", "Di vê qaseyê de balans tune.")}</small>
          ) : (
            <div className="fxHeldCards">
              {held.map(([c, v]) => (
                <button key={c} type="button" className={`fxHeldCard${c === from ? " active" : ""}${v < 0 ? " negative" : ""}`} onClick={() => pickFrom(c)} aria-pressed={c === from}>
                  <b>{c}</b>
                  <span>{money(v, c)}</span>
                  {c === from && <small>{tx(language, "bozdurulacak", "to exchange", "tê guhertin")}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="formGrid">
          <label>
            {tx(language, "Kasadan çıkacak para (bozdurulacak)", "Money leaving the kasa (exchanged)", "Pereyê ji qaseyê derdikeve")}
            <select value={from} onChange={(e) => pickFrom(e.target.value)}>
              {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}{balances[c] ? ` — ${tx(language, "kasada", "in kasa", "di qaseyê de")} ${money(balances[c], c)}` : ""}</option>)}
            </select>
          </label>
          <label>
            {tx(language, "Kasaya girecek para", "Money entering the kasa", "Pereyê dikeve qaseyê")}
            <select value={to} onChange={(e) => pickTo(e.target.value)}>
              {FX_CURRENCIES.filter((c) => c !== from).map((c) => <option key={c} value={c}>{c}{balances[c] ? ` — ${tx(language, "kasada", "in kasa", "di qaseyê de")} ${money(balances[c], c)}` : ""}</option>)}
            </select>
          </label>
          <label>
            {tx(language, "Bozdurulacak tutar", "Amount to exchange", "Meblağa ku tê guhertin")} ({from})
            <div className="amountCurrency">
              <input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              {available > 0.004 && <button type="button" className="light compact" onClick={() => setAmount(String(Math.round(available * 100) / 100))}>{tx(language, "Tamamı", "All", "Hemû")}</button>}
            </div>
            <small className={`debtHint${overBalance ? " negative" : ""}`}>
              {tx(language, "Kasada", "In kasa", "Di qaseyê de")}: {money(available, from)}
              {overBalance ? ` · ${tx(language, "Tutar kasadaki bakiyeden büyük", "More than the kasa holds", "Ji balansê mezintir e")}` : ""}
            </small>
          </label>
          <label>
            {tx(language, "Tarih", "Date", "Tarîx")}
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <RateField language={language} from={from} to={to} rate={rate} setRate={setRate} suggested={suggested} />
          <div className="wide fxResult">
            {ok ? (
              <>
                <div className="fxFlow">
                  <span className="out">{tx(language, "Kasadan çıkacak", "Leaves the kasa", "Ji qaseyê derdikeve")}: <b>{money(amountNum, from)}</b></span>
                  <span className="in">{tx(language, "Kasaya girecek", "Enters the kasa", "Dikeve qaseyê")}: <b>{money(result, to)}</b></span>
                </div>
                <small>
                  {fxRateLabel(from, to, rateNum)} · {tx(language, "İşlemden sonra kasada", "After this the kasa holds", "Piştî vê di qaseyê de")}: {money(afterFrom, from)} · {money(afterTo, to)}
                </small>
              </>
            ) : tx(language, "Tutarı ve kuru girin.", "Enter the amount and the rate.", "Meblağ û kurê binivîsin.")}
          </div>
          <label className="wide">
            {tx(language, "Not", "Note", "Nîşe")}
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          <button type="button" className="primary" disabled={!ok || result <= 0 || busy} onClick={submit}>{title}</button>
        </div>
      </div>
    </div>
  );
}

// "Dolara çevir": var olan bir gelir / giderin tutarı kurla çevrilir; ilk tutar, birimi ve kur kayıtta bilgi olarak kalır
// (bkz. app/api/_lib/fx.ts convertRecord). Çevrilmiş kayıtta çevirme geri alınabilir.
export function FxConvertModal({
  language,
  record: x,
  exchangeRates,
  onDone,
  onClose,
}: {
  language: Language;
  record: RecordItem;
  exchangeRates: ExchangeRates;
  onDone: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const converted = Boolean(x.originalCurrency);
  const [to, setTo] = useState(x.currency === "USD" ? "EUR" : "USD");
  const suggested = suggestedRate(x.currency, to, exchangeRates);
  const [rateInput, setRate] = useState<string | null>(null);
  const rate = rateInput ?? (suggested != null ? String(suggested) : "");
  const [busy, setBusy] = useState(false);
  const rateNum = Number(rate.replace(",", "."));
  const ok = Number.isFinite(rateNum) && rateNum > 0 && to !== x.currency;
  const result = ok ? fxConvert(x.amount, x.currency, to, rateNum) : 0;

  async function submit(revert = false) {
    if ((!revert && (!ok || result <= 0)) || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/records/${x.id}/convert`, revert
        ? { method: "DELETE" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toCurrency: to, rate: rateNum, updatedAt: x.updatedAt }) });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        notify(info.error && info.error !== "Validation failed" ? info.error : info.issues?.[0]?.message || tx(language, "Kayıt güncellenemedi.", "The record could not be updated.", "Qeyd nehat nûkirin."));
        return;
      }
      notify(revert ? tx(language, "Çevirme geri alındı.", "Conversion undone.", "Guhertin hat betalkirin.") : tx(language, "Kayıt çevrildi.", "Record converted.", "Qeyd hat guhertin."), "success");
      onDone();
      onClose();
    } catch {
      notify(tx(language, "Kayıt güncellenemedi.", "The record could not be updated.", "Qeyd nehat nûkirin."));
    } finally {
      setBusy(false);
    }
  }

  const title = to === "USD" ? tx(language, "Dolara çevir", "Convert to dollars", "Bike dolar") : tx(language, "Para birimini çevir", "Convert currency", "Diravê biguherîne");
  return (
    <div className="overlay">
      <div className="modal debtModal fxModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{converted ? tx(language, "Çevrilmiş kayıt", "Converted record", "Qeyda guhertî") : title}</h2>
            <p>{tx(language, "Kaydın tutarı ve para birimi kurla çevrilir; ilk tutar, para birimi ve kullanılan kur kayıtta bilgi olarak kalır. Kasa bakiyesi yeni birime göre hesaplanır. Çevirme sonradan geri alınabilir.", "The record's amount and currency are converted at the rate; the original amount, currency and the rate stay on the record. The kasa balance follows the new currency. The conversion can be undone later.", "Meblağ û diravê qeydê bi kurê tê guhertin; meblağa destpêkê û kur wek agahî dimînin.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tx(language, "Kapat", "Close", "Bigire")}>×</button>
        </div>
        <dl className="debtMarkFacts">
          <dt>{tx(language, "Kasa", "Cash account", "Qase")}</dt><dd>{localizeData(x.cashAccount, language)}</dd>
          <dt>{tx(language, "Tarih", "Date", "Tarîx")}</dt><dd>{date(x.date, language)}</dd>
          <dt>{tx(language, "Ana Başlık", "Main Category", "Sernavê Sereke")}</dt><dd>{localizeData(x.source, language) || "—"}</dd>
          <dt>{tx(language, "Tutar", "Amount", "Meblağ")}</dt><dd className={x.kind === "expense" ? "negative" : "positive"}>{money(x.amount, x.currency)}</dd>
          {converted && (
            <>
              <dt>{tx(language, "İlk tutar", "Original amount", "Meblağa destpêkê")}</dt><dd>{money(x.originalAmount ?? 0, x.originalCurrency!)}</dd>
              {x.fxRate != null && <><dt>{tx(language, "Kullanılan kur", "Rate used", "Kurê bikaranî")}</dt><dd>{fxRateLabel(x.originalCurrency!, x.currency, x.fxRate)}</dd></>}
            </>
          )}
        </dl>
        {!converted && (
          <div className="formGrid">
            <label>
              {tx(language, "Çevrilecek para birimi", "Convert to", "Bike")}
              <select value={to} onChange={(e) => { setTo(e.target.value); setRate(null); }}>
                {FX_CURRENCIES.filter((c) => c !== x.currency).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="fxResult">
              {ok ? <>{money(x.amount, x.currency)} → <b>{money(result, to)}</b></> : tx(language, "Kuru girin.", "Enter the rate.", "Kurê binivîsin.")}
            </div>
            <RateField language={language} from={x.currency} to={to} rate={rate} setRate={setRate} suggested={suggested} />
          </div>
        )}
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>{tx(language, "Vazgeç", "Cancel", "Betal")}</button>
          {converted ? (
            <button type="button" className="primary" disabled={busy} onClick={() => submit(true)}>
              {tx(language, "Çevirmeyi geri al", "Undo conversion", "Guhertinê betal bike")} ({money(x.originalAmount ?? 0, x.originalCurrency!)})
            </button>
          ) : (
            <button type="button" className="primary" disabled={!ok || result <= 0 || busy} onClick={() => submit()}>{title}</button>
          )}
        </div>
      </div>
    </div>
  );
}
