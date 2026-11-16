// Creates (or resets) the fixed super admin account tests/api.test.mjs logs
// in with (admin / admin123) — in a *_test database only.
//   node --env-file=.env.test tests/helpers/seed-test-admin.mjs
// Run once after migrating a fresh test database (CI does this every run).
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { assertTestDatabase } from "./test-db-guard.mjs";

assertTestDatabase();

const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${(await promisify(scrypt)("admin123", salt, 64)).toString("hex")}`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    `INSERT INTO users (username, password_hash, name, role_label, is_admin, is_super_admin, permissions)
     VALUES ('admin', $1, 'Admin', 'Yönetici', true, true, '[]')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true, is_super_admin = true, locked = false`,
    [hash],
  );
  console.log("Test admin ready (admin / admin123).");
} finally {
  await client.end();
}
