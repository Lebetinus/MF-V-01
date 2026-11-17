import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { archive, cashAccounts, financeNotes, preparedReports, records, settings } from "../../../../db/schema";
import { requireSuperAdmin } from "../../_lib/auth";
import { requireCurrentPassword } from "../../_lib/confirm-password";
import { json, withErrorHandling } from "../../_lib/http";
import { convertLegacyKasaItem, databaseImportSchema, parseBody } from "../../_lib/validate";
import { createCashAccount } from "../../_lib/records";
import { dedupePeople } from "../../_lib/notes";

const SETTINGS_ID = 1;

// Replaces all financial data (records/archive/notes/prepared reports)
// with the imported set, inside one transaction. Users/passwords/sessions
// are never touched. IDs from the export are dropped — the DB assigns
// fresh ones — since preserving them risks colliding with the serial
// sequence's next value.
// Replaces data for EVERY kasa → super admin only, and the caller's password
// is re-verified on the server (payload.confirmPassword).
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSuperAdmin(request);
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, databaseImportSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;
  const denied = await requireCurrentPassword(session.user.id, payload.confirmPassword);
  if (denied) return denied;

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(records);
    await tx.delete(archive);
    await tx.delete(financeNotes);
    await tx.delete(preparedReports);

    if (payload.records.length) {
      // Eski biçimdeki "kasa kaydı" satırları kaynak adındaki kasaya Gelir
      // (eksi tutarlıysa Gider) olarak girer. Eskiden kasayı o satır var
      // ediyordu; şimdi kasa (cash_accounts) yoksa açılır. Kayıtlar adı
      // tutan kasaya bağlanır.
      const items = payload.records.map(convertLegacyKasaItem);
      const kasaIdByName = new Map((await tx.select({ id: cashAccounts.id, name: cashAccounts.name }).from(cashAccounts)).map((k) => [k.name, k.id]));
      for (const name of new Set(items.filter((r) => r.legacyKasa && r.cashAccount).map((r) => r.cashAccount))) {
        if (kasaIdByName.has(name)) continue;
        const created = await createCashAccount(tx, { name, ownerUserId: session.user.id });
        kasaIdByName.set(name, created.id);
      }
      await tx.insert(records).values(
        items.map((r) => ({
          kind: r.kind,
          date: r.date,
          source: r.source,
          detail: r.detail,
          note: r.note,
          person: r.person,
          amount: r.amount,
          currency: r.currency,
          project: r.project,
          tags: r.tags,
          link: r.link,
          cashAccount: r.cashAccount,
          cashAccountId: kasaIdByName.get(r.cashAccount) ?? null,
        })),
      );
    }
    if (payload.archive.length) {
      await tx.insert(archive).values(
        payload.archive.map((a) => ({ action: a.action, userName: a.userName, oldRecord: a.oldRecord })),
      );
    }
    if (payload.notes.length) {
      await tx.insert(financeNotes).values(
        payload.notes.map((n) => ({
          title: n.title,
          content: n.content,
          status: n.status,
          relation: n.relation,
          relationDetail: n.relationDetail,
          people: dedupePeople(n.people),
          link: n.link,
        })),
      );
    }
    if (payload.preparedReports.length) {
      await tx.insert(preparedReports).values(
        payload.preparedReports.map((r) => ({
          id: r.id?.trim() || crypto.randomUUID(),
          date: r.date,
          title: r.title,
          detail: r.detail,
          presentedTo: r.presentedTo,
          cashAccount: r.cashAccount,
          signature: r.signature,
          income: r.income,
          expense: r.expense,
        })),
      );
    }
    if (payload.settings) {
      const existing = await tx.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
      if (existing[0]) {
        await tx
          .update(settings)
          .set({
            company: payload.settings.company ?? existing[0].company,
            logo: payload.settings.logo ?? existing[0].logo,
            typography: payload.settings.typography ?? existing[0].typography,
            language: payload.settings.language ?? existing[0].language,
            updatedAt: new Date(),
          })
          .where(eq(settings.id, SETTINGS_ID));
      }
    }
  });

  return json({ ok: true });
});
