import { getDb } from "../../../../db";
import { archive, financeNotes, preparedReports, records } from "../../../../db/schema";
import { requireSuperAdmin } from "../../_lib/auth";
import { requireCurrentPassword } from "../../_lib/confirm-password";
import { json, withErrorHandling } from "../../_lib/http";

// Wipes records/archive/notes/prepared reports (not users/settings) for
// EVERY kasa, so it is limited to super admins, and the caller's password
// is re-verified here on the server (body: { password }) — a client-side
// confirm dialog alone can be skipped by calling the API directly.
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSuperAdmin(request);
  if ("response" in session) return session.response;

  let body: { password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const denied = await requireCurrentPassword(session.user.id, body.password);
  if (denied) return denied;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(records);
    await tx.delete(archive);
    await tx.delete(financeNotes);
    await tx.delete(preparedReports);
  });

  return json({ ok: true });
});
