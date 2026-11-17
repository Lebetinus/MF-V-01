"use client";

import { tx, localizeData } from "../../lib/i18n";
import { combineByCurrency, moneyBreakdown } from "../../lib/finance";
import { isDebtLeg } from "../../lib/debts";
import type { CashAccountSummary, KasaSection, Language, RecordItem } from "../../lib/types";
import type { AccessKasa } from "../WorkspaceAccess";
import type { CardGroup } from "./useKasaSummaries";

// Kasa kartlarının ve kart düğmelerinin Records'tan aldığı durum ve geri çağrılar.
export type KasaCardContext = {
  language: Language;
  readOnly: boolean;
  isSuperAdmin: boolean;
  cashAccounts: CashAccountSummary[];
  allRecords: RecordItem[];
  source: string;
  setSource: (name: string) => void;
  setActiveKasa: (name: string) => void;
  setShareTarget: (account: CashAccountSummary) => void;
  setKasaEditTarget: (account: CashAccountSummary) => void;
  setKasaMoveTarget: (account: CashAccountSummary) => void;
  setKasaDeleteTarget: (account: CashAccountSummary) => void;
  setAccessTarget: (target: { title: string; kasas: AccessKasa[]; section?: KasaSection }) => void;
  // "Kasalar arası aktarım" penceresi (bkz. records/KasaTransfer.tsx).
  setTransferTarget: (account: CashAccountSummary) => void;
};

// Seçili kasa kartında "Kasayı Düzenle" ve "Kasayı Sil" (şifreli onay) düğmeleri.
export function renderKasaActions(name: string, selected: boolean, c: KasaCardContext) {
  const { language, readOnly, isSuperAdmin, cashAccounts, setKasaEditTarget, setAccessTarget, setKasaMoveTarget, setKasaDeleteTarget } = c;
  if (!selected || readOnly) return null;
  const account = cashAccounts.find((a) => a.name === name);
  if (!account) return null;
  return (
    <span className="kasaActions">
      <button type="button" title={tx(language, "Kasayı Düzenle", "Edit Cash Account", "Qaseyê Biguherîne")} aria-label={tx(language, "Kasayı Düzenle", "Edit Cash Account", "Qaseyê Biguherîne")} onClick={() => setKasaEditTarget(account)}>✎</button>
      {isSuperAdmin && (
        <button type="button" title={tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")} aria-label={tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")} onClick={() => setAccessTarget({ title: `${account.name} — ${tx(language, "Kimler görebilir?", "Who can see it?", "Kî dikare bibîne?")}`, kasas: [{ id: account.id, name: account.name, ownerUserId: account.ownerUserId }] })}>👁</button>
      )}
      <button type="button" title={tx(language, "Çalışma alanına taşı", "Move to workspace", "Bibe qada xebatê")} aria-label={tx(language, "Çalışma alanına taşı", "Move to workspace", "Bibe qada xebatê")} onClick={() => setKasaMoveTarget(account)}>⇄</button>
      <button type="button" className="danger" title={tx(language, "Kasayı Sil", "Delete Cash Account", "Qaseyê Jê Bibe")} aria-label={tx(language, "Kasayı Sil", "Delete Cash Account", "Qaseyê Jê Bibe")} onClick={() => setKasaDeleteTarget(account)}>🗑</button>
    </span>
  );
}

// Kasa kartının üzerine gelince: kasanın aylık gelir / gider / sonuç özeti (son 3 ay).
export function monthlyOfKasa(name: string, allRecords: RecordItem[]) {
  const byMonth = new Map<string, RecordItem[]>();
  for (const x of allRecords) {
    if ((x.kind !== "income" && x.kind !== "expense") || x.cashAccount !== name) continue;
    const key = x.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), x]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([month, rows]) => {
      const inc = rows.filter((x) => x.kind === "income");
      const exp = rows.filter((x) => x.kind === "expense");
      // Gelir/gider: borç veren tarafın borç kayıtları (lent/collected) hariç; sonuç: bakiyedeki değişim (hepsi dahil).
      return { month, inc: combineByCurrency([{ rows: inc.filter((x) => !isDebtLeg(x)) }]), exp: combineByCurrency([{ rows: exp.filter((x) => !isDebtLeg(x)) }]), res: combineByCurrency([{ rows: inc }, { rows: exp, sign: -1 }]) };
    });
}

export function renderGroupTooltip(g: CardGroup, matchingAccount: CashAccountSummary | undefined, language: Language, allRecords: RecordItem[]) {
  return (
    <div className="groupCardTooltip">
      {g.kind === "kasa" ? (
        <>
          <div>
            <small>{tx(language, "Kasa Oluşturucu", "Kasa Owner", "Vekera Qaseyê")}</small>
            <strong>{matchingAccount?.ownerName || tx(language, "Belirtilmedi", "Unassigned", "Nehatiye diyarkirin")}</strong>
          </div>
          <div>
            <small>{tx(language, "Toplam Giriş", "Total In", "Têketina Giştî")}</small>
            <strong>{moneyBreakdown(g.totalInByCurrency)}</strong>
          </div>
          <div>
            <small>{tx(language, "Gider", "Expense", "Mesref")}</small>
            <strong className="negative">{moneyBreakdown(g.totalOutByCurrency)}</strong>
          </div>
          <div>
            <small>{tx(language, "Sonuç", "Result", "Encam")}</small>
            <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
          </div>
          {monthlyOfKasa(g.name, allRecords).length > 0 && (
            <table className="tooltipMonths">
              <thead>
                <tr>
                  <th>{tx(language, "Ay", "Month", "Meh")}</th>
                  <th>{tx(language, "Gelir", "Income", "Dahat")}</th>
                  <th>{tx(language, "Gider", "Expense", "Mesref")}</th>
                  <th>{tx(language, "Sonuç", "Result", "Encam")}</th>
                </tr>
              </thead>
              <tbody>
                {monthlyOfKasa(g.name, allRecords).map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="in">{moneyBreakdown(m.inc)}</td>
                    <td className="negative">{moneyBreakdown(m.exp)}</td>
                    <td>{moneyBreakdown(m.res)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <div>
            <small>
              {g.kind === "income"
                ? tx(language, "Toplam Gelir", "Total Income", "Dahata Giştî")
                : tx(language, "Toplam Gider", "Total Expense", "Mesrefa Giştî")}
            </small>
            <strong className={g.kind === "expense" ? "negative" : ""}>
              {moneyBreakdown(g.totalByCurrency)}
            </strong>
          </div>
          <div>
            <small>{tx(language, "Kayıt Sayısı", "Record Count", "Hejmara Qeydan")}</small>
            <strong>{g.count}</strong>
          </div>
        </>
      )}
    </div>
  );
}

// Kart satırı flex-wrap olduğu için genişlik yeterliyse zaten hepsi
// görünür — önceden ilk 4'ten sonrasını "Diğer Kasalar" açılır menüsünde
// gizliyorduk, ekran dar olmasa bile. Artık tüm kartlar render ediliyor;
// dar ekranda tarayıcı bunları kendiliğinden alt satıra sarar.
export function renderKasaCard(g: CardGroup, tone: { background: string; borderColor: string } | undefined, c: KasaCardContext) {
  const { language, readOnly, isSuperAdmin, cashAccounts, allRecords, source, setSource, setActiveKasa, setShareTarget, setTransferTarget } = c;
  const matchingAccount = cashAccounts.find((a) => a.name === g.name);
  return (
    <div className="groupCard" key={g.name}>
      <button
        className={source === g.name ? "selected" : ""}
        style={tone}
        onClick={() => {
          // Çalışma alanı açık kalır: diğer kasalar arasında geçiş yapılabilsin.
          setSource(g.name);
          setActiveKasa("");
        }}
      >
        <b>{localizeData(g.name, language)} <span className="groupCount">({g.count})</span></b>
        <strong>{moneyBreakdown(g.totalByCurrency)}</strong>
        <span className="groupInOut">
          <span className="in">↗ {moneyBreakdown(g.totalInByCurrency)}</span>
          <span className="out">↘ {moneyBreakdown(g.totalOutByCurrency)}</span>
        </span>
      </button>
      {!readOnly && source === g.name && matchingAccount && (matchingAccount.isOwner || isSuperAdmin) && (
        <button
          className="cashEditIcon"
          title={tx(language, "Kasalar arası aktarım", "Transfer to another cash account", "Veguhastin bo qaseyeke din")}
          aria-label={tx(language, "Kasalar arası aktarım", "Transfer to another cash account", "Veguhastin bo qaseyeke din")}
          onClick={() => setTransferTarget(matchingAccount)}
        >
          ⇄
        </button>
      )}
      {!readOnly && source === g.name && matchingAccount && (matchingAccount.isOwner || isSuperAdmin) && (
        <button
          className="cashEditIcon"
          title={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
          aria-label={tx(language, "Kasayı Paylaş", "Share Kasa", "Qaseyê Parve Bike")}
          onClick={() => setShareTarget(matchingAccount)}
        >
          🔗
        </button>
      )}
      {renderKasaActions(g.name, source === g.name, c)}
      {renderGroupTooltip(g, matchingAccount, language, allRecords)}
    </div>
  );
}
