-- 0050: "Kasa kaydı" (records.kind = 'cash') kaldırılıyor. Bundan sonra kasadaki
-- her kayıt ya gelir ya giderdir; kasa kendi başına (cash_accounts) açılır.
-- Kasa bakiyeleri değişmez: kasa bakiyesi = kasa kayıtları (+) + gelir (+)
-- − gider (−) idi; kasa kayıtları aynı tutarla gelire, eksi olanlar mutlak
-- tutarla gidere çevrilir. Geçmiş (archive.old_record, activity_log) olduğu
-- gibi kalır. Göç sunucu açılışında tek bir işlem (transaction) içinde çalışır.

-- a) Yalnızca kasayı "var etmek" için yazılmış boş kayıtlar silinir: 0 tutarlı,
--    eki yok, yorumu yok, bir kasa aktarımının tarafı değil. Kasa cash_accounts
--    satırıyla yaşamaya devam eder.
DELETE FROM "records" r
WHERE r."kind" = 'cash'
  AND r."amount" = 0
  AND r."attachments" = '[]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM "record_comments" c WHERE c."record_id" = r."id")
  AND NOT EXISTS (SELECT 1 FROM "cash_transfers" t WHERE t."from_record_id" = r."id" OR t."to_record_id" = r."id");
--> statement-breakpoint

-- b) Kasa aktarımının gönderen tarafı (eksi tutarlı kasa kaydı) → aynı kasada,
--    mutlak tutarlı bir "Kasa Aktarımı" gideri.
UPDATE "records" r
SET "kind" = 'expense',
    "amount" = abs(r."amount"),
    "source" = 'Kasa Aktarımı',
    "cash_account" = coalesce(
      (SELECT ca."name" FROM "cash_accounts" ca WHERE ca."id" = r."cash_account_id"),
      nullif(r."cash_account", ''),
      r."source"
    )
WHERE r."kind" = 'cash'
  AND r."amount" < 0
  AND EXISTS (SELECT 1 FROM "cash_transfers" t WHERE t."from_record_id" = r."id");
--> statement-breakpoint

-- c) Diğer eksi tutarlı kasa kayıtları → aynı kasada mutlak tutarlı gider.
-- d) Kalan tüm kasa kayıtları → aynı kasada aynı tutarlı gelir.
--    Başlık, tarih, detay, not, kişi, para birimi, etiket, ek, bağlantı, liste
--    vb. olduğu gibi kalır. Kasa adı: kaydın kasa adı, yoksa kaynak (eskiden
--    kasa kaydı kasasını `source`'ta taşırdı); kasa bağlantısı (cash_account_id)
--    yoksa aynı adlı kasaya bağlanır.
UPDATE "records" r
SET "kind" = CASE WHEN r."amount" < 0 THEN 'expense' ELSE 'income' END,
    "amount" = abs(r."amount"),
    "cash_account" = x."kasa_name",
    "cash_account_id" = coalesce(
      r."cash_account_id",
      (SELECT ca."id" FROM "cash_accounts" ca WHERE ca."name" = x."kasa_name" LIMIT 1)
    )
FROM (
  SELECT k."id",
         coalesce(
           nullif(k."cash_account", ''),
           nullif(k."source", ''),
           (SELECT ca."name" FROM "cash_accounts" ca WHERE ca."id" = k."cash_account_id"),
           ''
         ) AS "kasa_name"
  FROM "records" k
  WHERE k."kind" = 'cash'
) x
WHERE r."id" = x."id";
--> statement-breakpoint

-- e) Artık yalnız gelir/gider kabul edilir.
ALTER TABLE "records" DROP CONSTRAINT "records_kind_check";
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_kind_check" CHECK ("records"."kind" IN ('income', 'expense'));
