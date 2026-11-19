import { getDb } from "../../../db";
import { requireSession } from "../_lib/auth";
import { runFxExchange } from "../_lib/fx";
import { json, withErrorHandling } from "../_lib/http";
import { fxExchangeSchema, parseBody } from "../_lib/validate";

// POST /api/fx — "Döviz bozdur": kasa içinde bir para biriminden ötekine geçiş; verilen birimde gider + alınan birimde
// gelir, tek işlemde ve birbirine bağlı (bkz. app/api/_lib/fx.ts).
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  const parsed = await parseBody(request, fxExchangeSchema);
  if ("response" in parsed) return parsed.response;
  const result = await runFxExchange(session.user, parsed.data, getDb());
  return json(result.body, { status: result.status });
});
