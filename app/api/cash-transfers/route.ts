import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { cashAccounts, cashTransfers, records, users } from "../../../db/schema";
import { requireSession } from "../_lib/auth";
import { accessibleCashAccountIds, canCreateCashAccounts, canWriteCashAccount } from "../_lib/cash-access";
import { json, withErrorHandling } from "../_lib/http";
import { createCashAccount, findCashAccountByName } from "../_lib/records";
import { parseBody, cashTransferInputSchema } from "../_lib/validate";

// A "Kasa Aktarımı": money movement between two kasas. Listed here so both
// sides (sender and recipient) can see it — sender via fromCashAccountId
// access, recipient via toCashAccountId access. Creating one moves the
// money immediately (see POST below); `status` only tracks whether the
// recipient has acknowledged the resulting income record yet.
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const db = getDb();
  const accessibleIds = await accessibleCashAccountIds(session.user, db);

  const fromUsers = db.select().from(users);
  const [rows, userRows] = await Promise.all([
    db
      .select({
        id: cashTransfers.id,
        fromCashAccountId: cashTransfers.fromCashAccountId,
        toCashAccountId: cashTransfers.toCashAccountId,
        amount: cashTransfers.amount,
        currency: cashTransfers.currency,
        date: cashTransfers.date,
        detail: cashTransfers.detail,
        note: cashTransfers.note,
        recipientPerson: cashTransfers.recipientPerson,
        recipientUserId: cashTransfers.recipientUserId,
        createdByUserId: cashTransfers.createdByUserId,
        status: cashTransfers.status,
        confirmedByUserId: cashTransfers.confirmedByUserId,
        confirmedAt: cashTransfers.confirmedAt,
        fromRecordId: cashTransfers.fromRecordId,
        toRecordId: cashTransfers.toRecordId,
        createdAt: cashTransfers.createdAt,
      })
      .from(cashTransfers)
      .orderBy(desc(cashTransfers.createdAt)),
    fromUsers,
  ]);

  const scoped = accessibleIds === null
    ? rows
    : rows.filter((row) => accessibleIds.includes(row.fromCashAccountId) || accessibleIds.includes(row.toCashAccountId));

  const kasaRows = await db.select({ id: cashAccounts.id, name: cashAccounts.name }).from(cashAccounts);
  const kasaNameById = new Map(kasaRows.map((k) => [k.id, k.name]));
  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));

  return json({
    cashTransfers: scoped.map((row) => ({
      ...row,
      fromCashAccountName: kasaNameById.get(row.fromCashAccountId) ?? "",
      toCashAccountName: kasaNameById.get(row.toCashAccountId) ?? "",
      createdByUserName: userNameById.get(row.createdByUserId) ?? "",
      recipientUserName: row.recipientUserId ? (userNameById.get(row.recipientUserId) ?? null) : null,
      confirmedByUserName: row.confirmedByUserId ? (userNameById.get(row.confirmedByUserId) ?? null) : null,
    })),
  });
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;

  const parsed = await parseBody(request, cashTransferInputSchema);
  if ("response" in parsed) return parsed.response;
  const payload = parsed.data;

  if (!session.user.isAdmin && !session.user.permissions.includes("cash")) {
    return json({ error: "Forbidden" }, { status: 403 });
  }
  if (!payload.toCashAccountId && !payload.toCashAccountName?.trim()) {
    return json({ error: "Bir hedef kasa seçin veya yeni bir kasa adı girin" }, { status: 400 });
  }

  const db = getDb();

  const result = await db.transaction(async (tx) => {
    // Sending money out of a kasa is a write — only its owner (or a super
    // admin) may initiate a transfer from it, not just anyone it was shared
    // with for viewing.
    if (!(await canWriteCashAccount(session.user, payload.fromCashAccountId, tx))) {
      return { forbidden: true as const };
    }

    let toId: number;
    let toName: string;
    if (payload.toCashAccountId) {
      if (payload.toCashAccountId === payload.fromCashAccountId) return { sameAccount: true as const };
      const target = await tx.select().from(cashAccounts).where(eq(cashAccounts.id, payload.toCashAccountId)).limit(1);
      if (!target[0]) return { notFound: true as const };
      toId = target[0].id;
      toName = target[0].name;
    } else {
      const name = payload.toCashAccountName!.trim();
      const existing = await findCashAccountByName(name, tx);
      if (existing) {
        if (existing.id === payload.fromCashAccountId) return { sameAccount: true as const };
        toId = existing.id;
        toName = existing.name;
      } else {
        if (!canCreateCashAccounts(session.user)) return { forbidden: true as const };
        const ownerId = payload.recipientUserId ?? session.user.id;
        // The kasa row alone makes it show up as a card in Kasa Kontrol
        // Merkezi right away (cards come from cash_accounts), so the
        // recipient can find and open it to confirm the pending transfer.
        // Yeni kasa, gönderen kasanın çalışma alanında açılır (sonra taşınabilir).
        const [sender] = await tx.select({ sectionId: cashAccounts.sectionId }).from(cashAccounts).where(eq(cashAccounts.id, payload.fromCashAccountId)).limit(1);
        const created = await createCashAccount(tx, { name, ownerUserId: ownerId, grantUserIds: [session.user.id], sectionId: sender?.sectionId ?? null });
        toId = created.id;
        toName = created.name;
      }
    }

    const fromKasa = await tx.select({ name: cashAccounts.name }).from(cashAccounts).where(eq(cashAccounts.id, payload.fromCashAccountId)).limit(1);

    // The money moves right now, not when the recipient acknowledges it:
    // an "expense" ledger row leaves the sender's kasa immediately, and an
    // "income" row lands in the target kasa immediately too (so it's visible
    // right away) — `status` below only tracks whether the recipient has
    // confirmed it yet, shown client-side as a lighter tone until they do.
    // Both legs are "Kasa Aktarımı": they move balances but are left out of
    // income/expense totals (see app/lib/transfers.ts).
    const fromName = fromKasa[0]?.name ?? "";
    const [fromRecord] = await tx
      .insert(records)
      .values({
        kind: "expense",
        date: payload.date,
        source: "Kasa Aktarımı",
        detail: payload.detail || `Kasa aktarımı → ${toName}`,
        note: payload.note || `Kasa aktarımı — alıcı: ${payload.recipientPerson}`.trim(),
        person: payload.recipientPerson,
        amount: payload.amount,
        currency: payload.currency,
        cashAccount: fromName,
        cashAccountId: payload.fromCashAccountId,
      })
      .returning();

    const [toRecord] = await tx
      .insert(records)
      .values({
        kind: "income",
        date: payload.date,
        source: "Kasa Aktarımı",
        detail: payload.detail,
        note: payload.note || `Kasa aktarımı ile gelen tutar — gönderen: ${session.user.name}`.trim(),
        person: payload.recipientPerson,
        amount: payload.amount,
        currency: payload.currency,
        cashAccount: toName,
        cashAccountId: toId,
      })
      .returning();

    const [inserted] = await tx
      .insert(cashTransfers)
      .values({
        fromCashAccountId: payload.fromCashAccountId,
        toCashAccountId: toId,
        amount: payload.amount,
        currency: payload.currency,
        date: payload.date,
        detail: payload.detail,
        note: payload.note,
        recipientPerson: payload.recipientPerson,
        recipientUserId: payload.recipientUserId ?? null,
        createdByUserId: session.user.id,
        fromRecordId: fromRecord.id,
        toRecordId: toRecord.id,
      })
      .returning();

    return { ok: true as const, transfer: inserted };
  });

  if ("forbidden" in result && result.forbidden) return json({ error: "Forbidden" }, { status: 403 });
  if ("notFound" in result && result.notFound) return json({ error: "Hedef kasa bulunamadı" }, { status: 404 });
  if ("sameAccount" in result && result.sameAccount) {
    return json({ error: "Kaynak ve hedef kasa aynı olamaz" }, { status: 400 });
  }

  return json({ cashTransfer: result.transfer }, { status: 201 });
});
