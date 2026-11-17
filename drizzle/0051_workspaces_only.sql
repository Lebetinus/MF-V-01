-- 0051: Hazır çalışma alanları ("Diğer", "Liste Kasaları", "RJ-Kasaları") ve Listeler
-- özelliği kaldırılıyor. Bundan sonra kasalar yalnızca yöneticinin oluşturduğu çalışma
-- alanlarında (kasa_sections, scope=cash) ve onların bölümlerinde gruplanır.
--
-- a) Hazır alanlardaki kasalar, aynı adla oluşturulan normal çalışma alanlarına taşınır;
--    hazır alanın altındaki bölümler yeni alanın bölümü olur, Kasa Kontrol Merkezi
--    sıralaması korunur. Böylece ekranda hiçbir kasa yer değiştirmez.
DO $$
DECLARE
  g record;
  member_ids integer[];
  new_id integer;
  old_order jsonb;
  created jsonb := '[]'::jsonb;
BEGIN
  SELECT coalesce(s."cash_workspace_order", '[]'::jsonb) INTO old_order FROM "settings" s ORDER BY s."id" LIMIT 1;
  old_order := coalesce(old_order, '[]'::jsonb);

  FOR g IN
    SELECT * FROM (VALUES
      ('genel', 'Diğer', '#315fe8'),
      ('liste', 'Liste Kasaları', '#b9951c'),
      ('rj', 'RJ-Kasaları', '#7b52bf')
    ) AS v(key, name, color)
  LOOP
    -- Geçerli bir kasa çalışma alanında olmayan ve (uygulamadaki öncelikle: Liste > RJ > Diğer)
    -- bu hazır alanda görünen kasalar.
    SELECT coalesce(array_agg(ca."id"), '{}') INTO member_ids
    FROM "cash_accounts" ca
    WHERE (ca."section_id" IS NULL OR ca."section_id" NOT IN (SELECT ks."id" FROM "kasa_sections" ks WHERE ks."scope" = 'cash'))
      AND CASE g.key
        WHEN 'genel' THEN NOT ca."is_list_workspace" AND NOT ca."is_rj_kasa"
        WHEN 'liste' THEN ca."is_list_workspace"
        ELSE NOT ca."is_list_workspace" AND ca."is_rj_kasa"
      END;
    IF cardinality(member_ids) > 0 OR EXISTS (SELECT 1 FROM "kasa_sections" WHERE "scope" = 'cash' AND "parent_key" = g.key) THEN
      new_id := NULL;
      SELECT ks."id" INTO new_id FROM "kasa_sections" ks WHERE ks."scope" = 'cash' AND ks."name" = g.name AND ks."parent_key" IS NULL LIMIT 1;
      IF new_id IS NULL THEN
        INSERT INTO "kasa_sections" ("scope", "name", "color", "parent_key", "sort_order")
        VALUES (
          'cash',
          CASE WHEN EXISTS (SELECT 1 FROM "kasa_sections" WHERE "scope" = 'cash' AND "name" = g.name) THEN g.name || ' (kasalar)' ELSE g.name END,
          g.color, NULL, 0)
        RETURNING "id" INTO new_id;
      END IF;
      UPDATE "cash_accounts" SET "section_id" = new_id WHERE "id" = ANY(member_ids);
      UPDATE "kasa_sections" SET "parent_key" = 'sec-' || new_id WHERE "scope" = 'cash' AND "parent_key" = g.key;
      old_order := (
        SELECT coalesce(jsonb_agg(CASE WHEN e.v = g.key THEN 'sec-' || new_id ELSE e.v END ORDER BY e.n), '[]'::jsonb)
        FROM jsonb_array_elements_text(old_order) WITH ORDINALITY AS e(v, n)
      );
      created := created || to_jsonb('sec-' || new_id);
    END IF;
  END LOOP;

  -- Sıralama: kayıtlı bir sıra varsa hazır alan anahtarları yeni alanlarla değişti; yoksa
  -- ekrandaki eski sıra (önce hazır alanlar, sonra diğerleri) yazılır.
  IF jsonb_array_length(old_order) = 0 THEN
    old_order := created || coalesce((
      SELECT jsonb_agg('sec-' || ks."id" ORDER BY ks."sort_order", ks."id")
      FROM "kasa_sections" ks
      WHERE ks."scope" = 'cash' AND ks."parent_key" IS NULL AND NOT (created ? ('sec-' || ks."id"))
    ), '[]'::jsonb);
  ELSE
    old_order := (
      SELECT coalesce(jsonb_agg(e.v ORDER BY e.n), '[]'::jsonb)
      FROM jsonb_array_elements_text(old_order) WITH ORDINALITY AS e(v, n)
      WHERE e.v NOT IN ('genel', 'liste', 'rj')
    );
  END IF;
  UPDATE "settings" SET "cash_workspace_order" = old_order;
  -- Alan listesi (sections API: sort_order, id) her ekranda bu sırayla gelsin.
  UPDATE "kasa_sections" ks SET "sort_order" = e.n
  FROM jsonb_array_elements_text(old_order) WITH ORDINALITY AS e(v, n)
  WHERE ks."scope" = 'cash' AND ks."parent_key" IS NULL AND e.v = 'sec-' || ks."id";
END $$;
--> statement-breakpoint

-- b) Bir bölüm yalnızca bir kasa çalışma alanının içinde olabilir: kalan eski anahtarlar temizlenir.
UPDATE "kasa_sections" SET "parent_key" = NULL
WHERE "parent_key" IS NOT NULL AND "parent_key" !~ '^sec-[0-9]+$';
--> statement-breakpoint

-- c) Listeler sayfası kaldırıldı: yetki listelerinden de çıkar.
UPDATE "users" SET "permissions" = "permissions" - 'lists' WHERE "permissions" ? 'lists';
--> statement-breakpoint

-- d) Listeler özelliğinin tabloları ve sütunları.
DROP TABLE "expense_allocations" CASCADE;--> statement-breakpoint
DROP TABLE "list_allocations" CASCADE;--> statement-breakpoint
DROP TABLE "list_items" CASCADE;--> statement-breakpoint
DROP TABLE "list_workspaces" CASCADE;--> statement-breakpoint
DROP TABLE "lists" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_distributions" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_recipients" CASCADE;--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT IF EXISTS "records_list_id_lists_id_fk";--> statement-breakpoint
ALTER TABLE "cash_accounts" DROP COLUMN "is_list_workspace";--> statement-breakpoint
ALTER TABLE "cash_accounts" DROP COLUMN "is_rj_kasa";--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "list_name";--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "list_id";
