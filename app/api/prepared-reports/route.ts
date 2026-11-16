import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { preparedReports } from "../../../db/schema";
import { requirePermission } from "../_lib/auth";
import { json, withErrorHandling } from "../_lib/http";
import { parseBody, preparedReportInputSchema } from "../_lib/validate";
import { reportKasaFilter } from "../_lib/reports";

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requirePermission(request, "reportBuilder");
  if ("response" in session) return session.response;

  const db = getDb();
  const [rows, visible] = await Promise.all([
    db.select().from(preparedReports).orderBy(desc(preparedReports.createdAt)),
    reportKasaFilter(session.user, db),
  ]);
  return json({ preparedReports: rows.filter((row) => visible(row.cashAccount)) });
});

import { logActivity } from "../_lib/activity";

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requirePermission(request, "reportBuilder");
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, preparedReportInputSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;
  const id = payload.id?.trim() || crypto.randomUUID();

  const db = getDb();
  if (!(await reportKasaFilter(session.user, db))(payload.cashAccount)) {
    return json({ error: "Bu kasa için rapor hazırlama yetkiniz yok" }, { status: 403 });
  }
  const [report] = await db
    .insert(preparedReports)
    .values({
      id,
      date: payload.date,
      title: payload.title,
      detail: payload.detail,
      presentedTo: payload.presentedTo,
      cashAccount: payload.cashAccount,
      signature: payload.signature,
      income: payload.income,
      expense: payload.expense,
    })
    .returning();

  await logActivity(session.user, { category: "report", action: "create", summary: `Rapor hazırlandı: ${report.title}`, kasa: report.cashAccount ?? "" });
  return json({ preparedReport: report }, { status: 201 });
});
