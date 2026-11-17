import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { cashAccountAccess, cashAccounts, records, users } from "../../../db/schema";
import { requireSession } from "../_lib/auth";
import { accessibleCashAccountIds, canCreateCashAccounts } from "../_lib/cash-access";
import { json, withErrorHandling } from "../_lib/http";
import { createCashAccount, findCashAccountByName, isCashSection } from "../_lib/records";
import { cashAccountCreateSchema, parseBody } from "../_lib/validate";
import { formatAmount, logActivity } from "../_lib/activity";

// GET /api/cash-accounts — kasa listesi.
// - Süper admin: hepsi, sahibi ve kaç kullanıcıyla paylaşıldığı bilgisiyle
//   (Ayarlar > Kasa Erişimi panosu bu uçtan besleniyor).
// - Diğerleri: yalnız kendi erişebildikleri kasalar. `isOwner` ve
//   `sharedWithUserIds` de eklenir ki Kasalar sayfasındaki "Paylaş" düğmesi
//   (sahibi olduğu kasalar için) client tarafında ayrı bir istek atmadan
//   hangi kasaları yönetebileceğini bilsin — asıl yetki denetimi yine
//   canManageCashAccountAccess'te, sunucu tarafında yapılıyor.
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const db = getDb();

  if (session.user.isSuperAdmin) {
    const rows = await db
      .select({
        id: cashAccounts.id,
        name: cashAccounts.name,
        ownerUserId: cashAccounts.ownerUserId,
        ownerName: users.name,
        createdAt: cashAccounts.createdAt,
        dashboardShareEnabled: cashAccounts.dashboardShareEnabled,
        sectionId: cashAccounts.sectionId,
        sortOrder: cashAccounts.sortOrder,
      })
      .from(cashAccounts)
      .leftJoin(users, eq(cashAccounts.ownerUserId, users.id))
      .orderBy(cashAccounts.name);

    const accessRows = await db
      .select({ cashAccountId: cashAccountAccess.cashAccountId, userId: cashAccountAccess.userId })
      .from(cashAccountAccess);
    const accessByKasa = new Map<number, number[]>();
    for (const row of accessRows) {
      const list = accessByKasa.get(row.cashAccountId) ?? [];
      list.push(row.userId);
      accessByKasa.set(row.cashAccountId, list);
    }

    return json({
      cashAccounts: rows.map((row) => ({
        ...row,
        isOwner: row.ownerUserId === session.user.id,
        sharedWithUserIds: accessByKasa.get(row.id) ?? [],
      })),
    });
  }

  const accessibleIds = await accessibleCashAccountIds(session.user, db);
  if (!accessibleIds || !accessibleIds.length) return json({ cashAccounts: [] });
  const allowed = new Set(accessibleIds);

  const [all, accessRows] = await Promise.all([
    db
      .select({
        id: cashAccounts.id,
        name: cashAccounts.name,
        ownerUserId: cashAccounts.ownerUserId,
        ownerName: users.name,
        dashboardShareEnabled: cashAccounts.dashboardShareEnabled,
        sectionId: cashAccounts.sectionId,
        sortOrder: cashAccounts.sortOrder,
      })
      .from(cashAccounts)
      .leftJoin(users, eq(cashAccounts.ownerUserId, users.id)),
    db.select({ cashAccountId: cashAccountAccess.cashAccountId, userId: cashAccountAccess.userId }).from(cashAccountAccess),
  ]);
  const accessByKasa = new Map<number, number[]>();
  for (const row of accessRows) {
    const list = accessByKasa.get(row.cashAccountId) ?? [];
    list.push(row.userId);
    accessByKasa.set(row.cashAccountId, list);
  }

  return json({
    cashAccounts: all
      .filter((row) => allowed.has(row.id))
      .map((row) => ({
        ...row,
        isOwner: row.ownerUserId === session.user.id,
        sharedWithUserIds: accessByKasa.get(row.id) ?? [],
      })),
  });
});

class KasaNameTakenError extends Error {}
const KASA_NAME_TAKEN = "Bu isimde bir kasa zaten var";

// POST /api/cash-accounts — Yeni Kasa. Kasa artık bir "kasa kaydı" ile değil,
// kendi başına açılır: yetki kuralları eskisiyle aynıdır (canCreateCashAccounts
// = yönetici / süper yönetici / Kasa Kontrol Merkezi izni), açan kişi kasanın
// sahibi olur ve hemen görür. Ad benzersizdir (409). Açılış bakiyesi verilirse
// kasaya "Açılış bakiyesi" başlıklı bir Gelir kaydı yazılır (Gelir izni gerekir).
export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  if (!canCreateCashAccounts(session.user)) return json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseBody(request, cashAccountCreateSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;
  const withOpening = payload.openingAmount > 0;
  if (withOpening && !session.user.isAdmin && !session.user.permissions.includes("income")) {
    return json({ error: "Açılış bakiyesi bir Gelir kaydıdır; Gelir yetkiniz yok" }, { status: 403 });
  }

  const db = getDb();
  if (!(await isCashSection(payload.sectionId, db))) return json({ error: "Çalışma alanı bulunamadı" }, { status: 400 });
  if (await findCashAccountByName(payload.name, db)) return json({ error: KASA_NAME_TAKEN }, { status: 409 });

  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Aynı anda aynı adla iki istek: ikincisi benzersizlik kısıtına takılır.
      if (await findCashAccountByName(payload.name, tx)) throw new KasaNameTakenError();
      const account = await createCashAccount(tx, {
        name: payload.name,
        ownerUserId: session.user.id,
        sectionId: payload.sectionId,
      });
      const [opening] = withOpening
        ? await tx
            .insert(records)
            .values({
              kind: "income",
              date: payload.date ?? new Date().toISOString().slice(0, 10),
              source: "Açılış bakiyesi",
              amount: payload.openingAmount,
              currency: payload.currency,
              cashAccount: account.name,
              cashAccountId: account.id,
            })
            .returning()
        : [null];
      return { account, opening };
    });
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if (error instanceof KasaNameTakenError || (e?.cause?.code ?? e?.code) === "23505") return json({ error: KASA_NAME_TAKEN }, { status: 409 });
    throw error;
  }

  await logActivity(session.user, {
    category: "cash",
    action: "create",
    summary: result.opening
      ? `Kasa oluşturuldu: ${result.account.name} (açılış bakiyesi ${formatAmount(result.opening.amount, result.opening.currency)})`
      : `Kasa oluşturuldu: ${result.account.name}`,
    kasa: result.account.name,
    meta: { id: result.account.id, ...(result.opening ? { recordId: result.opening.id } : {}) },
  });
  return json({ cashAccount: result.account, record: result.opening }, { status: 201 });
});
