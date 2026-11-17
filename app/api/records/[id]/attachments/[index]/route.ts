import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { records } from "../../../../../../db/schema";
import { requireSession } from "../../../../_lib/auth";
import { canAccessCashAccount } from "../../../../_lib/cash-access";
import { json, withErrorHandling } from "../../../../_lib/http";
import type { Kind } from "../../../../_lib/types";

// GET /api/records/:id/attachments/:index — tek bir belgenin içeriği. Liste yanıtları (bootstrap, /api/records)
// ekin yalnız adını ve boyutunu taşır; içerik açılınca buradan gelir. Erişim, listeyle aynı kuraldır: kayıt
// türünün sayfa izni ve (kasaya bağlıysa) kasaya erişim — paylaşılan kasayı görebilen belgeyi de açabilir.
export const GET = withErrorHandling<{ params: Promise<{ id: string; index: string }> }>(async (request, { params }) => {
  const session = await requireSession(request);
  if ("response" in session) return session.response;
  const { id: idParam, index: indexParam } = await params;
  const id = Number(idParam);
  const index = Number(indexParam);
  if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0) return json({ error: "Invalid id" }, { status: 400 });

  const db = getDb();
  const [record] = await db
    .select({ kind: records.kind, cashAccountId: records.cashAccountId, attachments: records.attachments })
    .from(records)
    .where(eq(records.id, id))
    .limit(1);
  if (!record) return json({ error: "Not found" }, { status: 404 });
  const { user } = session;
  if (!user.isAdmin && !user.permissions.includes(record.kind as Kind)) return json({ error: "Forbidden" }, { status: 403 });
  if (record.cashAccountId !== null && !(await canAccessCashAccount(user, record.cashAccountId, db))) {
    return json({ error: "Forbidden" }, { status: 403 });
  }
  const attachment = ((record.attachments as { name: string; data: string }[]) ?? [])[index];
  if (!attachment) return json({ error: "Not found" }, { status: 404 });
  return json({ attachment: { name: attachment.name, data: attachment.data } });
});
