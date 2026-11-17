import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { cashAccounts, records } from "../../../../db/schema";
import { requireSession } from "../../_lib/auth";
import { canWriteCashAccount } from "../../_lib/cash-access";
import { json, withErrorHandling } from "../../_lib/http";
import { ensureWritableKasa, findCashAccountByName, isCashSection } from "../../_lib/records";
import { excelImportSchema, parseBody } from "../../_lib/validate";

// Excel aktarım sihirbazı: seçilen kasaya gelir/gider kayıtlarını (isteğe bağlı detay tablosuyla) toplu ekler.
// Kasa yoksa oluşturulur. Aynı importKey'e sahip kayıtlar zaten varsa atlanır (aynı dosya ikinci kez yüklenince
// çift kayıt olmaz). Her kayıt bir aktarım numarası (batchId) taşır; DELETE ile tüm aktarım geri alınabilir.
import { logActivity } from "../../_lib/activity";

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, excelImportSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;

  if (!session.user.isAdmin) {
    for (const kind of new Set(payload.items.map((i) => i.kind))) {
      if (!session.user.permissions.includes(kind)) return json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const db = getDb();
  if (payload.sectionId != null && !(await isCashSection(payload.sectionId, db))) return json({ error: "Çalışma alanı bulunamadı" }, { status: 400 });
  if (payload.sectionId == null && !(await findCashAccountByName(payload.kasaName, db))) {
    return json({ error: "Yeni kasa için bir çalışma alanı seçin" }, { status: 400 });
  }
  const result = await db.transaction(async (tx) => {
    // Kasa: yoksa seçilen çalışma alanında oluştur (kasa kendi başına açılır; yer tutucu kayıt yazılmaz).
    const link = await ensureWritableKasa(payload.kasaName, session.user, tx, payload.sectionId ?? null);
    if (link.forbidden) return { forbidden: true as const };
    if (payload.sectionId != null && !link.created) await tx.update(cashAccounts).set({ sectionId: payload.sectionId }).where(eq(cashAccounts.id, link.cashAccountId));

    const keys = payload.items.map((i) => i.importKey).filter(Boolean);
    const existing = keys.length
      ? new Set((await tx.select({ key: records.importKey }).from(records).where(inArray(records.importKey, keys))).map((r) => r.key))
      : new Set<string | null>();
    const seen = new Set<string>();
    const fresh = payload.items.filter((i) => {
      if (!i.importKey) return true;
      if (existing.has(i.importKey) || seen.has(i.importKey)) return false;
      seen.add(i.importKey);
      return true;
    });
    if (fresh.length) {
      await tx.insert(records).values(
        fresh.map((i) => ({
          kind: i.kind,
          date: i.date,
          source: i.source,
          detail: i.detail,
          note: i.note,
          person: i.person,
          amount: i.amount,
          currency: i.currency,
          project: i.project,
          tags: [],
          cashAccount: payload.kasaName,
          cashAccountId: link.cashAccountId,
          detailTable: i.detailTable,
          importBatch: payload.batchId,
          importKey: i.importKey || null,
        })),
      );
    }
    return { forbidden: false as const, inserted: fresh.length, skipped: payload.items.length - fresh.length };
  });

  if (result.forbidden) return json({ error: "Forbidden" }, { status: 403 });
  await logActivity(session.user, {
    category: "report",
    action: "import",
    summary: `Excel aktarımı: ${result.inserted} kayıt eklendi${result.skipped ? `, ${result.skipped} tekrar atlandı` : ""} — ${payload.kasaName}`,
    kasa: payload.kasaName,
    meta: { batchId: payload.batchId },
  });
  return json({ inserted: result.inserted, skipped: result.skipped }, { status: 201 });
});

// Aktarımı geri al: ?batchId=… ile eklenen tüm kayıtları siler (yalnızca yazma yetkisi olduğunuz kasalarda).
export const DELETE = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (batchId.length < 6) return json({ error: "Invalid batch" }, { status: 400 });

  const db = getDb();
  const rows = await db.select({ id: records.id, cashAccountId: records.cashAccountId }).from(records).where(eq(records.importBatch, batchId));
  if (!rows.length) return json({ deleted: 0 });
  for (const kasaId of new Set(rows.map((r) => r.cashAccountId))) {
    if (kasaId != null && !(await canWriteCashAccount(session.user, kasaId, db))) return json({ error: "Forbidden" }, { status: 403 });
  }
  await db.delete(records).where(eq(records.importBatch, batchId));
  await logActivity(session.user, { category: "report", action: "undo-import", summary: `Excel aktarımı geri alındı: ${rows.length} kayıt silindi`, meta: { batchId } });
  return json({ deleted: rows.length });
});
