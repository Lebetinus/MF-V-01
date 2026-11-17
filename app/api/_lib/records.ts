import { eq } from "drizzle-orm";
import { getDb, type DbClient } from "../../../db";
import { and } from "drizzle-orm";
import { cashAccounts, kasaSections } from "../../../db/schema";
import { canAccessCashAccount, canCreateCashAccounts, canWriteCashAccount, grantCashAccountAccess } from "./cash-access";
import type { SessionUser } from "./auth";

export function fallbackKasaNameFor(kind: string): string {
  if (kind === "income") return "Diğer";
  if (kind === "expense") return "Diğer Giderler";
  return "";
}

function isFallbackKasaName(name: string): boolean {
  return name === fallbackKasaNameFor("income") || name === fallbackKasaNameFor("expense");
}

// Kasanın bağlanabileceği bir çalışma alanı / bölüm mü (kasa_sections, scope=cash)?
export async function isCashSection(id: number, db: DbClient = getDb()): Promise<boolean> {
  const rows = await db.select({ id: kasaSections.id }).from(kasaSections).where(and(eq(kasaSections.id, id), eq(kasaSections.scope, "cash"))).limit(1);
  return rows.length > 0;
}

export async function findCashAccountByName(name: string, db: DbClient) {
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.name, name)).limit(1);
  return rows[0] ?? null;
}

// Bir kasanın (cash_accounts satırı) açıldığı TEK yer: Yeni Kasa (POST
// /api/cash-accounts), "Diğer" yedek kasaları, aktarımda yeni hedef kasa,
// Excel aktarımı ve eski JSON içe aktarımı hep buradan geçer. Sahip ve
// `grantUserIds` kasayı hemen görür; çalışma alanı (kasa_sections, scope=cash)
// aynı anda yazılır. Alanı verilmeyen kasa (eski içe aktarım, "Diğer" yedek
// kasası) Kasalar sayfasında "Çalışma alanı yok" altında görünür ve taşınabilir. Kasa artık kendi "kasa kaydı"yla
// değil, bu satırla var olur — 0 tutarlı yer tutucu kayıt yazılmaz.
export async function createCashAccount(
  db: DbClient,
  {
    name,
    ownerUserId,
    grantUserIds = [],
    sectionId,
  }: { name: string; ownerUserId: number | null; grantUserIds?: number[]; sectionId?: number | null },
) {
  const [created] = await db
    .insert(cashAccounts)
    .values({ name, ownerUserId, ...(sectionId !== undefined ? { sectionId } : {}) })
    .returning();
  const grantees = new Set<number>(grantUserIds);
  if (ownerUserId !== null) grantees.add(ownerUserId);
  for (const userId of grantees) await grantCashAccountAccess(created.id, userId, db);
  return created;
}

// Excel aktarımı gibi "kasa adını yaz, yoksa açılsın" akışları için: mevcut
// kasaya yazmak sahipliği (canWriteCashAccount), yeni kasa açmak
// canCreateCashAccounts (yönetici / "cash" sayfa izni) ister.
export async function ensureWritableKasa(
  name: string,
  user: SessionUser,
  db: DbClient = getDb(),
  sectionId: number | null = null,
): Promise<{ forbidden: true } | { forbidden: false; cashAccountId: number; created: boolean }> {
  const existing = await findCashAccountByName(name, db);
  if (existing) {
    if (!(await canWriteCashAccount(user, existing.id, db))) return { forbidden: true };
    return { forbidden: false, cashAccountId: existing.id, created: false };
  }
  if (!canCreateCashAccounts(user)) return { forbidden: true };
  const created = await createCashAccount(db, { name, ownerUserId: user.id, sectionId });
  return { forbidden: false, cashAccountId: created.id, created: true };
}

// Whether `user` may see (and comment on) a given record: the same
// kind-permission + kasa-visibility combo GET /api/records already scopes
// its list by (see scopeToAccessibleKasas there) — a record with no kasa
// link at all stays visible to anyone with the page permission.
export async function canAccessRecord(
  user: Pick<SessionUser, "id" | "isAdmin" | "isSuperAdmin" | "permissions">,
  record: { kind: string; cashAccountId: number | null },
  db: DbClient = getDb(),
): Promise<boolean> {
  if (!user.isAdmin && !user.permissions.includes(record.kind as SessionUser["permissions"][number])) return false;
  if (record.cashAccountId === null) return true;
  return canAccessCashAccount(user, record.cashAccountId, db);
}

export type CashAccountLinkResult = { forbidden: true } | { forbidden: false; cashAccountId: number | null };

// Resolves the cash_accounts row a (gelir/gider) record write should link
// to, enforcing kasa-level WRITE access along the way — see Ayarlar > Kasa
// Erişimi / the "1. seçenek" access model. Sharing a kasa only ever grants
// read access (see canAccessCashAccount for that); writing to an existing
// kasa always requires actually owning it (or being a super admin) — see
// canWriteCashAccount. A record never creates a kasa by naming it: kasas are
// created on their own (POST /api/cash-accounts).
//
// `name` (payload.cashAccount, or the fallback bucket if empty) must resolve
// to a kasa the writer owns — except the two fallback names ("Diğer" /
// "Diğer Giderler"), which never mean "join whoever already owns that name":
// each user gets (and is silently routed to) their OWN bucket under that
// name, so unassigned income/expense never leaks between users who never
// explicitly shared anything. The first-ever writer of a fallback name keeps
// it unsuffixed; everyone else gets a "<name> (username)" bucket of their own.
export async function ensureCashAccountLink(
  { name, kind, user }: { name: string; kind: string; user: SessionUser },
  db: DbClient = getDb(),
): Promise<CashAccountLinkResult> {
  const resolvedName = name || fallbackKasaNameFor(kind);
  if (!resolvedName) return { forbidden: false, cashAccountId: null };

  if (isFallbackKasaName(resolvedName)) {
    let own = await findCashAccountByName(resolvedName, db);
    let personalName = resolvedName;
    if (own && own.ownerUserId !== user.id) {
      personalName = `${resolvedName} (${user.username})`;
      own = await findCashAccountByName(personalName, db);
    }
    if (!own) own = await createCashAccount(db, { name: personalName, ownerUserId: user.id });
    return { forbidden: false, cashAccountId: own.id };
  }

  const existing = await findCashAccountByName(resolvedName, db);
  if (!existing) return { forbidden: true };
  if (!(await canWriteCashAccount(user, existing.id, db))) {
    return { forbidden: true };
  }

  return { forbidden: false, cashAccountId: existing.id };
}
