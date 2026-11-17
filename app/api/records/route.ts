import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { records } from "../../../db/schema";
import { requireSession } from "../_lib/auth";
import { accessibleCashAccountIds } from "../_lib/cash-access";
import { json, withErrorHandling } from "../_lib/http";
import { ensureCashAccountLink, fallbackKasaNameFor, toListRecord } from "../_lib/records";
import { RECORD_KINDS, type Kind } from "../_lib/types";
import { parseBody, recordInputSchema } from "../_lib/validate";
import { formatAmount, logActivity } from "../_lib/activity";

function allowedKinds(user: { isAdmin: boolean; permissions: string[] }): Kind[] {
  if (user.isAdmin) return RECORD_KINDS;
  return RECORD_KINDS.filter((kind) => user.permissions.includes(kind));
}

// Records with no kasa link at all (cashAccountId null — shouldn't happen
// post-migration, but a null-safety net) stay visible to anyone with the
// page permission; everything else is additionally filtered by kasa access.
function scopeToAccessibleKasas<T extends { cashAccountId: number | null }>(rows: T[], accessibleIds: number[] | null): T[] {
  if (accessibleIds === null) return rows;
  const allowed = new Set(accessibleIds);
  return rows.filter((row) => row.cashAccountId === null || allowed.has(row.cashAccountId));
}

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const allowed = allowedKinds(session.user);
  const db = getDb();
  const accessibleIds = await accessibleCashAccountIds(session.user, db);

  if (kind) {
    // Yalnız gelir/gider vardır; eski "kasa kaydı" türü 0050 göçüyle kaldırıldı.
    if (!RECORD_KINDS.includes(kind as Kind)) return json({ error: "Geçersiz kayıt türü" }, { status: 400 });
    if (!allowed.includes(kind as Kind)) return json({ error: "Forbidden" }, { status: 403 });
    const rows = await db.select().from(records).where(eq(records.kind, kind)).orderBy(desc(records.date), desc(records.id));
    return json({ records: scopeToAccessibleKasas(rows, accessibleIds).map(toListRecord) });
  }

  if (!allowed.length) return json({ records: [] });
  const rows = await db.select().from(records).where(inArray(records.kind, allowed)).orderBy(desc(records.date), desc(records.id));
  return json({ records: scopeToAccessibleKasas(rows, accessibleIds).map(toListRecord) });
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, recordInputSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;

  if (!session.user.isAdmin && !session.user.permissions.includes(payload.kind as Kind)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  // Hiçbir gelir/gider kasadan kopuk olamaz: kasa zorunludur (kasalar da bir çalışma alanına bağlıdır).
  if (!payload.cashAccount?.trim()) return json({ error: "Gelir/gider bir kasaya bağlı olmalıdır" }, { status: 400 });

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const link = await ensureCashAccountLink({ name: payload.cashAccount, kind: payload.kind, user: session.user }, tx);
    if (link.forbidden) return { forbidden: true as const };

    const [record] = await tx
      .insert(records)
      .values({
        kind: payload.kind,
        date: payload.date,
        source: payload.source,
        detail: payload.detail,
        note: payload.note,
        person: payload.person,
        amount: payload.amount,
        currency: payload.currency,
        project: payload.project,
        tags: payload.tags,
        link: payload.link,
        cashAccount: payload.cashAccount || fallbackKasaNameFor(payload.kind),
        cashAccountId: link.cashAccountId,
        attachments: payload.attachments,
        detailTable: payload.detailTable,
        detailTableLayout: payload.detailTableLayout,
      })
      .returning();

    return { forbidden: false as const, record };
  });

  if (result.forbidden) return json({ error: "Forbidden" }, { status: 403 });
  const created = result.record;
  await logActivity(session.user, {
    category: created.kind,
    action: "create",
    summary: `${created.kind === "income" ? "Gelir" : "Gider"} eklendi: ${created.source} — ${formatAmount(created.amount, created.currency)}`,
    kasa: created.cashAccount,
    meta: { id: created.id },
  });
  return json({ record: result.record }, { status: 201 });
});
