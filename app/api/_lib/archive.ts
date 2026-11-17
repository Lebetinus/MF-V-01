import type { archive } from "../../../db/schema";
import { attachmentSummaries } from "./records";

// The client's ArchiveItem shape (action/at/user/old) predates the DB schema
// and is used throughout app/page.tsx — translate DB rows to it here instead
// of renaming the schema or touching every client call site.
export function toClientArchiveItem(row: typeof archive.$inferSelect) {
  return {
    id: row.id,
    action: row.action,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    user: row.userName,
    // Arşiv görüntüsündeki eklerin içeriği gönderilmez (Arşiv sayfası ekleri göstermez; canlıda arşiv yanıtının
    // ~%90'ı buydu) — yalnız adları kalır.
    old: withoutAttachmentData(row.oldRecord),
    reason: row.reason,
  };
}

function withoutAttachmentData(oldRecord: unknown): unknown {
  if (!oldRecord || typeof oldRecord !== "object") return oldRecord;
  const snapshot = oldRecord as { attachments?: unknown };
  return { ...snapshot, attachments: attachmentSummaries(snapshot.attachments) };
}

// Arşivdeki bir anlık görüntünün (archive.old_record) kasa adı. 0050 göçünden
// önce arşive düşen "kasa kaydı" görüntülerinde (eski kind "cash") kasa adı
// `source`'tadır; geçmiş olduğu gibi saklandığından okumaya devam edilir.
// Bugünkü gelir/gider görüntülerinde kasa adı `cashAccount`'tur.
export const LEGACY_KASA_SNAPSHOT_KIND = "cash";
export function archivedKasaName(oldRecord: { kind?: string; source?: string; cashAccount?: string }): string {
  return (oldRecord.kind === LEGACY_KASA_SNAPSHOT_KIND ? oldRecord.source : oldRecord.cashAccount) ?? "";
}
