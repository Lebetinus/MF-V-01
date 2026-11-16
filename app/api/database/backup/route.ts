import { requireSuperAdmin } from "../../_lib/auth";
import { logActivity } from "../../_lib/activity";
import { createBackup } from "../../_lib/backup";
import { requireCurrentPassword } from "../../_lib/confirm-password";
import { withErrorHandling } from "../../_lib/http";

// Tam veritabanı yedeğini (.json.gz) indirir. Yedekte kullanıcı hesapları ve
// şifre özetleri de bulunduğu için yalnız süper admin alabilir ve şifresi
// sunucuda yeniden doğrulanır (body: { password }).
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

  const backup = await createBackup();
  const stamp = backup.exportedAt.slice(0, 16).replace("T", "-").replace(":", "");
  await logActivity(session.user, { category: "other", action: "backup", summary: `Veritabanı yedeği indirildi (${backup.tables} tablo)` });
  return new Response(new Uint8Array(backup.body), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="mfv01-yedek-${stamp}.json.gz"`,
      "Cache-Control": "private, no-store",
    },
  });
});
