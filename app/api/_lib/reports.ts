import { accessibleCashAccountNames } from "./cash-access";
import type { DbClient } from "../../../db";
import { getDb } from "../../../db";
import type { SessionUser } from "./auth";

// Hazırlanan raporlar kasaya yalnız serbest metin adla (cashAccount) bağlıdır.
// Bootstrap'taki filtreyle aynı kural: kasasız rapor herkese açık, kasalı
// rapor yalnız o kasayı görebilenlere. null = filtre yok (süper admin).
export async function reportKasaFilter(
  user: Pick<SessionUser, "id" | "isSuperAdmin">,
  db: DbClient = getDb(),
): Promise<((cashAccount: string | null | undefined) => boolean)> {
  const names = await accessibleCashAccountNames(user, db);
  if (names === null) return () => true;
  const allowed = new Set(names);
  return (cashAccount) => !cashAccount || allowed.has(cashAccount);
}
