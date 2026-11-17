-- Gelir/Gider bölümleri kaldırıldı: yalnız kasa çalışma alanları/bölümleri (scope=cash) kalır.
-- Kayıtların bölüm bağı (records.section_id) silinir; kayıtların kendisi olduğu gibi kalır.
ALTER TABLE "kasa_sections" DROP CONSTRAINT "kasa_sections_scope_check";--> statement-breakpoint
DELETE FROM "kasa_sections" WHERE "scope" <> 'cash';--> statement-breakpoint
ALTER TABLE "kasa_sections" ALTER COLUMN "scope" SET DEFAULT 'cash';--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "section_id";--> statement-breakpoint
ALTER TABLE "kasa_sections" ADD CONSTRAINT "kasa_sections_scope_check" CHECK ("kasa_sections"."scope" = 'cash');
