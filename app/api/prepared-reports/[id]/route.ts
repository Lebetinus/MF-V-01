import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { preparedReports } from "../../../../db/schema";
import { requirePermission } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";
import { parseBody, preparedReportInputSchema } from "../../_lib/validate";
import { reportKasaFilter } from "../../_lib/reports";

export const PUT = withErrorHandling<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const session = await requirePermission(request, "reportBuilder");
  if ("response" in session) return session.response;

  const { id } = await params;

  const parsed = await parseBody(request, preparedReportInputSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;

  const db = getDb();
  const visible = await reportKasaFilter(session.user, db);
  const [existing] = await db.select({ cashAccount: preparedReports.cashAccount }).from(preparedReports).where(eq(preparedReports.id, id)).limit(1);
  // Görünmeyen rapor için de 404: varlığı sızdırılmaz.
  if (!existing || !visible(existing.cashAccount)) return json({ error: "Report not found" }, { status: 404 });
  if (!visible(payload.cashAccount)) return json({ error: "Bu kasa için rapor hazırlama yetkiniz yok" }, { status: 403 });

  const [report] = await db
    .update(preparedReports)
    .set({
      date: payload.date,
      title: payload.title,
      detail: payload.detail,
      presentedTo: payload.presentedTo,
      cashAccount: payload.cashAccount,
      signature: payload.signature,
      income: payload.income,
      expense: payload.expense,
    })
    .where(eq(preparedReports.id, id))
    .returning();

  if (!report) return json({ error: "Report not found" }, { status: 404 });
  return json({ preparedReport: report });
});

import { deleteReason, logActivity, withReason } from "../../_lib/activity";

export const DELETE = withErrorHandling<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const session = await requirePermission(request, "reportBuilder");
  if ("response" in session) return session.response;

  const { id } = await params;
  const db = getDb();
  const visible = await reportKasaFilter(session.user, db);
  const [existing] = await db.select({ cashAccount: preparedReports.cashAccount }).from(preparedReports).where(eq(preparedReports.id, id)).limit(1);
  if (!existing || !visible(existing.cashAccount)) return json({ error: "Report not found" }, { status: 404 });
  await db.delete(preparedReports).where(eq(preparedReports.id, id));
  await logActivity(session.user, { category: "report", action: "delete", summary: withReason("Hazırlanmış rapor silindi", deleteReason(request)) });
  return json({ ok: true });
});
