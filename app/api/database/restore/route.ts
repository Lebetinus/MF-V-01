import { requireSuperAdmin } from "../../_lib/auth";
import { BackupError, restoreBackup } from "../../_lib/backup";
import { requireCurrentPassword } from "../../_lib/confirm-password";
import { json, withErrorHandling } from "../../_lib/http";

// Ayarlar > Veri: tam veritabanı yedeğini geri yükler (multipart: password + file).
// Mevcut TÜM verinin yerine geçer ve herkesin oturumunu kapatır, bu yüzden
// yalnız süper admin ve sunucuda yeniden doğrulanan şifreyle çalışır.
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSuperAdmin(request);
  if ("response" in session) return session.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Yedek dosyası gönderilemedi", code: "bad_request" }, { status: 400 });
  }
  const denied = await requireCurrentPassword(session.user.id, form.get("password"));
  if (denied) return denied;

  const file = form.get("file");
  if (!file || typeof file === "string" || file.size === 0) {
    return json({ error: "Bir yedek dosyası seçin", code: "file_required" }, { status: 400 });
  }

  try {
    const result = await restoreBackup(Buffer.from(await file.arrayBuffer()), session.user);
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof BackupError) return json({ error: error.message, code: error.code }, { status: 400 });
    throw error;
  }
});
