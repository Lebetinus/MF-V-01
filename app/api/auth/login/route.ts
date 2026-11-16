import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { verifyPassword } from "../../../../db/passwords";
import { clearViewCookieHeader, createSession, sessionCookieHeader } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";
import { clearAttempts, getClientIp, isRateLimited, recordFailedAttempt, UNKNOWN_IP } from "../../_lib/rate-limit";
import { AUTO_LOCK_MINUTES, blockIp, IP_BLOCK_MINUTES, isIpBlocked, lockUserAccount, releaseExpiredAutoLock } from "../../_lib/security";
import type { Page } from "../../_lib/types";
import { logActivity } from "../../_lib/activity";

const LOCK_REASON = "5 ardışık başarısız giriş denemesi";
const AUTO_LOCK_MESSAGE = `Hesabınız çok fazla hatalı deneme nedeniyle ${AUTO_LOCK_MINUTES} dakikalığına kilitlendi. Daha sonra tekrar deneyin veya yöneticinizle iletişime geçin.`;

export const POST = withErrorHandling(async (request: Request) => {
  const ip = getClientIp(request);
  if (await isIpBlocked(ip)) {
    return json(
      { error: "Bu IP adresinden erişim engellendi. Yöneticinizle iletişime geçin.", code: "ip_blocked" },
      { status: 403 },
    );
  }

  let payload: { username?: string; password?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  const username = payload.username?.trim() ?? "";
  const password = payload.password ?? "";
  if (!username || !password) {
    return json({ error: "Username and password are required" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  let account = rows[0];

  // Süresi dolan otomatik kilit kendiliğinden kalkar (bkz. security.ts).
  if (account && (await releaseExpiredAutoLock(account, LOCK_REASON))) {
    account = { ...account, locked: false, lockedAt: null, lockReason: "" };
  }

  if (account?.locked) {
    return json(
      {
        error: account.lockReason === LOCK_REASON ? AUTO_LOCK_MESSAGE : "Hesabınız yönetici tarafından kilitlendi. Yöneticinizle iletişime geçin.",
        code: "account_locked",
      },
      { status: 403 },
    );
  }

  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    // Tracked separately: the IP counter catches an attacker spraying many
    // usernames from one address, the account counter catches one account
    // being attacked from many/rotating addresses.
    const ipKey = `login-ip:${ip}`;
    const acctKey = `login-acct:${username.toLowerCase()}`;
    recordFailedAttempt(ipKey);
    recordFailedAttempt(acctKey);

    // Ortak "unknown" kovası (proxy ayarı yok) kalıcı engellenmez: bu,
    // herkesi aynı anda dışarıda bırakırdı. Hesap sayacı yine çalışır.
    const ipRetryAfter = isRateLimited(ipKey);
    if (ipRetryAfter !== null && ip !== UNKNOWN_IP) {
      await blockIp(ip, LOCK_REASON);
      return json(
        { error: `Bu IP adresinden çok fazla başarısız deneme yapıldı. ${IP_BLOCK_MINUTES} dakika sonra tekrar deneyin.`, code: "ip_blocked" },
        { status: 403 },
      );
    }
    if (account && isRateLimited(acctKey) !== null) {
      await lockUserAccount(account.id, LOCK_REASON);
      return json({ error: AUTO_LOCK_MESSAGE, code: "account_locked" }, { status: 403 });
    }
    if (ipRetryAfter !== null) {
      return json(
        { error: "Çok fazla başarısız deneme. Lütfen biraz sonra tekrar deneyin.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(ipRetryAfter) } },
      );
    }

    return json({ error: "Kullanıcı adı veya şifre hatalı" }, { status: 401 });
  }

  clearAttempts(`login-ip:${ip}`);
  clearAttempts(`login-acct:${username.toLowerCase()}`);

  const { token, expiresAt } = await createSession(account.id);
  await logActivity({ id: account.id, name: account.name }, { category: "auth", action: "login", summary: "Oturum açıldı" });

  return json(
    {
      profile: {
        name: account.name,
        username: account.username,
        role: account.roleLabel,
        isAdmin: account.isAdmin,
        isSuperAdmin: account.isSuperAdmin,
        permissions: (account.permissions as Page[]) ?? [],
        avatar: account.avatar,
        language: account.language,
        dashboardIncludedUserIds: (account.dashboardIncludedUserIds as number[]) ?? [],
      },
    },
    // Yeni girişte varsa eski "kullanıcı gözüyle" görünüm çerezi de silinir.
    { status: 200, headers: [["Set-Cookie", sessionCookieHeader(token, expiresAt)], ["Set-Cookie", clearViewCookieHeader()]] },
  );
});
