import { getDb } from "../../../../db";
import { requireSession } from "../../_lib/auth";
import { runDebtOperation, runPartyDebtOperation } from "../../_lib/debts";
import { json, withErrorHandling } from "../../_lib/http";
import { debtRepaySchema, parseBody } from "../../_lib/validate";

// POST /api/debts/repay — "Borç öde": borçlu kasada "repay" gider + alacaklı kasada "collected" gelir, tek işlemde
// ve birbirine bağlı. Tutar kalan borcu (alınan − ödenen, aynı para biriminde) aşamaz (bkz. app/api/_lib/debts.ts).
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  const parsed = await parseBody(request, debtRepaySchema);
  if ("response" in parsed) return parsed.response;
  const p = parsed.data;
  // Sistem dışı kasa / projeden tahsilat: alacaklı kasada tek "collected" gelir kaydı.
  if (p.debtorCashAccountId == null) {
    const result = await runPartyDebtOperation(
      session.user,
      "collect",
      { kasaId: p.creditorCashAccountId, party: p.debtorParty, person: p.person, amount: p.amount, currency: p.currency, date: p.date, note: p.note, detail: p.detail },
      getDb(),
    );
    return json(result.body, { status: result.status });
  }
  const result = await runDebtOperation(
    session.user,
    "repay",
    { fromId: p.debtorCashAccountId, toId: p.creditorCashAccountId, amount: p.amount, currency: p.currency, date: p.date, note: p.note, detail: p.detail },
    getDb(),
  );
  return json(result.body, { status: result.status });
});
