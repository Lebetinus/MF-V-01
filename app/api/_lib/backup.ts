import { gunzipSync, gzipSync } from "node:zlib";
import type { PoolClient } from "pg";
import { getPool } from "../../../db";

// Tam veritabanı yedeği (Ayarlar > Veri). public şemadaki her tablo — kullanıcılar,
// kasalar, kayıtlar (ekleriyle), listeler, aktarımlar, notlar, yorumlar, günlük,
// ayarlar — tek bir JSON belgesine yazılır ve gzip ile sıkıştırılır. Tablolar
// şemadan okunur: yeni bir migration tablo eklerse yedek onu kendiliğinden kapsar.
//
// Satırlar Postgres'in kendi JSON çıktısıyla (json_agg) yazılıp
// jsonb_populate_recordset ile geri okunur; tutarlar, tarihler ve jsonb alanları
// JavaScript sayılarına dönüşmeden, birebir korunur.
//
// Yedek yalnız aynı şema sürümüne (aynı migration seviyesine) geri yüklenir: başka
// bir sürümün sütunları sessizce boş kalabilirdi.

export const BACKUP_FORMAT = "mfv01-db-backup";
export const BACKUP_VERSION = 1;

// Oturumlar yedeğe girmez. Geri yüklemeden sonra tablo boş kalır ve herkes
// (geri yükleyen dahil) yeniden giriş yapar.
const SKIPPED_TABLES = new Set(["sessions"]);

// Açılmış (gzip'siz) yedeğin üst sınırı; bozuk ya da kötü niyetli bir dosyanın
// sunucunun belleğini doldurmasını önler.
const MAX_JSON_BYTES = 1024 * 1024 * 1024;

export class BackupError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function schemaVersion(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ n: number; last: string }>(
    `SELECT count(*)::int AS n, coalesce(max(created_at), 0)::text AS last FROM drizzle.__drizzle_migrations`,
  );
  return `${rows[0].n}:${rows[0].last}`;
}

async function publicTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((r) => r.name);
}

// Yabancı anahtarlara göre ekleme sırası: önce başvurulan (üst) tablolar.
async function insertOrder(client: PoolClient, tables: string[]): Promise<string[]> {
  const { rows } = await client.query<{ child: string; parent: string }>(
    `SELECT c.relname AS child, p.relname AS parent
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_class p ON p.oid = k.confrelid
      WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`,
  );
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of rows) {
    if (child !== parent && parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p)));
    if (!ready.length) throw new Error("Foreign key cycle between tables; cannot order the restore");
    for (const t of ready) {
      ordered.push(t);
      done.add(t);
    }
  }
  return ordered;
}

export async function createBackup(): Promise<{ body: Buffer; exportedAt: string; tables: number }> {
  const client = await getPool().connect();
  try {
    // Tek bir anlık görüntü: yedek alınırken yapılan yazmalar tablolar arasında
    // tutarsızlık yaratmaz.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const schema = await schemaVersion(client);
    const tables = (await publicTables(client)).filter((t) => !SKIPPED_TABLES.has(t));
    const parts: string[] = [];
    for (const table of tables) {
      const { rows } = await client.query<{ data: string }>(
        `SELECT coalesce(json_agg(t), '[]'::json)::text AS data FROM ${ident(table)} t`,
      );
      parts.push(`${JSON.stringify(table)}:${rows[0].data}`);
    }
    await client.query("COMMIT");
    const exportedAt = new Date().toISOString();
    const header = `"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"schema":${JSON.stringify(schema)},"exportedAt":${JSON.stringify(exportedAt)}`;
    const text = `{${header},"tables":{${parts.join(",")}}}`;
    return { body: gzipSync(text), exportedAt, tables: tables.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function decode(raw: Buffer): string {
  const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  try {
    const bytes = gzipped ? gunzipSync(raw, { maxOutputLength: MAX_JSON_BYTES }) : raw;
    if (bytes.length > MAX_JSON_BYTES) throw new Error("too large");
    return bytes.toString("utf8");
  } catch {
    throw new BackupError("Yedek dosyası açılamadı. Bu uygulamadan alınmış bir yedek seçin.", "bad_file");
  }
}

// Mevcut TÜM veriyi yedektekiyle değiştirir. Tek transaction: herhangi bir adım
// başarısız olursa veritabanı olduğu gibi kalır.
export async function restoreBackup(
  raw: Buffer,
  actor: { id: number; name: string },
): Promise<{ tables: number; rows: number; exportedAt: string | null }> {
  const text = decode(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mfv01:restore'))");
    await client.query("CREATE TEMP TABLE mfv01_restore (doc jsonb) ON COMMIT DROP");
    try {
      await client.query("INSERT INTO mfv01_restore VALUES ($1::jsonb)", [text]);
    } catch {
      throw new BackupError("Yedek dosyası okunamadı (geçerli JSON değil).", "bad_file");
    }

    const { rows: metaRows } = await client.query<{
      format: string | null;
      version: string | null;
      schema: string | null;
      exportedAt: string | null;
      tablesType: string | null;
    }>(
      `SELECT doc->>'format' AS format, doc->>'version' AS version, doc->>'schema' AS schema,
              doc->>'exportedAt' AS "exportedAt", jsonb_typeof(doc->'tables') AS "tablesType"
         FROM mfv01_restore`,
    );
    const meta = metaRows[0];
    if (meta.format !== BACKUP_FORMAT || meta.tablesType !== "object") {
      throw new BackupError("Bu dosya bir veritabanı yedeği değil.", "bad_file");
    }
    if (meta.version !== String(BACKUP_VERSION)) {
      throw new BackupError("Bu yedeğin biçimi desteklenmiyor.", "bad_version");
    }
    const current = await schemaVersion(client);
    if (meta.schema !== current) {
      throw new BackupError(
        `Bu yedek uygulamanın farklı bir sürümünden alınmış (yedek şeması ${meta.schema ?? "?"}, mevcut ${current}). Aynı sürümde alınmış bir yedek seçin.`,
        "schema_mismatch",
      );
    }

    const allTables = await publicTables(client);
    const tables = allTables.filter((t) => !SKIPPED_TABLES.has(t));
    const { rows: keyRows } = await client.query<{ key: string; type: string }>(
      `SELECT key, jsonb_typeof(value) AS type FROM mfv01_restore, jsonb_each(doc->'tables')`,
    );
    const inFile = new Map(keyRows.map((r) => [r.key, r.type]));
    const missing = tables.filter((t) => inFile.get(t) !== "array");
    const unknown = [...inFile.keys()].filter((k) => !tables.includes(k));
    if (missing.length || unknown.length) {
      throw new BackupError(
        `Yedekteki tablolar bu veritabanıyla uyuşmuyor${missing.length ? ` (eksik: ${missing.join(", ")})` : ""}${unknown.length ? ` (fazla: ${unknown.join(", ")})` : ""}.`,
        "schema_mismatch",
      );
    }

    // Oturumlar dahil her şey silinir; kimlik sayaçları aşağıda yeniden ayarlanır.
    await client.query(`TRUNCATE ${allTables.map(ident).join(", ")} RESTART IDENTITY CASCADE`);

    let rowCount = 0;
    for (const table of await insertOrder(client, tables)) {
      const result = await client.query(
        `INSERT INTO ${ident(table)} OVERRIDING SYSTEM VALUE
         SELECT * FROM jsonb_populate_recordset(NULL::${ident(table)}, (SELECT doc->'tables'->$1 FROM mfv01_restore))`,
        [table],
      );
      rowCount += result.rowCount ?? 0;
    }

    // serial/identity sütunlarının sayaçları yedekteki en büyük değerin ardına alınır;
    // yoksa ilk yeni kayıt mevcut bir id ile çakışırdı.
    const { rows: seqRows } = await client.query<{ table_name: string; column_name: string; seq: string | null }>(
      `SELECT table_name, column_name, pg_get_serial_sequence(quote_ident(table_name), column_name) AS seq
         FROM information_schema.columns
        WHERE table_schema = 'public' AND (column_default LIKE 'nextval%' OR is_identity = 'YES')`,
    );
    for (const { table_name, column_name, seq } of seqRows) {
      if (!seq) continue;
      await client.query(
        `SELECT setval($1, coalesce((SELECT max(${ident(column_name)}) FROM ${ident(table_name)}), 0) + 1, false)`,
        [seq],
      );
    }

    await client.query(
      `INSERT INTO activity_log (user_id, user_name, category, action, summary) VALUES ($1, $2, 'other', 'restore', $3)`,
      [
        actor.id,
        actor.name,
        `Veritabanı yedekten geri yüklendi (${meta.exportedAt ? `yedek tarihi ${meta.exportedAt}` : "tarihsiz yedek"}, ${rowCount} satır)`.slice(0, 500),
      ],
    );

    await client.query("COMMIT");
    return { tables: tables.length, rows: rowCount, exportedAt: meta.exportedAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
