import { getDb } from "../../../../db";
import { records } from "../../../../db/schema";
import { requireSession } from "../../_lib/auth";
import { json, withErrorHandling } from "../../_lib/http";
import { ensureCashAccountLink, ensureWritableKasa, fallbackKasaNameFor } from "../../_lib/records";
import { RECORD_KINDS, type Kind } from "../../_lib/types";
import { convertLegacyKasaItem, parseBody, recordImportSchema } from "../../_lib/validate";

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, recordImportSchema);
  if ("response" in parsed) return parsed.response;
  // Eski biçimdeki "kasa kaydı" satırları kaynak adındaki kasaya Gelir
  // (eksi tutarlıysa Gider) olarak girer — bkz. convertLegacyKasaItem.
  const items = parsed.data.items.map(convertLegacyKasaItem);

  if (!session.user.isAdmin) {
    const kindsUsed = new Set(items.map((item) => item.kind));
    for (const kind of kindsUsed) {
      if (!RECORD_KINDS.includes(kind as Kind) || !session.user.permissions.includes(kind as Kind)) {
        return json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  if (items.some((item) => !item.cashAccount?.trim())) {
    return json({ error: "Gelir/gider bir kasaya bağlı olmalıdır" }, { status: 400 });
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    // Resolve every distinct (kind, kasa name) pair once — cheaper than
    // re-resolving per row, and means a partially-forbidden import fails
    // atomically instead of inserting some rows and rejecting others.
    // A legacy kasa row used to create its kasa on the fly; it still may
    // (same rule as Yeni Kasa), while plain income/expense rows must name
    // an existing kasa the importer owns.
    const linkCache = new Map<string, number | null>();
    const keyOf = (item: (typeof items)[number]) => `${item.legacyKasa ? "kasa" : item.kind}:${item.cashAccount}`;
    // Eski kasa satırları önce: aynı adı kullanan gelir/gider satırları o kasayı bulabilsin.
    for (const item of [...items].sort((a, b) => Number(b.legacyKasa) - Number(a.legacyKasa))) {
      const cacheKey = keyOf(item);
      if (linkCache.has(cacheKey)) continue;
      const link = item.legacyKasa
        ? await ensureWritableKasa(item.cashAccount, session.user, tx)
        : await ensureCashAccountLink({ name: item.cashAccount, kind: item.kind, user: session.user }, tx);
      if (link.forbidden) return { forbidden: true as const };
      linkCache.set(cacheKey, link.cashAccountId);
    }

    const rowsToInsert = items.map((item) => ({
      kind: item.kind,
      date: item.date || new Date().toISOString().slice(0, 10),
      source: item.source,
      detail: item.detail,
      note: item.note,
      person: item.person,
      amount: item.amount,
      currency: item.currency,
      project: item.project,
      tags: item.tags,
      link: item.link,
      cashAccount: item.cashAccount || fallbackKasaNameFor(item.kind),
      cashAccountId: linkCache.get(keyOf(item)) ?? null,
      listName: item.listName,
    }));

    const insertedRows = await tx.insert(records).values(rowsToInsert).returning();
    return { forbidden: false as const, insertedRows };
  });

  if (result.forbidden) return json({ error: "Forbidden" }, { status: 403 });
  return json({ records: result.insertedRows }, { status: 201 });
});
