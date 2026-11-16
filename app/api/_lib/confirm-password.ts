import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";
import { verifyPassword } from "../../../db/passwords";
import { json } from "./http";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "./rate-limit";

// Toplu/geri alınamaz işlemler (veritabanını içe aktarma veya silme) için
// kullanıcının şifresini SUNUCUDA yeniden doğrular. İstemcideki onay
// penceresi tek başına güvence değildir: API doğrudan da çağrılabilir.
// /api/auth/verify-password ile aynı hız sınırı anahtarını paylaşır.
export async function requireCurrentPassword(userId: number, password: unknown): Promise<Response | null> {
  const key = `verify-password:${userId}`;
  const retryAfter = isRateLimited(key);
  if (retryAfter !== null) {
    return json(
      { error: "Çok fazla hatalı deneme. Daha sonra tekrar deneyin.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  if (typeof password !== "string" || !password) {
    return json({ error: "Bu işlem için şifrenizi girin", code: "password_required" }, { status: 400 });
  }
  const db = getDb();
  const [account] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    recordFailedAttempt(key);
    return json({ error: "Şifre hatalı", code: "wrong_password" }, { status: 403 });
  }
  clearAttempts(key);
  return null;
}
