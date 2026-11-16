import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { archive, financeNotes, preparedReports, records, settings } from "../../../../db/schema";
import { requireSuperAdmin } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";

const SETTINGS_ID = 1;

// Financial-data-only backup: no users/passwords/sessions/blocked IPs.
// See MF-V-01-DUZELTME-PLANI-1.0.9.md 3.3.
// Kasa erişimine bakmadan TÜM kasaların verisini döndürdüğü için yalnız
// süper admin (tüm kasaları zaten gören rol) kullanabilir.
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSuperAdmin(request);
  if ("response" in session) return session.response;

  const db = getDb();
  const [recordRows, archiveRows, noteRows, reportRows, settingsRows] = await Promise.all([
    db.select().from(records),
    db.select().from(archive),
    db.select().from(financeNotes),
    db.select().from(preparedReports),
    db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1),
  ]);

  return json({
    version: 1,
    exportedAt: new Date().toISOString(),
    records: recordRows,
    archive: archiveRows,
    notes: noteRows,
    preparedReports: reportRows,
    settings: settingsRows[0] ?? null,
  });
});
