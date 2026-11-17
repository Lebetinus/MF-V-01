import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { noteColumns, preparedReports, records, settings, users } from "../../../db/schema";
import { requireSession } from "../_lib/auth";
import { accessibleCashAccountIds, accessibleCashAccountNames } from "../_lib/cash-access";
import { json, withErrorHandling } from "../_lib/http";
import { toListRecord } from "../_lib/records";
import { listClientNotes } from "../_lib/notes";
import { RECORD_KINDS } from "../_lib/types";

const SETTINGS_ID = 1;

function toClientUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    roleLabel: row.roleLabel,
    isAdmin: row.isAdmin,
    isSuperAdmin: row.isSuperAdmin,
    permissions: row.permissions,
    locked: row.locked,
    lockedAt: row.lockedAt,
    lockReason: row.lockReason,
  };
}

// A record with no kasa link (cashAccountId null) stays visible to anyone
// with the page permission — see scopeToAccessibleKasas in
// app/api/records/route.ts for the same rule.
function scopeRecordsToAccessibleKasas<T extends { cashAccountId: number | null }>(rows: T[], accessibleIds: number[] | null): T[] {
  if (accessibleIds === null) return rows;
  const allowed = new Set(accessibleIds);
  return rows.filter((row) => row.cashAccountId === null || allowed.has(row.cashAccountId));
}

// Prepared reports only carry the kasa's free-text name (cashAccount column),
// not a cashAccountId — see accessibleCashAccountNames.

// Returns everything the client needs right after login in one round trip,
// scoped to what the signed-in user is actually allowed to see: unpermitted
// collections come back empty rather than relying on the client to hide them.
// Kept small on purpose: the archive is not included (the Arşiv page loads
// it from /api/archive when opened) and records carry only attachment names
// and sizes, not their base64 contents.
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const { user } = session;
  const allowedKinds = user.isAdmin ? RECORD_KINDS : RECORD_KINDS.filter((kind) => user.permissions.includes(kind));
  const canNotes = user.isAdmin || user.permissions.includes("notes");
  const canReports = user.isAdmin || user.permissions.includes("reportBuilder");

  const db = getDb();
  const [accessibleIds, accessibleNames, recordRows, noteRows, reportRows, settingsRows, userRows, noteColumnRows] = await Promise.all([
    accessibleCashAccountIds(user, db),
    accessibleCashAccountNames(user, db),
    allowedKinds.length
      ? db.select().from(records).where(inArray(records.kind, allowedKinds)).orderBy(desc(records.date), desc(records.id))
      : Promise.resolve([]),
    canNotes ? listClientNotes(user.id, db) : Promise.resolve([]),
    canReports ? db.select().from(preparedReports).orderBy(desc(preparedReports.createdAt)) : Promise.resolve([]),
    db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1),
    // Every user gets their own row here even when not admin — Kullanıcılar
    // is open to everyone so they can view/edit their own account, just
    // scoped to themselves (see app/components/Users.tsx).
    user.isAdmin ? db.select().from(users).orderBy(users.id) : db.select().from(users).where(eq(users.id, user.id)).limit(1),
    db.select().from(noteColumns).orderBy(noteColumns.sortOrder, noteColumns.id),
  ]);

  const allowedNames = accessibleNames === null ? null : new Set(accessibleNames);
  const scopedReports = allowedNames === null
    ? reportRows
    : reportRows.filter((row) => !row.cashAccount || allowedNames.has(row.cashAccount));

  return json({
    records: scopeRecordsToAccessibleKasas(recordRows, accessibleIds).map(toListRecord),
    notes: noteRows,
    noteColumns: noteColumnRows.map((c) => ({ id: c.id, key: c.key, label: c.label, color: c.color })),
    preparedReports: scopedReports,
    settings: settingsRows[0] ?? null,
    users: userRows.map(toClientUser),
  });
});
