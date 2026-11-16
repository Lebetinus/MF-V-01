// tests/api.test.mjs creates and deletes rows, logs in with fixed test
// credentials and trips login rate limits. It must never run against a real
// database: only a local Postgres whose database name ends in "_test".
// (`npm test` reads .env.test, not .env.local — see README "Test".)
export function assertTestDatabase(databaseUrl = process.env.DATABASE_URL) {
  let url;
  try {
    url = new URL(databaseUrl ?? "");
  } catch {
    throw new Error("Tests need DATABASE_URL pointing at a local *_test database (set it in .env.test).");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!localHost || !dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${dbName}" on "${host}": tests only run on a local database whose name ends in "_test".`,
    );
  }
}
