import { eq, inArray, or } from "drizzle-orm";
import type { DbClient } from "../../../db";
import { archive, cashTransfers, records } from "../../../db/schema";

// A kasa transfer writes two ledger rows that must live and die together:
// a negative "cash" row on the sender's kasa (fromRecordId) and a positive
// "income" row on the receiver's kasa (toRecordId). Deleting only one of
// them used to make money appear or vanish; these helpers keep the pair
// consistent.

export type TransferRow = typeof cashTransfers.$inferSelect;

export async function transferForRecord(recordId: number, db: DbClient): Promise<TransferRow | null> {
  const rows = await db
    .select()
    .from(cashTransfers)
    .where(or(eq(cashTransfers.fromRecordId, recordId), eq(cashTransfers.toRecordId, recordId)))
    .limit(1);
  return rows[0] ?? null;
}

// Fields of a transfer leg that define the money movement. Changing them on
// one leg only would desync the pair, so they are locked; descriptive fields
// (note, detail, person, date, tags, link, attachments) stay editable.
export const TRANSFER_LOCKED_FIELDS = ["amount", "currency", "kind", "cashAccount", "source"] as const;

// Reverses a transfer: archives and deletes BOTH legs and marks the transfer
// "cancelled" (the row is kept as history). Must run inside a transaction.
export async function reverseTransfer(
  transfer: TransferRow,
  { userName, reason }: { userName: string; reason: string },
  tx: DbClient,
): Promise<{ removedRecordIds: number[]; archiveEntries: (typeof archive.$inferSelect)[] }> {
  const legIds = [transfer.fromRecordId, transfer.toRecordId].filter((id): id is number => id !== null);
  const legs = legIds.length ? await tx.select().from(records).where(inArray(records.id, legIds)) : [];
  const archiveEntries = legs.length
    ? await tx
        .insert(archive)
        .values(legs.map((old) => ({ action: "Silindi", userName, oldRecord: old, reason: `Kasa aktarımı iptal edildi: ${reason}` })))
        .returning()
    : [];
  if (legs.length) await tx.delete(records).where(inArray(records.id, legs.map((l) => l.id)));
  await tx
    .update(cashTransfers)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(cashTransfers.id, transfer.id));
  return { removedRecordIds: legs.map((l) => l.id), archiveEntries };
}

// Before a kasa is deleted: reverse every transfer touching it, so the
// counterpart leg on the OTHER kasa does not survive on its own. (The
// cash_transfers rows themselves cascade away with the kasa.)
export async function reverseTransfersOfKasa(
  kasaId: number,
  { userName, reason }: { userName: string; reason: string },
  tx: DbClient,
): Promise<number[]> {
  const rows = await tx
    .select()
    .from(cashTransfers)
    .where(or(eq(cashTransfers.fromCashAccountId, kasaId), eq(cashTransfers.toCashAccountId, kasaId)));
  const removed: number[] = [];
  for (const transfer of rows) {
    if (transfer.status === "cancelled") continue;
    const result = await reverseTransfer(transfer, { userName, reason }, tx);
    removed.push(...result.removedRecordIds);
  }
  return removed;
}
