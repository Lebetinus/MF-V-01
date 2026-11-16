import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { clearViewCookieHeader, createViewSession, destroyViewSession, getViewToken, requireSuperAdmin, viewCookieHeader } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";

// Ayarlar > Kullanıcılar > "Kullanıcı gözüyle gör": süper admin, seçtiği kullanıcının
// uygulamayı nasıl gördüğünü SALT OKUNUR olarak gezer. Görünüm oturumu iz bırakmaz:
// kullanıcı çevrimiçi görünmez, okundu işaretleri ve işlem günlüğü değişmez (değiştiren
// her istek requireSession'da reddedilir). Denetim için yalnız sunucu günlüğüne yazılır.
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSuperAdmin(request);
  if ("response" in session) return session.response;

  let body: { userId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const userId = Number(body.userId);
  if (!Number.isInteger(userId) || userId <= 0) return json({ error: "Kullanıcı seçin" }, { status: 400 });
  if (userId === session.user.id) return json({ error: "Kendi hesabınızı zaten görüyorsunuz" }, { status: 400 });

  const [target] = await getDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const { token, expiresAt } = await createViewSession(session.user.id, target.id);
  console.info(`[view-as] ${session.user.username} (#${session.user.id}) views the app as user #${target.id}`);
  return json({ ok: true, name: target.name }, { headers: { "Set-Cookie": viewCookieHeader(token, expiresAt) } });
});

// Görünümden çıkış: yalnız bu tarayıcının görünüm oturumunu kapatır (salt okunur modda da çalışır).
export const DELETE = withErrorHandling(async (request: Request) => {
  const token = getViewToken(request);
  if (token) await destroyViewSession(token);
  return json({ ok: true }, { headers: { "Set-Cookie": clearViewCookieHeader() } });
});
