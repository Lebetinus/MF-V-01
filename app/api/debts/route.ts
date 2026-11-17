import { getDb } from "../../../db";
import { requireSession } from "../_lib/auth";
import { runDebtOperation } from "../_lib/debts";
import { json, withErrorHandling } from "../_lib/http";
import { debtLendSchema, parseBody } from "../_lib/validate";

// POST /api/debts — "Borç ver": borç veren kasada "lent" gider + borç alan kasada "borrowed" gelir, tek işlemde
// ve birbirine bağlı (bkz. app/api/_lib/debts.ts).
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  const parsed = await parseBody(request, debtLendSchema);
  if ("response" in parsed) return parsed.response;
  const p = parsed.data;
  const result = await runDebtOperation(
    session.user,
    "lend",
    { fromId: p.lenderCashAccountId, toId: p.borrowerCashAccountId, amount: p.amount, currency: p.currency, date: p.date, note: p.note, detail: p.detail },
    getDb(),
  );
  return json(result.body, { status: result.status });
});
