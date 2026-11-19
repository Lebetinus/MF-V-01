import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { archive, records } from "../../../../../db/schema";
import { requireSession } from "../../../_lib/auth";
import { json, withErrorHandling } from "../../../_lib/http";
import { canWriteCashAccount } from "../../../_lib/cash-access";
import { formatAmount, logActivity } from "../../../_lib/activity";
import { toClientArchiveItem } from "../../../_lib/archive";
import { markRecordAsPartyDebt, unmarkPartyDebt } from "../../../_lib/debts";
import { transferForRecord } from "../../../_lib/transfers";
import { parseBody, recordDebtMarkSchema } from "../../../_lib/validate";

type Context = { params: Promise<{ id: string }> };
type Row = typeof records.$inferSelect;

// Ortak denetim: kayıt var, kullanıcının Gelir + Gider izni var ve kaydın kasasına yazabiliyor.
async function loadWritable(request: Request, params: Context["params"]) {
  const session = await requireSession(request);
  if ("response" in session) return { response: session.response };
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return { response: json({ error: "Invalid id" }, { status: 400 }) };
  const user = session.user;
  if (!user.isAdmin && !(user.permissions.includes("income") && user.permissions.includes("expense"))) {
    return { response: json({ error: "Borç işlemi için Gelir ve Gider yetkisi gerekir" }, { status: 403 }) };
  }
  const db = getDb();
  const old = (await db.select().from(records).where(eq(records.id, id)).limit(1))[0];
  if (!old) return { response: json({ error: "Record not found" }, { status: 404 }) };
  if (old.cashAccountId !== null && !(await canWriteCashAccount(user, old.cashAccountId, db))) {
    return { response: json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, db, old };
}

// POST /api/records/:id/debt — "Borca çevir": normal bir gideri sistem dışı kasaya / projeye verilmiş borç olarak
// (gelir kaydını o borcun tahsilatı olarak) işaretler. Bakiye değişmez; kayıt gelir/gider istatistiğinden çıkar ve
// Borç Detay'da alacak olarak görünür (bkz. app/api/_lib/debts.ts).
export const POST = withErrorHandling<Context>(async (request, { params }) => {
  const loaded = await loadWritable(request, params);
  if ("response" in loaded) return loaded.response as Response;
  const { user, db, old } = loaded;
  const parsed = await parseBody(request, recordDebtMarkSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.updatedAt && new Date(parsed.data.updatedAt).getTime() !== old.updatedAt.getTime()) {
    return json({ error: "Bu kayıt başka bir kullanıcı tarafından değiştirildi" }, { status: 409 });
  }
  // Kasa aktarımı kayıtları çift yaşar; bir tarafı borca çevrilemez.
  if (await transferForRecord(old.id, db)) {
    return json({ error: "Kasa aktarımı kaydı borca çevrilemez" }, { status: 400 });
  }
  const result = await db.transaction(async (tx) => {
    const change = await markRecordAsPartyDebt(tx, old, parsed.data.party);
    if (!change.record) return change;
    const [archiveEntry] = await tx.insert(archive).values({ action: "Düzenlendi", userName: user.name, oldRecord: old }).returning();
    return { ...change, archiveEntry };
  });
  if (!result.record) return json({ error: result.error!.message }, { status: result.error!.status });
  const rec: Row = result.record;
  await logActivity(user, {
    category: "cash",
    action: "update",
    summary: rec.debtRole === "lent"
      ? `Gider borca çevrildi: ${rec.cashAccount} → ${rec.debtParty}${rec.person ? ` (${rec.person})` : ""} — ${formatAmount(rec.amount, rec.currency)}`
      : `Gelir borç tahsilatı olarak işaretlendi: ${rec.debtParty} → ${rec.cashAccount} — ${formatAmount(rec.amount, rec.currency)}`,
    kasa: rec.cashAccount,
    meta: { id: rec.id },
  });
  return json({ record: rec, archiveEntry: "archiveEntry" in result && result.archiveEntry ? toClientArchiveItem(result.archiveEntry) : null });
});

// DELETE /api/records/:id/debt — "Borçtan çıkar": sistem dışı borç kaydını yeniden normal gelir / gidere döndürür.
export const DELETE = withErrorHandling<Context>(async (request, { params }) => {
  const loaded = await loadWritable(request, params);
  if ("response" in loaded) return loaded.response as Response;
  const { user, db, old } = loaded;
  const result = await db.transaction(async (tx) => {
    const change = await unmarkPartyDebt(tx, old);
    if (!change.record) return change;
    const [archiveEntry] = await tx.insert(archive).values({ action: "Düzenlendi", userName: user.name, oldRecord: old }).returning();
    return { ...change, archiveEntry };
  });
  if (!result.record) return json({ error: result.error!.message }, { status: result.error!.status });
  const rec: Row = result.record;
  await logActivity(user, {
    category: "cash",
    action: "update",
    summary: `Borç işareti kaldırıldı: ${rec.cashAccount} / ${old.debtParty} — ${formatAmount(rec.amount, rec.currency)} yeniden ${rec.kind === "income" ? "gelir" : "gider"}`,
    kasa: rec.cashAccount,
    meta: { id: rec.id },
  });
  return json({ record: rec, archiveEntry: "archiveEntry" in result && result.archiveEntry ? toClientArchiveItem(result.archiveEntry) : null });
});
