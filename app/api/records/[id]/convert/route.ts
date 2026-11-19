import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { archive, records } from "../../../../../db/schema";
import { requireSession } from "../../../_lib/auth";
import { json, withErrorHandling } from "../../../_lib/http";
import { canWriteCashAccount } from "../../../_lib/cash-access";
import { formatAmount, logActivity } from "../../../_lib/activity";
import { toClientArchiveItem } from "../../../_lib/archive";
import { convertRecord, fxRateLabel, revertConversion, specialRecordReason } from "../../../_lib/fx";
import { parseBody, recordConvertSchema } from "../../../_lib/validate";
import type { Kind } from "../../../_lib/types";

type Context = { params: Promise<{ id: string }> };
type Row = typeof records.$inferSelect;
type Outcome = { record?: Row; error?: { status: number; message: string }; archiveEntry?: typeof archive.$inferSelect };

// Ortak denetim: kayıt var, kullanıcının kaydın türüne izni var ve kaydın kasasına yazabiliyor.
async function loadWritable(request: Request, params: Context["params"]) {
  const session = await requireSession(request);
  if ("response" in session) return { response: session.response as Response };
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return { response: json({ error: "Invalid id" }, { status: 400 }) };
  const user = session.user;
  const db = getDb();
  const old = (await db.select().from(records).where(eq(records.id, id)).limit(1))[0];
  if (!old) return { response: json({ error: "Record not found" }, { status: 404 }) };
  if (!user.isAdmin && !user.permissions.includes(old.kind as Kind)) return { response: json({ error: "Forbidden" }, { status: 403 }) };
  if (old.cashAccountId !== null && !(await canWriteCashAccount(user, old.cashAccountId, db))) {
    return { response: json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, db, old };
}

// POST /api/records/:id/convert — "Dolara çevir" (ya da başka bir birime): tutar ve birim kurla çevrilir; ilk tutar,
// birimi ve kur kayıtta bilgi olarak kalır (bkz. app/api/_lib/fx.ts convertRecord). Borç, aktarım ve bozdurma kayıtları
// çevrilmez (tutarları başka kayıtlara bağlıdır).
export const POST = withErrorHandling<Context>(async (request, { params }) => {
  const loaded = await loadWritable(request, params);
  if ("response" in loaded) return loaded.response as Response;
  const { user, db, old } = loaded;
  const parsed = await parseBody(request, recordConvertSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.updatedAt && new Date(parsed.data.updatedAt).getTime() !== old.updatedAt.getTime()) {
    return json({ error: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" }, { status: 409 });
  }
  const special = await specialRecordReason(old, db);
  if (special) return json({ error: `${special} başka para birimine çevrilemez` }, { status: 400 });
  const { toCurrency, rate } = parsed.data;
  const result: Outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const change = await convertRecord(tx, old, toCurrency, rate);
    if (!change.record) return change;
    const [archiveEntry] = await tx.insert(archive).values({ action: "Düzenlendi", userName: user.name, oldRecord: old }).returning();
    return { ...change, archiveEntry };
  });
  if (!result.record) return json({ error: result.error!.message }, { status: result.error!.status });
  const rec = result.record;
  await logActivity(user, {
    category: rec.kind,
    action: "update",
    summary: `${rec.kind === "income" ? "Gelir" : "Gider"} çevrildi: ${rec.source} — ${formatAmount(old.amount, old.currency)} → ${formatAmount(rec.amount, rec.currency)} · ${fxRateLabel(old.currency, rec.currency, rate)}`,
    kasa: rec.cashAccount,
    meta: { id: rec.id },
  });
  return json({ record: rec, archiveEntry: result.archiveEntry ? toClientArchiveItem(result.archiveEntry) : null });
});

// DELETE /api/records/:id/convert — çevirmeyi geri al: kayıt ilk tutarına ve birimine döner.
export const DELETE = withErrorHandling<Context>(async (request, { params }) => {
  const loaded = await loadWritable(request, params);
  if ("response" in loaded) return loaded.response as Response;
  const { user, db, old } = loaded;
  const result: Outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const change = await revertConversion(tx, old);
    if (!change.record) return change;
    const [archiveEntry] = await tx.insert(archive).values({ action: "Düzenlendi", userName: user.name, oldRecord: old }).returning();
    return { ...change, archiveEntry };
  });
  if (!result.record) return json({ error: result.error!.message }, { status: result.error!.status });
  const rec = result.record;
  await logActivity(user, {
    category: rec.kind,
    action: "update",
    summary: `${rec.kind === "income" ? "Gelir" : "Gider"} çevirmesi geri alındı: ${rec.source} — ${formatAmount(old.amount, old.currency)} → ${formatAmount(rec.amount, rec.currency)}`,
    kasa: rec.cashAccount,
    meta: { id: rec.id },
  });
  return json({ record: rec, archiveEntry: result.archiveEntry ? toClientArchiveItem(result.archiveEntry) : null });
});
