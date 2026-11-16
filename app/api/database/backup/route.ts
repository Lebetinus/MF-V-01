import { createHash, timingSafeEqual } from "node:crypto";
import { requireSuperAdmin } from "../../_lib/auth";
import { logActivity } from "../../_lib/activity";
import { createBackup } from "../../_lib/backup";
import { requireCurrentPassword } from "../../_lib/confirm-password";
import { json, withErrorHandling } from "../../_lib/http";
import { clearAttempts, getClientIp, isRateLimited, recordFailedAttempt } from "../../_lib/rate-limit";

// Tam veritabanı yedeğini (.json.gz) indirir. Yedekte kullanıcı hesapları ve
// şifre özetleri de bulunduğu için iki yoldan biri gerekir:
//  1. Oturum açmış süper admin + sunucuda yeniden doğrulanan şifre (body: { password }) — Ayarlar ekranı.
//  2. "Authorization: Bearer <BACKUP_TOKEN>" — otomatik günlük yedek görevi için. Token yalnız
//     sunucuda BACKUP_TOKEN ortam değişkeni (en az 32 karakter) tanımlıysa geçerlidir ve
//     yalnız bu ucu açar; başka hiçbir işleme yetki vermez.
const MIN_TOKEN_LENGTH = 32;

function tokenMatches(given: string): boolean {
  const expected = process.env.BACKUP_TOKEN ?? "";
  if (expected.length < MIN_TOKEN_LENGTH) return false;
  // Sabit uzunluklu özetler karşılaştırılır: süre, tokenın ne kadarının doğru olduğunu sızdırmaz.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function backupResponse(actor: { id: number; name: string }, via: string): Promise<Response> {
  const backup = await createBackup();
  const stamp = backup.exportedAt.slice(0, 16).replace("T", "-").replace(":", "");
  await logActivity(actor, { category: "other", action: "backup", summary: `Veritabanı yedeği indirildi (${backup.tables} tablo, ${via})` });
  return new Response(new Uint8Array(backup.body), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      // İstemcideki ilerleme yüzdesi için (proxy Content-Length'i kaldırabilir).
      "X-Backup-Size": String(backup.body.length),
      "Content-Disposition": `attachment; filename="mfv01-yedek-${stamp}.json.gz"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const POST = withErrorHandling(async (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    const key = `backup-token:${getClientIp(request)}`;
    const retryAfter = isRateLimited(key);
    if (retryAfter !== null) {
      return json({ error: "Çok fazla hatalı deneme" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    if (!tokenMatches(authorization.slice("Bearer ".length).trim())) {
      recordFailedAttempt(key);
      return json({ error: "Geçersiz yedek anahtarı" }, { status: 401 });
    }
    clearAttempts(key);
    return backupResponse({ id: 0, name: "Otomatik yedek" }, "otomatik görev");
  }

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

  return backupResponse(session.user, "Ayarlar");
});
