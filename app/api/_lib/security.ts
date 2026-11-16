import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { blockedIps, sessions, users } from "../../../db/schema";

// Otomatik IP engelleri ve hesap kilitleri artık süreli: kalıcı bir engel,
// saldırganın 5 yanlış denemeyle bir hesabı (süper admin dahil) veya bir
// IP'yi süresiz kilitlemesine izin veriyordu. Süre dolunca kendiliğinden
// kalkar; admin yine istediği an elle kaldırabilir.
export const IP_BLOCK_MINUTES = 60;
export const AUTO_LOCK_MINUTES = 15;

// The shared "unknown" bucket (no reverse proxy configured, see
// rate-limit.ts getClientIp) is never persisted as a block: blocking it
// would lock EVERY user out of login at once. Brute force through it is
// still slowed by the per-account limiter in the login route.
export async function isIpBlocked(ip: string): Promise<boolean> {
  if (!ip) return false;
  const db = getDb();
  const rows = await db.select().from(blockedIps).where(eq(blockedIps.ip, ip)).limit(1);
  const row = rows[0];
  if (!row) return false;
  if (row.createdAt && Date.now() - new Date(row.createdAt).getTime() > IP_BLOCK_MINUTES * 60_000) {
    await db.delete(blockedIps).where(eq(blockedIps.ip, ip));
    return false;
  }
  return true;
}

export async function blockIp(ip: string, reason: string): Promise<void> {
  if (!ip) return;
  const db = getDb();
  await db
    .insert(blockedIps)
    .values({ ip, reason })
    .onConflictDoUpdate({ target: blockedIps.ip, set: { reason, createdAt: new Date() } });
}

// Otomatik kilit (LOCK_REASON ile atılan) süresi dolduysa hesabı açar.
// Elle (başka bir nedenle) kilitlenmiş hesaplara dokunmaz.
export async function releaseExpiredAutoLock(
  account: { id: number; locked: boolean; lockedAt: Date | null; lockReason: string },
  autoLockReason: string,
): Promise<boolean> {
  if (!account.locked || account.lockReason !== autoLockReason || !account.lockedAt) return false;
  if (Date.now() - new Date(account.lockedAt).getTime() < AUTO_LOCK_MINUTES * 60_000) return false;
  await unlockUserAccount(account.id);
  return true;
}

export async function unblockIp(ip: string): Promise<void> {
  const db = getDb();
  await db.delete(blockedIps).where(eq(blockedIps.ip, ip));
}

export async function listBlockedIps() {
  const db = getDb();
  return db.select().from(blockedIps).orderBy(desc(blockedIps.createdAt));
}

export async function lockUserAccount(userId: number, reason: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ locked: true, lockedAt: new Date(), lockReason: reason })
    .where(eq(users.id, userId));
  // Kill any session the account already had open elsewhere.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function unlockUserAccount(userId: number): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ locked: false, lockedAt: null, lockReason: "" })
    .where(eq(users.id, userId));
}
