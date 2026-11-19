"use client";

import { TableTools } from "./TableTools";
import { Fragment, useMemo, useState } from "react";
import { Title } from "./shared";
import { localizeData, tx } from "../lib/i18n";
import { date, money, moneyBreakdown } from "../lib/finance";
import { debtPairs, type DebtPair } from "../lib/debts";
import type { CashAccountSummary, Language, RecordItem } from "../lib/types";
import { DebtModal, type DebtModalMode } from "./DebtModal";

const isLenderLeg = (x: RecordItem) => x.debtRole === "lent" || x.debtRole === "collected";

// Bir çiftin hareketleri işlem başına bir satır: iki taraf da görünüyorsa ikiz kayıtlar tek işlem olarak gösterilir.
function operationsOf(p: DebtPair) {
  const seen = new Set<number>();
  const ops: { id: number; date: string; lend: boolean; amount: number; currency: string; text: string; note: string; person: string }[] = [];
  for (const x of p.movements) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.debtLinkId != null) seen.add(x.debtLinkId);
    ops.push({
      id: x.id,
      date: x.date,
      lend: x.debtRole === "lent" || x.debtRole === "borrowed",
      amount: x.amount,
      currency: x.currency,
      text: x.detail || x.source,
      note: x.note,
      // Kasalar arası borçta "Kişi" karşı kasanın adıdır; yalnız sistem dışı borçta parayı alan / ödeyen kişidir.
      person: p.external ? x.person : "",
    });
  }
  return ops;
}

// Borç Detay: kasalar arası borçların (borçlu → alacaklı, para birimi) özeti. Buradan borç verilir ve açık borçlara
// ödeme yapılır (DebtModal); her işlem iki kasaya birlikte yazılır (bkz. app/lib/debts.ts).
export function DebtDetail({
  records,
  language,
  cashAccounts,
  isSuperAdmin = false,
  readOnly = false,
  onChanged,
}: {
  records: RecordItem[];
  language: Language;
  cashAccounts: CashAccountSummary[];
  isSuperAdmin?: boolean;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const pairs = useMemo(() => debtPairs(records), [records]);
  const [showClosed, setShowClosed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: DebtModalMode; kasaId?: number; creditorId?: number; pairKey?: string } | null>(null);
  const shown = pairs.filter((p) => showClosed || p.outstanding > 0.004);
  const writableIds = new Set(cashAccounts.filter((a) => a.isOwner || isSuperAdmin).map((a) => a.id));
  // Üstteki toplamlar: alacak = borç veren tarafı görünen çiftlerin kalanı, borç = borç alan tarafı görünenlerin.
  const totals = useMemo(() => {
    const receivable: Record<string, number> = {};
    const payable: Record<string, number> = {};
    for (const p of pairs) {
      if (p.outstanding <= 0.004) continue;
      if (p.movements.some(isLenderLeg)) receivable[p.currency] = (receivable[p.currency] ?? 0) + p.outstanding;
      if (p.movements.some((x) => !isLenderLeg(x))) payable[p.currency] = (payable[p.currency] ?? 0) + p.outstanding;
    }
    return { receivable, payable };
  }, [pairs]);

  return (
    <div className="panel debtDetail">
      <div className="debtDetailHead">
        <Title
          title={tx(language, "Borç Detay", "Debt Details", "Hûrguliyên Deynê")}
          sub={tx(language, "Kasalara ve sistem dışı kasalara / projelere verilen borçlar, geri ödemeler ve kalan borçlar.", "Debts lent to cash accounts and to kasas / projects outside the system, repayments and what remains.", "Deynên ku dane qaseyan û qase / projeyên derveyî sîstemê, dravdan û deynê mayî.")}
        />
        {!readOnly && (
          <button type="button" className="primary" onClick={() => setModal({ mode: "lend" })}>
            ＋ {tx(language, "Borç ver", "Lend", "Deyn bide")}
          </button>
        )}
      </div>
      <div className="debtSummary">
        <div>
          <small>{tx(language, "Toplam alacak", "Total receivable", "Giştî deynê ku tê standin")}</small>
          <b className="debtSumReceivable">{Object.keys(totals.receivable).length ? moneyBreakdown(totals.receivable) : "—"}</b>
        </div>
        <div>
          <small>{tx(language, "Toplam borç", "Total debt", "Giştî deyn")}</small>
          <b>{Object.keys(totals.payable).length ? moneyBreakdown(totals.payable) : "—"}</b>
        </div>
        <label className="checkField"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{tx(language, "Kapanan borçları göster", "Show closed debts", "Deynên girtî nîşan bide")}</label>
      </div>
      {shown.length === 0 && <p className="debtEmpty">{tx(language, "Açık borç yok. “＋ Borç ver” ile bir kasadan başka bir kasaya ya da sistem dışı bir kasaya / projeye borç verebilirsiniz; kasa sayfasındaki bir gideri de ⇄ ile borca çevirebilirsiniz.", "No open debts. Use “＋ Lend” to lend from one cash account to another or to a kasa / project outside the system; an expense on a kasa page can be turned into a debt with ⇄.", "Deynê vekirî tune. Bi “＋ Deyn bide” deyn bide qaseyeke din an qase / projeyeke derveyî sîstemê; mesrefek di rûpela qaseyê de bi ⇄ dikare bibe deyn.")}</p>}
      {shown.length > 0 && (
        <TableTools id="debt-detail" language={language} className="debtTableWrap" resize={false}>
          <table className="lpTable debtTable">
            <thead>
              <tr>
                <th>{tx(language, "Tarih", "Date", "Dîrok")}</th>
                <th>{tx(language, "Borçlu kasa", "Debtor kasa", "Qaseya deyndar")}</th>
                <th>{tx(language, "Alacaklı kasa", "Creditor kasa", "Qaseya deyndêr")}</th>
                <th className="num">{tx(language, "Verilen", "Lent", "Hatî dayîn")}</th>
                <th className="num">{tx(language, "Geri alınan", "Collected", "Hatî vegerandin")}</th>
                <th className="num">{tx(language, "Kalan", "Remaining", "Mayî")}</th>
                <th>{tx(language, "Son ödeme", "Last payment", "Dravdana dawî")}</th>
                <th>{tx(language, "Durum", "Status", "Rewş")}</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const open = p.outstanding > 0.004;
                const dates = p.movements.map((x) => x.date).sort();
                const lastRepay = p.movements.filter((x) => x.debtRole === "repay" || x.debtRole === "collected").map((x) => x.date).sort().pop();
                const pct = p.given > 0 ? Math.min(100, Math.round((p.returned / p.given) * 100)) : 0;
                // Kasalar arası borcu borçlu kasa öder; sistem dışı borcun tahsilatını alacaklı kasa yazar.
                const canPay = !readOnly && open && writableIds.has(p.external ? p.creditorId : p.debtorId);
                return (
                  <Fragment key={p.key}>
                    <tr className="debtRow" onClick={() => setOpenKey(openKey === p.key ? null : p.key)}>
                      <td>{dates[0] ? date(dates[0], language) : "—"}</td>
                      <td>
                        <b>{localizeData(p.debtorName || "—", language)}</b>
                        {p.external && <span className="debtOutsideTag" title={tx(language, "Sistem dışı kasa / proje", "Kasa / project outside the system", "Qase / projeya derveyî sîstemê")}>{tx(language, "sistem dışı", "outside", "derveyî")}</span>}
                        {p.people.length > 0 && <small className="subNote debtPeople">👤 {p.people.join(", ")}</small>}
                      </td>
                      <td>{localizeData(p.creditorName || "—", language)}</td>
                      <td className="num">{money(p.given, p.currency)}</td>
                      <td className="num positive">{money(p.returned, p.currency)}</td>
                      <td className={`num${open ? " negative" : ""}`}>{money(p.outstanding, p.currency)}</td>
                      <td>{lastRepay ? date(lastRepay, language) : "—"}</td>
                      <td>
                        <span className={`lpBadge ${open ? "warn" : "ok"}`}>{open ? `${tx(language, "Açık", "Open", "Vekirî")} · %${pct}` : tx(language, "Kapandı", "Closed", "Girtî")}</span>
                      </td>
                      {!readOnly && (
                        <td>
                          {canPay && (
                            <button type="button" className="light compact" onClick={(e) => { e.stopPropagation(); setModal({ mode: "repay", kasaId: p.debtorId, creditorId: p.creditorId, pairKey: p.key }); }}>
                              {p.external ? tx(language, "Tahsil et", "Collect", "Bistîne") : tx(language, "Ödeme yap", "Make payment", "Dravdan bike")}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {openKey === p.key && (
                      <tr className="debtMoveRow">
                        <td colSpan={readOnly ? 8 : 9}>
                          <table className="debtMoves">
                            <thead>
                              <tr>
                                <th>{tx(language, "Tarih", "Date", "Dîrok")}</th>
                                <th>{tx(language, "İşlem", "Type", "Cure")}</th>
                                <th>{tx(language, "Yön", "Direction", "Alî")}</th>
                                <th>{tx(language, "Açıklama", "Description", "Ravekirin")}</th>
                                <th>{tx(language, "Kişi", "Person", "Kes")}</th>
                                <th className="num">{tx(language, "Tutar", "Amount", "Mîqdar")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {operationsOf(p).map((op) => (
                                <tr key={op.id}>
                                  <td>{date(op.date, language)}</td>
                                  <td>{op.lend ? tx(language, "Borç verildi", "Lent", "Deyn hat dayîn") : tx(language, "Geri ödeme", "Repayment", "Vegerandin")}</td>
                                  <td>
                                    {op.lend
                                      ? `${localizeData(p.creditorName || "—", language)} → ${localizeData(p.debtorName || "—", language)}`
                                      : `${localizeData(p.debtorName || "—", language)} → ${localizeData(p.creditorName || "—", language)}`}
                                  </td>
                                  <td>{localizeData(op.text || "—", language)}{op.note ? <small className="subNote"> · {op.note}</small> : null}</td>
                                  <td>{op.person ? localizeData(op.person, language) : "—"}</td>
                                  <td className={`num ${op.lend ? "negative" : "positive"}`}>{money(op.amount, op.currency)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableTools>
      )}
      {modal && (
        <DebtModal
          language={language}
          cashAccounts={cashAccounts}
          records={records}
          isSuperAdmin={isSuperAdmin}
          initialMode={modal.mode}
          kasaId={modal.kasaId}
          creditorId={modal.creditorId}
          pairKey={modal.pairKey}
          onDone={onChanged}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
