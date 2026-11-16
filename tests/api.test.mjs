// API integration tests: exercise app/api/** by calling the built worker's
// fetch() directly with real Request objects (same pattern as
// rendered-html.test.mjs / desktop-assets.test.mjs), against the real dev
// Postgres database configured by DATABASE_URL. There is no separate
// DATABASE_URL_TEST instance in this environment (the app's DB role has no
// CREATEDB privilege here) — every test creates clearly-marked rows of its
// own and removes them in an `after` hook instead of relying on database
// isolation. Requires the app to have already been built (`npm run build`)
// and the default seeded accounts (admin/admin123 etc.) to exist —
// `npm test` handles both.
import assert from "node:assert/strict";
import test from "node:test";
import { callWorker } from "./helpers/call-worker.mjs";

// Lets the app trust the x-mfv01-remote-addr header for per-test client
// IPs (see app/api/_lib/rate-limit.ts getClientIp). Never set in production.
process.env.MFV01_TRUST_TEST_IP_HEADER = "1";

// Distinct from any real client IP so the login rate-limit test can trip
// (and clean up) its own IP block without touching unrelated traffic.
const TEST_IP = "203.0.113.250";
const RUN_TAG = `apitest_${Date.now()}`;

let worker;
async function loadWorker() {
  if (worker) return worker;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  ({ default: worker } = await import(workerUrl.href));
  return worker;
}

const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

function cookieFromSetCookie(setCookieHeader) {
  return setCookieHeader ? setCookieHeader.split(";")[0] : null;
}

async function call(method, path, { body, cookie, headers, ip = TEST_IP } = {}) {
  const w = await loadWorker();
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-mfv01-remote-addr": ip,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const response = await callWorker(w, request, env, ctx);
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status, json, cookie: cookieFromSetCookie(response.headers.get("set-cookie")) };
}

let adminCookie;
let testUserId;
let testUsername;
let testUserCookie;
let adminKasaId;
let reporterKasaId;
let reporterUserId;
let reporterCookie;
const createdRecordIds = [];
const createdReportIds = [];

test("auth: rejects a wrong password", async () => {
  const res = await call("POST", "/api/auth/login", { body: { username: "admin", password: "definitely-wrong" } });
  assert.equal(res.status, 401);
});

test("auth: accepts the seeded admin account", async () => {
  const res = await call("POST", "/api/auth/login", { body: { username: "admin", password: "admin123" } });
  assert.equal(res.status, 200);
  assert.equal(res.json.profile.username, "admin");
  assert.equal(res.json.profile.isAdmin, true);
  adminCookie = res.cookie;
  assert.ok(adminCookie);
});

test("auth: /api/auth/session reflects the logged-in user", async () => {
  const res = await call("GET", "/api/auth/session", { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.profile.username, "admin");
});

test("auth: an unauthenticated request is rejected", async () => {
  const res = await call("GET", "/api/records");
  assert.equal(res.status, 401);
});

test("users: admin can create a permission-scoped account", async () => {
  testUsername = `${RUN_TAG}_user`;
  const res = await call("POST", "/api/users", {
    cookie: adminCookie,
    body: {
      username: testUsername,
      password: "ApiTest1234",
      name: "API Test User",
      roleLabel: "Test",
      isAdmin: false,
      permissions: ["cash"],
    },
  });
  assert.equal(res.status, 201);
  testUserId = res.json.user.id;
  assert.deepEqual(res.json.user.permissions, ["cash"]);
});

test("permission matrix: scoped user can reach a permitted page, not an unpermitted one", async () => {
  const login = await call("POST", "/api/auth/login", { body: { username: testUsername, password: "ApiTest1234" } });
  assert.equal(login.status, 200);
  testUserCookie = login.cookie;

  const allowed = await call("GET", "/api/records?kind=cash", { cookie: testUserCookie });
  assert.equal(allowed.status, 200);

  const forbiddenKind = await call("GET", "/api/records?kind=income", { cookie: testUserCookie });
  assert.equal(forbiddenKind.status, 403);

  const forbiddenPage = await call("GET", "/api/notes", { cookie: testUserCookie });
  assert.equal(forbiddenPage.status, 403);

  const forbiddenAdmin = await call("GET", "/api/users", { cookie: testUserCookie });
  assert.equal(forbiddenAdmin.status, 403);
});

test("records: create, partial update, archive, delete", async () => {
  // A kasa is created by its own cash record; income/expense then join it.
  const kasa = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "cash", date: "2026-01-15", source: `${RUN_TAG}_kasa`, amount: 0, currency: "USD" },
  });
  assert.equal(kasa.status, 201);
  createdRecordIds.push(kasa.json.record.id);

  const create = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_income`, amount: 123, currency: "USD", cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(create.status, 201);
  const record = create.json.record;
  createdRecordIds.push(record.id);
  // Income/expense records must name a kasa; it is created on demand.
  assert.equal(record.cashAccount, `${RUN_TAG}_kasa`);
  assert.ok(record.cashAccountId, "the record is linked to a cash_accounts row");
  adminKasaId = record.cashAccountId;

  const noKasa = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_nokasa`, amount: 1, currency: "USD" },
  });
  assert.equal(noKasa.status, 400, "income without a kasa is rejected");

  // Partial update: only amount changes, source must survive untouched.
  const update = await call("PUT", `/api/records/${record.id}`, {
    cookie: adminCookie,
    body: { amount: 456, updatedAt: record.updatedAt },
  });
  assert.equal(update.status, 200);
  assert.equal(update.json.record.amount, 456);
  assert.equal(update.json.record.source, `${RUN_TAG}_income`);
  assert.equal(update.json.archiveEntry.action, "Düzenlendi");

  // Optimistic lock: reusing the now-stale updatedAt must be rejected.
  const staleUpdate = await call("PUT", `/api/records/${record.id}`, {
    cookie: adminCookie,
    body: { amount: 789, updatedAt: record.updatedAt },
  });
  assert.equal(staleUpdate.status, 409);

  const remove = await call("DELETE", `/api/records/${record.id}?reason=test%20cleanup`, { cookie: adminCookie });
  assert.equal(remove.status, 200);
  assert.equal(remove.json.archiveEntry.action, "Silindi");
  createdRecordIds.splice(createdRecordIds.indexOf(record.id), 1);
});

test("records: invalid kind and negative amount are rejected", async () => {
  const badKind = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "bogus", date: "2026-01-15", source: "x", amount: 1 },
  });
  assert.equal(badKind.status, 400);

  const badAmount = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: "x", amount: -1 },
  });
  assert.equal(badAmount.status, 400);
});

test("import: links rows to their kasa, requires one, and enforces the row limit", async () => {
  const res = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: { items: [{ kind: "expense", date: "2026-01-16", source: `${RUN_TAG}_import`, amount: 10, currency: "USD", cashAccount: `${RUN_TAG}_kasa` }] },
  });
  assert.equal(res.status, 201);
  const [imported] = res.json.records;
  createdRecordIds.push(imported.id);
  assert.equal(imported.cashAccount, `${RUN_TAG}_kasa`);

  const noKasa = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: { items: [{ kind: "expense", date: "2026-01-16", source: `${RUN_TAG}_import2`, amount: 10, currency: "USD" }] },
  });
  assert.equal(noKasa.status, 400, "imported income/expense rows must name a kasa");

  const tooMany = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: { items: Array.from({ length: 2001 }, (_, i) => ({ kind: "expense", date: "2026-01-16", source: `row${i}`, amount: 1 })) },
  });
  assert.equal(tooMany.status, 400);

  const badDate = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: { items: [{ kind: "expense", date: "16-01-2026", source: "x", amount: 1 }] },
  });
  assert.equal(badDate.status, 400);
});

test("attachments: active content (SVG/HTML) is rejected, passive files are accepted", async () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`;
  const html = `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;
  for (const data of [svg, html]) {
    const res = await call("POST", "/api/records", {
      cookie: adminCookie,
      body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_att`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa`, attachments: [{ name: "x", data }] },
    });
    assert.equal(res.status, 400, `rejects ${data.slice(0, 25)}`);
  }
  const xlsx = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBA==";
  const ok = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_att`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa`, attachments: [{ name: "x.xlsx", data: xlsx }] },
  });
  assert.equal(ok.status, 201, "office documents are still accepted");
  createdRecordIds.push(ok.json.record.id);
});

test("prepared reports: a user only sees and edits reports of kasas they can access", async () => {
  const created = await call("POST", "/api/users", {
    cookie: adminCookie,
    body: { username: `${RUN_TAG}_rep`, password: "ApiTest1234", name: "Reporter", roleLabel: "Test", isAdmin: false, permissions: ["reportBuilder", "cash", "expense"] },
  });
  assert.equal(created.status, 201);
  reporterUserId = created.json.user.id;
  reporterCookie = (await call("POST", "/api/auth/login", { body: { username: `${RUN_TAG}_rep`, password: "ApiTest1234" } })).cookie;
  assert.ok(reporterCookie);

  const report = await call("POST", "/api/prepared-reports", {
    cookie: adminCookie,
    body: { date: "2026-01-15", title: `${RUN_TAG}_report`, cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(report.status, 201);
  const reportId = report.json.preparedReport.id;
  createdReportIds.push(reportId);

  const list = await call("GET", "/api/prepared-reports", { cookie: reporterCookie });
  assert.equal(list.status, 200);
  assert.ok(!list.json.preparedReports.some((r) => r.id === reportId), "hidden from a user without access to its kasa");

  const edit = await call("PUT", `/api/prepared-reports/${encodeURIComponent(reportId)}`, {
    cookie: reporterCookie,
    body: { date: "2026-01-15", title: "hijacked", cashAccount: "" },
  });
  assert.equal(edit.status, 404);
  const del = await call("DELETE", `/api/prepared-reports/${encodeURIComponent(reportId)}`, { cookie: reporterCookie });
  assert.equal(del.status, 404);

  const forOtherKasa = await call("POST", "/api/prepared-reports", {
    cookie: reporterCookie,
    body: { date: "2026-01-15", title: `${RUN_TAG}_report2`, cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(forOtherKasa.status, 403, "cannot file a report under someone else's kasa");
});

test("debts: the counter kasa must be one the user can access", async () => {
  const ownKasa = await call("POST", "/api/records", {
    cookie: reporterCookie,
    body: { kind: "cash", date: "2026-01-15", source: `${RUN_TAG}_repkasa`, amount: 0, currency: "USD" },
  });
  assert.equal(ownKasa.status, 201);
  reporterKasaId = ownKasa.json.record.cashAccountId;
  createdRecordIds.push(ownKasa.json.record.id);

  const res = await call("POST", "/api/records", {
    cookie: reporterCookie,
    body: {
      kind: "expense", date: "2026-01-15", source: `${RUN_TAG}_debt`, amount: 5, currency: "USD",
      cashAccount: `${RUN_TAG}_repkasa`, debtMode: "lent", debtCashAccountId: adminKasaId,
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json?.error ?? "", /erişim/);
});

test("database: import/clear need a super admin and the password, checked on the server", async () => {
  const notSuper = await call("POST", "/api/database/clear", { cookie: testUserCookie, body: { password: "ApiTest1234" } });
  assert.equal(notSuper.status, 403);
  const exportNotSuper = await call("GET", "/api/database/export", { cookie: reporterCookie });
  assert.equal(exportNotSuper.status, 403);

  const noPassword = await call("POST", "/api/database/clear", { cookie: adminCookie, body: {} });
  assert.equal(noPassword.status, 400);
  const wrongPassword = await call("POST", "/api/database/clear", { cookie: adminCookie, body: { password: "definitely-wrong" } });
  assert.equal(wrongPassword.status, 403);
  const importWrong = await call("POST", "/api/database/import", { cookie: adminCookie, body: { records: [], confirmPassword: "definitely-wrong" } });
  assert.equal(importWrong.status, 403);

  // Nothing was wiped: the admin's test record is still there.
  const records = await call("GET", "/api/records", { cookie: adminCookie });
  assert.ok(records.json.records.some((r) => createdRecordIds.includes(r.id)));
});

test("auth: repeated failed logins block the offending IP", async () => {
  const rateLimitIp = "203.0.113.251";
  const attempts = [];
  for (let i = 0; i < 5; i++) {
    const res = await call("POST", "/api/auth/login", {
      ip: rateLimitIp,
      body: { username: `${RUN_TAG}_nonexistent`, password: `wrong${i}` },
    });
    attempts.push(res.status);
  }
  assert.deepEqual(attempts.slice(0, 4), [401, 401, 401, 401]);
  assert.equal(attempts[4], 403);

  // Even a correct login from the now-blocked IP must be rejected.
  const stillBlocked = await call("POST", "/api/auth/login", {
    ip: rateLimitIp,
    body: { username: "admin", password: "admin123" },
  });
  assert.equal(stillBlocked.status, 403);

  const unblock = await call("DELETE", `/api/admin/blocked-ips/${encodeURIComponent(rateLimitIp)}`, { cookie: adminCookie });
  assert.equal(unblock.status, 200);
});

test("auth: failed logins without a known client IP are throttled, never turned into a shared block", async () => {
  // ip "" → no x-mfv01-remote-addr → the shared "unknown" bucket. Blocking
  // it would lock every user out at once, so it must answer 429 instead.
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const res = await call("POST", "/api/auth/login", { ip: "", body: { username: `${RUN_TAG}_ghost${i}`, password: "wrong" } });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
  assert.ok(statuses.slice(4).every((s) => s === 429), `got ${statuses}`);
  const blocked = await call("GET", "/api/admin/blocked-ips", { cookie: adminCookie });
  assert.equal(blocked.status, 200);
  assert.ok(!JSON.stringify(blocked.json).includes('"unknown"'), "the unknown bucket is not persisted as a block");
});

test.after(async () => {
  for (const id of createdRecordIds) {
    await call("DELETE", `/api/records/${id}`, { cookie: adminCookie }).catch(() => {});
  }
  for (const id of createdReportIds) {
    await call("DELETE", `/api/prepared-reports/${encodeURIComponent(id)}`, { cookie: adminCookie }).catch(() => {});
  }
  if (reporterUserId) {
    await call("DELETE", `/api/users/${reporterUserId}`, { cookie: adminCookie }).catch(() => {});
  }
  for (const kasaId of [adminKasaId, reporterKasaId]) {
    if (kasaId) await call("DELETE", `/api/cash-accounts/${kasaId}`, { cookie: adminCookie }).catch(() => {});
  }
  if (testUserId) {
    await call("DELETE", `/api/users/${testUserId}`, { cookie: adminCookie }).catch(() => {});
  }
  await call("DELETE", `/api/admin/blocked-ips/${encodeURIComponent(TEST_IP)}`, { cookie: adminCookie }).catch(() => {});
});
