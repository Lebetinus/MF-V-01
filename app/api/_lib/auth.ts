import { and, desc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { sessions, users } from "../../../db/schema";
import type { Page } from "./types";

const COOKIE_NAME = "mfv01_session";
// "Kullanıcı gözüyle gör" görünüm oturumunun çerezi. Yalnız süper adminin kendi
// (normal) oturum çerezi de geçerliyken işe yarar; tek başına hiçbir şey açmaz.
const VIEW_COOKIE_NAME = "mfv01_view";
const VIEW_TTL_HOURS = 2;
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
const SECURE = process.env.SESSION_COOKIE_SECURE !== "false";
// Caps session rows per user (a stolen/never-logged-out token has a natural
// expiry via TTL, but nothing else was bounding how many could pile up).
const MAX_SESSIONS_PER_USER = 10;

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  roleLabel: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  permissions: Page[];
  avatar: string;
  language: string;
  dashboardIncludedUserIds: number[];
  // Süper adminin "kullanıcı gözüyle" salt okunur görünümü: true iken hiçbir değişiklik yapılamaz.
  readOnly: boolean;
  // Görünümü açan süper adminin adı (yalnız görünüm modunda).
  viewerName: string | null;
};

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

export function getSessionToken(request: Request): string | null {
  return parseCookies(request.headers.get("cookie")) [COOKIE_NAME] ?? null;
}

export function getViewToken(request: Request): string | null {
  return parseCookies(request.headers.get("cookie"))[VIEW_COOKIE_NAME] ?? null;
}

export function viewCookieHeader(token: string, expiresAt: Date): string {
  const parts = [`${VIEW_COOKIE_NAME}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Expires=${expiresAt.toUTCString()}`];
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

export function clearViewCookieHeader(): string {
  const parts = [`${VIEW_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

// Süper admin için, seçilen kullanıcı adına salt okunur görünüm oturumu açar.
// lastSeenAt geçmişe yazılır ve onlineUserIds bu oturumları saymaz: kullanıcı
// "çevrimiçi" görünmez. createSession'ın oturum sınırı da bunları saymaz, yani
// kullanıcının gerçek oturumlarından hiçbiri kapanmaz.
export async function createViewSession(viewerUserId: number, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const db = getDb();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + VIEW_TTL_HOURS * 60 * 60 * 1000);
  await db.delete(sessions).where(and(eq(sessions.viewerUserId, viewerUserId), lt(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({ id: token, userId, viewerUserId, expiresAt, lastSeenAt: new Date(0) });
  return { token, expiresAt };
}

export async function destroyViewSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(and(eq(sessions.id, token), gt(sessions.viewerUserId, 0)));
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const db = getDb();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: token, userId, expiresAt });

  // Opportunistic cleanup on the path that actually grows the table: drop
  // this user's already-expired sessions, then trim down to the N most
  // recent if logins have piled up beyond that.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  const remaining = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.viewerUserId)))
    .orderBy(desc(sessions.createdAt));
  if (remaining.length > MAX_SESSIONS_PER_USER) {
    const staleIds = remaining.slice(MAX_SESSIONS_PER_USER).map((row) => row.id);
    await db.delete(sessions).where(inArray(sessions.id, staleIds));
  }

  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, token));
}

// Invalidates every other session for this user (e.g. after a password
// change) so a stolen/leftover token elsewhere stops working immediately.
export async function destroyOtherSessions(userId: number, exceptToken: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, exceptToken)));
}

function toSessionUser(user: typeof users.$inferSelect): SessionUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleLabel: user.roleLabel,
    isAdmin: user.isAdmin,
    isSuperAdmin: user.isSuperAdmin,
    permissions: (user.permissions as Page[]) ?? [],
    avatar: user.avatar,
    language: user.language,
    dashboardIncludedUserIds: (user.dashboardIncludedUserIds as number[]) ?? [],
    readOnly: false,
    viewerName: null,
  };
}

// Bumping lastSeenAt on every request would mean an UPDATE per API call —
// throttled to once per ~30s per session instead, which is still frequent
// enough to keep the online dot accurate against the client's 45s poll
// (see refreshUnreadCommentsCount's interval in app/page.tsx) without
// meaningfully adding write load to the hot request path. Fire-and-forget:
// this must never slow down or fail the request it's riding on.
const PRESENCE_BUMP_THROTTLE_MS = 30_000;
function bumpLastSeen(db: ReturnType<typeof getDb>, token: string): void {
  db.update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(sessions.id, token), lt(sessions.lastSeenAt, new Date(Date.now() - PRESENCE_BUMP_THROTTLE_MS))))
    .catch(() => {});
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    // Yalnız normal oturumlar: bir görünüm tokenı ana çereze konsa bile oturum açmaz.
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date()), isNull(sessions.viewerUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  bumpLastSeen(db, token);
  const real = toSessionUser(row.user);

  // Süper admin bir kullanıcının gözüyle bakıyorsa istek o kullanıcı olarak, salt okunur yürür.
  // Görünüm oturumu bu süper admine ait olmalı; görüntülenen kullanıcının lastSeenAt'i dokunulmaz.
  const viewToken = getViewToken(request);
  if (viewToken && real.isSuperAdmin) {
    const [view] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, viewToken), eq(sessions.viewerUserId, real.id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (view) return { ...toSessionUser(view.user), readOnly: true, viewerName: real.name };
  }
  return real;
}

// "Online" = at least one session last seen within this window. Generous
// enough to survive a couple of missed 45s polls without flickering offline.
const ONLINE_WINDOW_MS = 120_000;
export async function onlineUserIds(db: ReturnType<typeof getDb> = getDb()): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: sessions.userId })
    .from(sessions)
    .where(and(gt(sessions.lastSeenAt, new Date(Date.now() - ONLINE_WINDOW_MS)), isNull(sessions.viewerUserId)));
  return rows.map((r) => r.userId);
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireSession(request: Request): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getSessionUser(request);
  if (!user) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  // Salt okunur görünüm: veri değiştiren her istek burada durur. Tüm korumalı uçlar
  // (requireAdmin/requireSuperAdmin/requirePermission dahil) bu fonksiyondan geçer.
  if (user.readOnly && !READ_METHODS.has(request.method)) {
    return { response: Response.json({ error: "Salt okunur görünümde değişiklik yapılamaz.", code: "read_only" }, { status: 403 }) };
  }
  return { user };
}

export async function requireAdmin(request: Request): Promise<{ user: SessionUser } | { response: Response }> {
  const result = await requireSession(request);
  if ("response" in result) return result;
  if (!result.user.isAdmin) return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return result;
}

// Kasa erişim atamaları (Ayarlar > Kasa Erişimi) ve süper admin rolünün
// verilmesi/alınması yalnız süper adminlere açık — sıradan bir admin bile
// bunu yapamaz (bkz. proje sahibinin kararı: "süper admin tüm verilere
// erişebilir, ancak ... hangi kasaları görebileceğini belirleyebilmeliyiz").
export async function requireSuperAdmin(request: Request): Promise<{ user: SessionUser } | { response: Response }> {
  const result = await requireSession(request);
  if ("response" in result) return result;
  if (!result.user.isSuperAdmin) return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return result;
}

// Admins implicitly have every page's access; non-admins need the page in
// their `permissions` list. Mirrors the client-side `canAccess` gate in
// app/page.tsx, but this is the copy that actually matters — the client
// check only hides menu items, it can't stop a direct API request.
export async function requirePermission(request: Request, page: Page): Promise<{ user: SessionUser } | { response: Response }> {
  const result = await requireSession(request);
  if ("response" in result) return result;
  if (result.user.isAdmin || result.user.permissions.includes(page)) return result;
  return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
}
