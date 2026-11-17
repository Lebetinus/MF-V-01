import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { archive, records } from "../../../../db/schema";
import { requireSession } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";
import { canWriteCashAccount } from "../../_lib/cash-access";
import { ensureCashAccountLink } from "../../_lib/records";
import type { Kind } from "../../_lib/types";
import { toClientArchiveItem } from "../../_lib/archive";
import { parseBody, recordUpdateSchema } from "../../_lib/validate";
import { deleteReason, formatAmount, logActivity, withReason } from "../../_lib/activity";
import { debtPairOf, debtTwinOf, lockDebtPair, outstandingDebt } from "../../_lib/debts";
import { reverseTransfer, TRANSFER_LOCKED_FIELDS, transferForRecord } from "../../_lib/transfers";

class RecordConflictError extends Error {}
class DebtConflictError extends Error {}
class DebtGoneError extends Error {}

function canAccessKind(user: { isAdmin: boolean; permissions: string[] }, kind: string): boolean {
  return user.isAdmin || user.permissions.includes(kind as Kind);
}

export const PUT = withErrorHandling<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) return json({ error: "Invalid id" }, { status: 400 });

  const parsed = await parseBody(request, recordUpdateSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;

  const db = getDb();
  const existingRows = await db.select().from(records).where(eq(records.id, id)).limit(1);
  const old = existingRows[0];
  if (!old) return json({ error: "Record not found" }, { status: 404 });

  // Optimistic locking: if the client tells us the updatedAt it started
  // editing from and it no longer matches, someone else saved a change in
  // the meantime — reject rather than silently overwrite their edit.
  if (payload.updatedAt && new Date(payload.updatedAt).getTime() !== old.updatedAt.getTime()) {
    return json({ error: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" }, { status: 409 });
  }

  const kind = payload.kind ?? old.kind;
  // Both the record's current kind and its requested new kind must be
  // permitted — otherwise a user could smuggle a record from an
  // unauthorized bucket into an authorized one (or vice versa).
  if (!canAccessKind(session.user, old.kind) || !canAccessKind(session.user, kind)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }
  // Kind-level permission alone isn't enough: the record's *current* kasa
  // (if it has one) must also be one this user owns — sharing only grants
  // read access, not the right to edit/move a record by id.
  if (old.cashAccountId !== null && !(await canWriteCashAccount(session.user, old.cashAccountId, db))) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  // Kasa aktarımı kayıtları çift olarak yaşar (gönderende X gider, alanda X gelir):
  // tutar/kasa/para birimi tek taraftan değişirse çift bozulur.
  const transfer = await transferForRecord(id, db);
  if (transfer && TRANSFER_LOCKED_FIELDS.some((field) => payload[field] !== undefined && payload[field] !== old[field])) {
    return json({ error: "Kasa aktarımı kaydının tutarı, kasası ve para birimi değiştirilemez; aktarımı silip yeniden yapın" }, { status: 400 });
  }

  // Borç kayıtlarının tutarı, kasası ve para birimi sabittir (borç bakiyesi buna bağlı): silip yeniden ekleyin.
  if (old.debtRole && ((payload.amount !== undefined && payload.amount !== old.amount) || (payload.currency !== undefined && payload.currency !== old.currency) || (payload.cashAccount !== undefined && payload.cashAccount !== old.cashAccount) || (payload.kind !== undefined && payload.kind !== old.kind))) {
    return json({ error: "Borç kaydının tutarı, kasası ve para birimi değiştirilemez; kaydı silip yeniden ekleyin" }, { status: 400 });
  }

  const source = payload.source ?? old.source;
  const cashAccount = payload.cashAccount ?? old.cashAccount;
  // Hiçbir gelir/gider kasadan kopuk olamaz.
  if (!cashAccount?.trim()) return json({ error: "Gelir/gider bir kasaya bağlı olmalıdır" }, { status: 400 });

  let result;
  try {
  result = await db.transaction(async (tx) => {
    const link = await ensureCashAccountLink({ name: cashAccount, kind, user: session.user }, tx);
    if (link.forbidden) return { forbidden: true as const };

    const [updatedRecord] = await tx
      .update(records)
      .set({
        kind,
        date: payload.date ?? old.date,
        source,
        detail: payload.detail ?? old.detail,
        note: payload.note ?? old.note,
        person: payload.person ?? old.person,
        amount: payload.amount ?? old.amount,
        currency: payload.currency ?? old.currency,
        project: payload.project ?? old.project,
        tags: payload.tags ?? old.tags,
        link: payload.link ?? old.link,
        cashAccount,
        cashAccountId: link.cashAccountId,
        attachments: payload.attachments ?? old.attachments,
        detailTable: payload.detailTable ?? old.detailTable,
        detailTableLayout: payload.detailTableLayout ?? old.detailTableLayout,
        updatedAt: new Date(),
      })
      // Optimistic lock, enforced atomically: the early updatedAt check above
      // runs before the transaction, so two saves could both pass it. The
      // row only updates if it is still at the version this request read
      // (compared at millisecond precision — JS Dates carry no microseconds).
      .where(payload.updatedAt ? and(eq(records.id, id), sql`date_trunc('milliseconds', ${records.updatedAt}) = ${old.updatedAt.toISOString()}::timestamptz`) : eq(records.id, id))
      .returning();
    // Throwing rolls back everything this transaction already did.
    if (!updatedRecord) throw new RecordConflictError();

    const [insertedArchive] = await tx
      .insert(archive)
      .values({
        action: "Düzenlendi",
        userName: session.user.name,
        oldRecord: old,
      })
      .returning();

    return { forbidden: false as const, record: updatedRecord, archiveEntry: insertedArchive };
  });
  } catch (error) {
    if (error instanceof RecordConflictError) return json({ error: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" }, { status: 409 });
    throw error;
  }

  if (result.forbidden) return json({ error: "Forbidden" }, { status: 403 });
  const changed = result.record;
  await logActivity(session.user, {
    category: changed.kind,
    action: "update",
    summary: `${changed.kind === "income" ? "Gelir" : "Gider"} düzenlendi: ${changed.source} — ${formatAmount(changed.amount, changed.currency)}`,
    kasa: changed.cashAccount,
    meta: { id: changed.id },
  });
  return json({ record: result.record, archiveEntry: toClientArchiveItem(result.archiveEntry) });
});

export const DELETE = withErrorHandling<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) return json({ error: "Invalid id" }, { status: 400 });

  const reason = deleteReason(request);
  if (reason.length < 3) return json({ error: "Silme gerekçesi zorunludur" }, { status: 400 });

  const db = getDb();
  const existingRows = await db.select().from(records).where(eq(records.id, id)).limit(1);
  const old = existingRows[0];
  if (!old) return json({ error: "Record not found" }, { status: 404 });

  if (!canAccessKind(session.user, old.kind)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }
  if (old.cashAccountId !== null && !(await canWriteCashAccount(session.user, old.cashAccountId, db))) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  // Kasa aktarımının bir tarafını silmek tüm aktarımı geri alır: iki kayıt
  // birlikte silinir (ikisi de Arşiv'e yazılır) ve aktarım "iptal" olur.
  // Yalnız bir taraf silinseydi para bir kasadan çıkıp hiçbir yere varmazdı.
  const transfer = await transferForRecord(id, db);
  if (transfer) {
    const reversed = await db.transaction((tx) => reverseTransfer(transfer, { userName: session.user.name, reason }, tx));
    await logActivity(session.user, {
      category: "cash",
      action: "delete",
      summary: withReason(`Kasa aktarımı iptal edildi: ${formatAmount(transfer.amount, transfer.currency)} (${reversed.removedRecordIds.length} kayıt Arşiv'e taşındı)`, reason),
      kasa: old.cashAccount,
      meta: { id: old.id, transferId: transfer.id },
    });
    const own = reversed.archiveEntries.find((entry) => (entry.oldRecord as { id?: number })?.id === id) ?? reversed.archiveEntries[0];
    return json({
      archiveEntry: own ? toClientArchiveItem(own) : null,
      archiveEntries: reversed.archiveEntries.map(toClientArchiveItem),
      removedRecordIds: reversed.removedRecordIds,
    });
  }

  // Borç kayıtları ikiz yaşar (bkz. _lib/debts.ts): bir tarafı silmek işlemin iki kaydını birlikte siler (ikisi de
  // Arşiv'e yazılır). Verilen borcu silmek, o borca yapılmış geri ödemeler kalan borçtan fazla kalacaksa reddedilir
  // (önce ödemeler silinmeli); geri ödemeler her zaman silinebilir.
  if (old.debtRole) {
    // İkiz öteki türdedir (gelir ↔ gider): ikisinin de izni gerekir.
    if (!canAccessKind(session.user, "income") || !canAccessKind(session.user, "expense")) {
      return json({ error: "Forbidden" }, { status: 403 });
    }
    let removed;
    try {
      removed = await db.transaction(async (tx) => {
        const pair = debtPairOf(old);
        if (pair) await lockDebtPair(pair.debtorId, pair.creditorId, tx);
        // Kilit alındıktan sonra yeniden okunur: bu arada başka bir istek silmiş olabilir.
        const current = (await tx.select().from(records).where(eq(records.id, id)).limit(1))[0];
        if (!current) throw new DebtGoneError();
        const twin = await debtTwinOf(current, tx);
        if (pair && (current.debtRole === "lent" || current.debtRole === "borrowed")) {
          const remaining = await outstandingDebt(pair.debtorId, pair.creditorId, current.currency, tx);
          if (remaining - current.amount < -0.004) throw new DebtConflictError();
        }
        const legs = twin ? [current, twin] : [current];
        const archiveEntries = await tx
          .insert(archive)
          .values(legs.map((leg) => ({
            action: "Silindi",
            userName: session.user.name,
            oldRecord: leg,
            reason: leg.id === current.id ? reason : `Borç işleminin karşı kaydı silindi: ${reason}`,
          })))
          .returning();
        await tx.delete(records).where(inArray(records.id, legs.map((leg) => leg.id)));
        return { legs, archiveEntries };
      });
    } catch (error) {
      if (error instanceof DebtConflictError) {
        return json({ error: "Bu borca yapılan geri ödemeler kalan borçtan fazla olur; önce borç ödemelerini silin" }, { status: 409 });
      }
      if (error instanceof DebtGoneError) return json({ error: "Record not found" }, { status: 404 });
      throw error;
    }
    const lendLeg = old.debtRole === "lent" || old.debtRole === "borrowed";
    const route = removed.legs.find((leg) => leg.kind === "expense");
    const target = removed.legs.find((leg) => leg.kind === "income");
    await logActivity(session.user, {
      category: "cash",
      action: "delete",
      summary: withReason(`${lendLeg ? "Borç verme" : "Borç ödemesi"} silindi: ${route?.cashAccount ?? "—"} → ${target?.cashAccount ?? "—"} — ${formatAmount(old.amount, old.currency)} (${removed.legs.length} kayıt Arşiv'e taşındı)`, reason),
      kasa: old.cashAccount,
      meta: { id: old.id, removedRecordIds: removed.legs.map((leg) => leg.id) },
    });
    const own = removed.archiveEntries.find((entry) => (entry.oldRecord as { id?: number })?.id === id) ?? removed.archiveEntries[0];
    return json({
      archiveEntry: own ? toClientArchiveItem(own) : null,
      archiveEntries: removed.archiveEntries.map(toClientArchiveItem),
      removedRecordIds: removed.legs.map((leg) => leg.id),
    });
  }

  const [archiveEntry] = await db.transaction(async (tx) => {
    await tx.delete(records).where(eq(records.id, id));
    return tx
      .insert(archive)
      .values({
        action: "Silindi",
        userName: session.user.name,
        oldRecord: old,
        reason,
      })
      .returning();
  });

  await logActivity(session.user, {
    category: old.kind,
    action: "delete",
    summary: withReason(`${old.kind === "income" ? "Gelir" : "Gider"} silindi: ${old.source} — ${formatAmount(old.amount, old.currency)}`, reason),
    kasa: old.cashAccount,
    meta: { id: old.id },
  });
  return json({ archiveEntry: toClientArchiveItem(archiveEntry) });
});
