// Kept in sync with the `Page`/`Kind` unions defined in app/lib/types.ts.
// Duplicated here (rather than imported from the client component) to keep
// the API layer decoupled from the client UI file.
// Kayıt türü: her kasa kaydı ya gelir ya giderdir (0050 öncesindeki "cash"
// kayıt türü kaldırıldı). "cash" artık yalnızca Kasa Kontrol Merkezi'nin
// sayfa/izin kimliğidir (Page).
export type Kind = "income" | "expense";
export const RECORD_KINDS: Kind[] = ["income", "expense"];
export type Page = "dashboard" | "cash" | Kind | "reportBuilder" | "notes" | "comments" | "archive" | "activity" | "users" | "settings";
// Mirrors app/page.tsx's restrictablePages const — the set of pages a
// non-admin user's `permissions` can actually contain.
export const restrictablePages: Page[] = ["cash", "income", "expense", "reportBuilder", "notes", "comments", "activity", "archive"];
