// API integration tests: exercise app/api/** by calling the built worker's
// fetch() directly with real Request objects (same pattern as
// rendered-html.test.mjs / build-assets.test.mjs), against a dedicated
// local test database (DATABASE_URL from .env.test; name must end in
// "_test", enforced below). Every test creates clearly-marked rows of its
// own and removes them in an `after` hook. Requires the app to have been
// built (`npm test` does that) and the test admin (admin/admin123) to exist:
// `node --env-file=.env.test tests/helpers/seed-test-admin.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { callWorker } from "./helpers/call-worker.mjs";
import { assertTestDatabase } from "./helpers/test-db-guard.mjs";

// Never touch a real database (see helpers/test-db-guard.mjs).
assertTestDatabase();

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

// Like call(), but returns the raw Response (status, headers, body untouched).
async function callRaw(method, path, { cookie, headers } = {}) {
  const w = await loadWorker();
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { "x-mfv01-remote-addr": TEST_IP, ...(cookie ? { cookie } : {}), ...headers },
  });
  return callWorker(w, request, env, ctx);
}

// multipart/form-data POST (file uploads); `files` maps field → { bytes, name }.
async function callForm(path, { cookie, fields = {}, files = {} } = {}) {
  const w = await loadWorker();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, f] of Object.entries(files)) form.append(k, new Blob([f.bytes]), f.name);
  const request = new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "x-mfv01-remote-addr": TEST_IP, ...(cookie ? { cookie } : {}) },
    body: form,
  });
  const response = await callWorker(w, request, env, ctx);
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status, json };
}

let adminCookie;
let testUserId;
let testUsername;
let testUserCookie;
let adminKasaId;
let reporterUserId;
let reporterCookie;
const createdRecordIds = [];
const createdReportIds = [];
const extraKasaIds = [];
// Her kasa bir çalışma alanında açılır: testlerin kasaları bu alana konur.
let testWsId;

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

  // The "cash" permission opens Kasa Kontrol Merkezi (its kasa endpoints), not record kinds of its own.
  const kasas = await call("GET", "/api/cash-accounts", { cookie: testUserCookie });
  assert.equal(kasas.status, 200);
  assert.ok(Array.isArray(kasas.json.cashAccounts));
  const transfers = await call("GET", "/api/cash-transfers", { cookie: testUserCookie });
  assert.equal(transfers.status, 200);

  // There is no "cash" record kind any more.
  const noCashKind = await call("GET", "/api/records?kind=cash", { cookie: testUserCookie });
  assert.equal(noCashKind.status, 400);

  // Income/expense records stay gated by their own permissions.
  const forbiddenKind = await call("GET", "/api/records?kind=income", { cookie: testUserCookie });
  assert.equal(forbiddenKind.status, 403);
  const all = await call("GET", "/api/records", { cookie: testUserCookie });
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.records, [], "no income/expense permission → no records");

  const forbiddenPage = await call("GET", "/api/notes", { cookie: testUserCookie });
  assert.equal(forbiddenPage.status, 403);

  const forbiddenAdmin = await call("GET", "/api/users", { cookie: testUserCookie });
  assert.equal(forbiddenAdmin.status, 403);
});

test("records: create, partial update, archive, delete", async () => {
  const ws = await call("POST", "/api/sections", { cookie: adminCookie, body: { scope: "cash", name: `${RUN_TAG}_ws` } });
  assert.equal(ws.status, 201);
  testWsId = ws.json.section.id;
  // A kasa is created on its own (Yeni Kasa) inside a workspace; income/expense then join it.
  const kasa = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { name: `${RUN_TAG}_kasa`, sectionId: testWsId } });
  assert.equal(kasa.status, 201);
  adminKasaId = kasa.json.cashAccount.id;
  assert.equal(kasa.json.record, null, "no opening balance → no record");

  const create = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_income`, amount: 123, currency: "USD", cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(create.status, 201);
  const record = create.json.record;
  createdRecordIds.push(record.id);
  // Income/expense records must name an existing kasa and are linked to it.
  assert.equal(record.cashAccount, `${RUN_TAG}_kasa`);
  assert.equal(record.cashAccountId, adminKasaId, "the record is linked to the kasa's cash_accounts row");

  const unknownKasa = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_x`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_nosuchkasa` },
  });
  assert.equal(unknownKasa.status, 403, "naming a kasa no longer creates it");

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

  // The old "kasa kaydı" kind is gone: every record is income or expense.
  const cashKind = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "cash", date: "2026-01-15", source: `${RUN_TAG}_kasa`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(cashKind.status, 400);

  const badAmount = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: "x", amount: -1 },
  });
  assert.equal(badAmount.status, 400);
});

test("import: a legacy kasa-record row lands as income (negative → expense) in the kasa named by its source", async () => {
  const name = `${RUN_TAG}_legacy`;
  const res = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: {
      items: [
        { kind: "cash", date: "2026-01-10", source: name, amount: 75, currency: "USD" },
        { kind: "cash", date: "2026-01-11", source: name, amount: -20, currency: "USD" },
      ],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const [opening, out] = res.json.records;
  createdRecordIds.push(opening.id, out.id);
  if (opening.cashAccountId) extraKasaIds.push(opening.cashAccountId);
  assert.equal(opening.kind, "income");
  assert.equal(opening.amount, 75);
  assert.equal(opening.cashAccount, name);
  assert.ok(opening.cashAccountId, "the kasa was opened and linked");
  assert.equal(out.kind, "expense");
  assert.equal(out.amount, 20);
  assert.equal(out.cashAccountId, opening.cashAccountId);
  assert.equal(await kasaBalance(opening.cashAccountId), 55);

  const negativeIncome = await call("POST", "/api/records/import", {
    cookie: adminCookie,
    body: { items: [{ kind: "income", date: "2026-01-12", source: "x", amount: -1, currency: "USD", cashAccount: name }] },
  });
  assert.equal(negativeIncome.status, 400, "negative amounts are only accepted on legacy kasa rows");
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

test("attachments: lists carry only names and sizes; contents load per file and survive an edit by ref", async () => {
  const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 api test").toString("base64")}`;
  const pdf2 = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 second").toString("base64")}`;
  const created = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "expense", date: "2026-01-15", source: `${RUN_TAG}_slim`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa`, attachments: [{ name: "a.pdf", data: pdf }] },
  });
  assert.equal(created.status, 201);
  const record = created.json.record;
  createdRecordIds.push(record.id);

  const list = await call("GET", "/api/records", { cookie: adminCookie });
  const listed = list.json.records.find((r) => r.id === record.id);
  assert.deepEqual(listed.attachments, [{ name: "a.pdf", data: "", size: Buffer.from("%PDF-1.4 api test").length, ref: 0 }]);

  const boot = await call("GET", "/api/bootstrap", { cookie: adminCookie });
  assert.equal(boot.status, 200);
  assert.equal(boot.json.archive, undefined, "the archive is loaded by the Arşiv page, not bootstrap");
  assert.equal(boot.json.records.find((r) => r.id === record.id).attachments[0].data, "");

  const file = await call("GET", `/api/records/${record.id}/attachments/0`, { cookie: adminCookie });
  assert.equal(file.status, 200);
  assert.deepEqual(file.json.attachment, { name: "a.pdf", data: pdf });
  assert.equal((await call("GET", `/api/records/${record.id}/attachments/1`, { cookie: adminCookie })).status, 404);
  // Same rules as the list: kind permission and access to the record's kasa.
  assert.equal((await call("GET", `/api/records/${record.id}/attachments/0`, { cookie: testUserCookie })).status, 403, "no expense permission");
  assert.equal((await call("GET", `/api/records/${record.id}/attachments/0`, { cookie: reporterCookie })).status, 403, "no access to the kasa");

  // Editing keeps the unchanged file by ref and adds a new one with its contents.
  const edited = await call("PUT", `/api/records/${record.id}`, {
    cookie: adminCookie,
    body: { note: "edited", updatedAt: record.updatedAt, attachments: [{ name: "b.pdf", data: pdf2 }, { ...listed.attachments[0] }] },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.json.record.attachments, [{ name: "b.pdf", data: pdf2 }, { name: "a.pdf", data: pdf }]);
  assert.equal(edited.json.archiveEntry.old.attachments[0].data, "", "archive snapshots carry no file contents");

  const archived = await call("GET", "/api/archive", { cookie: adminCookie });
  const snapshot = archived.json.archive.find((a) => a.id === edited.json.archiveEntry.id);
  assert.deepEqual(snapshot.old.attachments, [{ name: "a.pdf", data: "", size: Buffer.from("%PDF-1.4 api test").length, ref: 0 }]);

  const staleRef = await call("PUT", `/api/records/${record.id}`, { cookie: adminCookie, body: { attachments: [{ name: "x.pdf", ref: 4 }] } });
  assert.equal(staleRef.status, 409, "a ref to a file the record no longer has is rejected");
  const noContent = await call("PUT", `/api/records/${record.id}`, { cookie: adminCookie, body: { attachments: [{ name: "x.pdf", data: "" }] } });
  assert.equal(noContent.status, 400, "a file needs either contents or a ref");
  const svgByRef = await call("PUT", `/api/records/${record.id}`, {
    cookie: adminCookie,
    body: { attachments: [{ name: "x.svg", data: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` }] },
  });
  assert.equal(svgByRef.status, 400, "new contents are still checked");
});

test("database: import/clear need a super admin and the password, checked on the server", async () => {
  const notSuper = await call("POST", "/api/database/clear", { cookie: testUserCookie, body: { password: "ApiTest1234" } });
  assert.equal(notSuper.status, 403);
  const backupNotSuper = await call("POST", "/api/database/backup", { cookie: reporterCookie, body: { password: "ApiTest1234" } });
  assert.equal(backupNotSuper.status, 403);
  const restoreNotSuper = await callForm("/api/database/restore", { cookie: reporterCookie, fields: { password: "ApiTest1234" } });
  assert.equal(restoreNotSuper.status, 403);

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

async function makeKasa(name, openingAmount = 0) {
  const res = await call("POST", "/api/cash-accounts", {
    cookie: adminCookie,
    body: { sectionId: testWsId, name, openingAmount, currency: "USD", date: "2026-01-15" },
  });
  assert.equal(res.status, 201, `create kasa ${name}`);
  extraKasaIds.push(res.json.cashAccount.id);
  if (res.json.record) createdRecordIds.push(res.json.record.id);
  return res.json.cashAccount.id;
}

// A kasa's balance = its income − its expense records (transfer and debt legs included).
async function kasaBalance(kasaId) {
  const res = await call("GET", "/api/records", { cookie: adminCookie });
  return res.json.records
    .filter((r) => r.cashAccountId === kasaId)
    .reduce((t, r) => t + (r.kind === "income" ? r.amount : -r.amount), 0);
}

test("cash accounts: Yeni Kasa with an opening balance writes one income record", async () => {
  const name = `${RUN_TAG}_opening`;
  const res = await call("POST", "/api/cash-accounts", {
    cookie: adminCookie,
    body: { sectionId: testWsId, name, openingAmount: 250, currency: "USD", date: "2026-02-01" },
  });
  assert.equal(res.status, 201);
  const kasaId = res.json.cashAccount.id;
  extraKasaIds.push(kasaId);
  assert.equal(res.json.cashAccount.name, name);
  assert.ok(res.json.record, "opening income record returned");
  createdRecordIds.push(res.json.record.id);

  const records = (await call("GET", "/api/records", { cookie: adminCookie })).json.records.filter((r) => r.cashAccountId === kasaId);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "income");
  assert.equal(records[0].source, "Açılış bakiyesi");
  assert.equal(records[0].amount, 250);
  assert.equal(records[0].date, "2026-02-01");
  assert.equal(records[0].cashAccount, name);
  assert.equal(await kasaBalance(kasaId), 250);

  // The kasa is listed for its creator.
  const list = await call("GET", "/api/cash-accounts", { cookie: adminCookie });
  assert.ok(list.json.cashAccounts.some((a) => a.id === kasaId));
});

test("cash accounts: a duplicate kasa name is rejected with 409", async () => {
  await makeKasa(`${RUN_TAG}_dup`);
  const again = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { sectionId: testWsId, name: `${RUN_TAG}_dup` } });
  assert.equal(again.status, 409);
  assert.match(again.json?.error ?? "", /zaten var/);
  const blank = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { sectionId: testWsId, name: "   " } });
  assert.equal(blank.status, 400);
});

test("cash accounts: a user without the Kasa Kontrol Merkezi permission cannot open a kasa", async () => {
  const created = await call("POST", "/api/users", {
    cookie: adminCookie,
    body: { username: `${RUN_TAG}_nokasa`, password: "ApiTest1234", name: "No Kasa", roleLabel: "Test", isAdmin: false, permissions: ["income"] },
  });
  assert.equal(created.status, 201);
  const cookie = (await call("POST", "/api/auth/login", { body: { username: `${RUN_TAG}_nokasa`, password: "ApiTest1234" } })).cookie;
  const res = await call("POST", "/api/cash-accounts", { cookie, body: { sectionId: testWsId, name: `${RUN_TAG}_nokasa_kasa` } });
  assert.equal(res.status, 403);
  assert.equal((await call("DELETE", `/api/users/${created.json.user.id}`, { cookie: adminCookie })).status, 200);
});

test("cash accounts: only the owner shares a kasa; a user it was shared with cannot share it on", async () => {
  const make = async (suffix) => {
    const res = await call("POST", "/api/users", {
      cookie: adminCookie,
      body: { username: `${RUN_TAG}_${suffix}`, password: "ApiTest1234", name: suffix, roleLabel: "Test", isAdmin: false, permissions: ["cash", "income", "expense"] },
    });
    assert.equal(res.status, 201);
    const cookie = (await call("POST", "/api/auth/login", { body: { username: `${RUN_TAG}_${suffix}`, password: "ApiTest1234" } })).cookie;
    return { id: res.json.user.id, cookie };
  };
  const owner = await make("shareOwner");
  const viewer = await make("shareViewer");
  const third = await make("shareThird");
  try {
    const kasa = await call("POST", "/api/cash-accounts", { cookie: owner.cookie, body: { sectionId: testWsId, name: `${RUN_TAG}_sharedKasa` } });
    assert.equal(kasa.status, 201);
    const kasaId = kasa.json.cashAccount.id;
    extraKasaIds.push(kasaId);

    assert.equal((await call("POST", `/api/cash-accounts/${kasaId}/access`, { cookie: owner.cookie, body: { userId: viewer.id } })).status, 201);
    const seen = await call("GET", "/api/cash-accounts", { cookie: viewer.cookie });
    assert.ok(seen.json.cashAccounts.some((a) => a.id === kasaId), "the viewer sees the shared kasa");

    // The viewer can neither share it further, nor remove anyone, nor toggle its dashboard share.
    assert.equal((await call("POST", `/api/cash-accounts/${kasaId}/access`, { cookie: viewer.cookie, body: { userId: third.id } })).status, 403);
    assert.equal((await call("DELETE", `/api/cash-accounts/${kasaId}/access?userId=${viewer.id}`, { cookie: viewer.cookie })).status, 403);
    assert.equal((await call("PUT", `/api/cash-accounts/${kasaId}/dashboard-share`, { cookie: viewer.cookie, body: { enabled: true } })).status, 403);
    const thirdSees = await call("GET", "/api/cash-accounts", { cookie: third.cookie });
    assert.ok(!thirdSees.json.cashAccounts.some((a) => a.id === kasaId), "the third user got nothing");

    // The owner and a super admin still can.
    assert.equal((await call("POST", `/api/cash-accounts/${kasaId}/access`, { cookie: adminCookie, body: { userId: third.id } })).status, 201);
    assert.equal((await call("DELETE", `/api/cash-accounts/${kasaId}/access?userId=${third.id}`, { cookie: owner.cookie })).status, 200);
  } finally {
    for (const u of [owner, viewer, third]) await call("DELETE", `/api/users/${u.id}`, { cookie: adminCookie });
  }
});

test("workspaces: a kasa opens in a workspace; a workspace holding kasas cannot be deleted", async () => {
  const noWs = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { name: `${RUN_TAG}_noWs` } });
  assert.equal(noWs.status, 400, "a workspace is required");
  const badWs = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { name: `${RUN_TAG}_badWs`, sectionId: 999999 } });
  assert.equal(badWs.status, 400);
  // The old built-in workspace keys are gone.
  const oldParent = await call("POST", "/api/sections", { cookie: adminCookie, body: { scope: "cash", name: `${RUN_TAG}_old`, parentKey: "rj" } });
  assert.equal(oldParent.status, 400);
  // Gelir/Gider bölümleri kaldırıldı: yalnız kasa çalışma alanları oluşturulabilir.
  const incomeSection = await call("POST", "/api/sections", { cookie: adminCookie, body: { scope: "income", name: `${RUN_TAG}_inc` } });
  assert.equal(incomeSection.status, 400);
  assert.equal((await call("GET", "/api/sections", { cookie: adminCookie })).json.sections.every((s) => s.scope === "cash"), true);

  const other = await call("POST", "/api/sections", { cookie: adminCookie, body: { scope: "cash", name: `${RUN_TAG}_ws2` } });
  assert.equal(other.status, 201);
  const otherId = other.json.section.id;
  const sub = await call("POST", "/api/sections", { cookie: adminCookie, body: { scope: "cash", name: `${RUN_TAG}_sub`, parentKey: `sec-${otherId}` } });
  assert.equal(sub.status, 201);
  const subId = sub.json.section.id;

  // A kasa can live in a section of a workspace and move between them.
  const kasaId = await (async () => {
    const res = await call("POST", "/api/cash-accounts", { cookie: adminCookie, body: { name: `${RUN_TAG}_inSub`, sectionId: subId } });
    assert.equal(res.status, 201);
    extraKasaIds.push(res.json.cashAccount.id);
    return res.json.cashAccount.id;
  })();
  const listed = (await call("GET", "/api/cash-accounts", { cookie: adminCookie })).json.cashAccounts.find((a) => a.id === kasaId);
  assert.equal(listed.sectionId, subId);
  assert.equal("isListWorkspace" in listed, false);
  assert.equal("isRjKasa" in listed, false);

  const blocked = await call("DELETE", `/api/sections/${subId}?reason=test`, { cookie: adminCookie });
  assert.equal(blocked.status, 409, "the section still holds a kasa");
  const moved = await call("PUT", `/api/cash-accounts/${kasaId}`, { cookie: adminCookie, body: { name: `${RUN_TAG}_inSub`, sectionId: testWsId } });
  assert.equal(moved.status, 200);
  assert.equal((await call("DELETE", `/api/sections/${subId}?reason=test`, { cookie: adminCookie })).status, 200);
  assert.equal((await call("DELETE", `/api/sections/${otherId}?reason=test`, { cookie: adminCookie })).status, 200);
  const badMove = await call("PUT", `/api/cash-accounts/${kasaId}`, { cookie: adminCookie, body: { name: `${RUN_TAG}_inSub`, sectionId: otherId } });
  assert.equal(badMove.status, 400, "cannot move into a deleted workspace");
});

async function transfer(fromId, toId, amount) {
  const res = await call("POST", "/api/cash-transfers", {
    cookie: adminCookie,
    body: { fromCashAccountId: fromId, toCashAccountId: toId, amount, currency: "USD", date: "2026-01-20", recipientPerson: "Test" },
  });
  assert.equal(res.status, 201);
  return res.json.cashTransfer;
}

async function recordExists(id) {
  const res = await call("GET", "/api/records", { cookie: adminCookie });
  return res.json.records.some((r) => r.id === id);
}

test("cash transfers: both legs live and die together", async () => {
  const fromId = await makeKasa(`${RUN_TAG}_tA`, 100);
  const toId = await makeKasa(`${RUN_TAG}_tB`);
  const t = await transfer(fromId, toId, 50);
  assert.ok(t.fromRecordId && t.toRecordId);

  // Sender leg: a positive "Kasa Aktarımı" expense in the sender kasa; receiver leg: income in the target kasa.
  const all = (await call("GET", "/api/records", { cookie: adminCookie })).json.records;
  const sent = all.find((r) => r.id === t.fromRecordId);
  const received = all.find((r) => r.id === t.toRecordId);
  assert.equal(sent.kind, "expense");
  assert.equal(sent.amount, 50);
  assert.equal(sent.source, "Kasa Aktarımı");
  assert.equal(sent.cashAccount, `${RUN_TAG}_tA`);
  assert.equal(sent.cashAccountId, fromId);
  assert.equal(received.kind, "income");
  assert.equal(received.amount, 50);
  assert.equal(received.cashAccount, `${RUN_TAG}_tB`);
  assert.equal(received.cashAccountId, toId);
  assert.equal(await kasaBalance(fromId), 50, "sender: 100 opening − 50 sent");
  assert.equal(await kasaBalance(toId), 50);

  // The money-defining fields of one leg cannot be edited on their own.
  const edit = await call("PUT", `/api/records/${t.toRecordId}`, { cookie: adminCookie, body: { amount: 999 } });
  assert.equal(edit.status, 400);
  const noteEdit = await call("PUT", `/api/records/${t.toRecordId}`, { cookie: adminCookie, body: { note: "descriptive edits are fine" } });
  assert.equal(noteEdit.status, 200);

  // Deleting the receiving leg reverses the whole transfer.
  const del = await call("DELETE", `/api/records/${t.toRecordId}?reason=test%20reverse`, { cookie: adminCookie });
  assert.equal(del.status, 200);
  assert.deepEqual([...del.json.removedRecordIds].sort(), [t.fromRecordId, t.toRecordId].sort());
  assert.equal(await recordExists(t.fromRecordId), false, "sender leg is gone too");
  const list = await call("GET", "/api/cash-transfers", { cookie: adminCookie });
  assert.equal(list.json.cashTransfers.find((x) => x.id === t.id)?.status, "cancelled");
  assert.equal(await kasaBalance(fromId), 100, "reversing restores the sender's balance");
  assert.equal(await kasaBalance(toId), 0);
});

test("cash transfers: deleting the sender's expense leg reverses the transfer too", async () => {
  const fromId = await makeKasa(`${RUN_TAG}_tE`, 30);
  const toId = await makeKasa(`${RUN_TAG}_tF`);
  const t = await transfer(fromId, toId, 30);
  const lockedKind = await call("PUT", `/api/records/${t.fromRecordId}`, { cookie: adminCookie, body: { kind: "income" } });
  assert.equal(lockedKind.status, 400, "a leg's kind cannot be changed");
  const del = await call("DELETE", `/api/records/${t.fromRecordId}?reason=test%20reverse`, { cookie: adminCookie });
  assert.equal(del.status, 200);
  assert.deepEqual([...del.json.removedRecordIds].sort(), [t.fromRecordId, t.toRecordId].sort());
  assert.equal(await kasaBalance(fromId), 30);
  assert.equal(await kasaBalance(toId), 0);
});

test("cash transfers: deleting a kasa also removes the counterpart leg on the other kasa", async () => {
  const fromId = await makeKasa(`${RUN_TAG}_tC`);
  const toId = await makeKasa(`${RUN_TAG}_tD`);
  const t = await transfer(fromId, toId, 20);
  const del = await call("DELETE", `/api/cash-accounts/${fromId}`, { cookie: adminCookie, body: { password: "admin123", reason: "test kasa delete" } });
  assert.equal(del.status, 200);
  assert.equal(await recordExists(t.toRecordId), false, "the receiver's +X leg does not survive alone");
});

// ---- Kasalar arası borç (app/api/debts, app/api/_lib/debts.ts) ----
async function lend(lenderId, borrowerId, amount, { cookie = adminCookie, currency = "USD" } = {}) {
  return call("POST", "/api/debts", {
    cookie,
    body: { lenderCashAccountId: lenderId, borrowerCashAccountId: borrowerId, amount, currency, date: "2026-02-01", note: "test" },
  });
}

async function repay(debtorId, creditorId, amount, { cookie = adminCookie, currency = "USD" } = {}) {
  return call("POST", "/api/debts/repay", {
    cookie,
    body: { debtorCashAccountId: debtorId, creditorCashAccountId: creditorId, amount, currency, date: "2026-02-10" },
  });
}

// Kalan borç = borçlunun alınan borçları − geri ödemeleri (sunucunun kuralıyla aynı).
async function outstanding(debtorId, creditorId, currency = "USD") {
  const res = await call("GET", "/api/records", { cookie: adminCookie });
  return res.json.records
    .filter((r) => r.cashAccountId === debtorId && r.debtCashAccountId === creditorId && r.currency === currency)
    .reduce((t, r) => t + (r.debtRole === "borrowed" ? r.amount : r.debtRole === "repay" ? -r.amount : 0), 0);
}

async function deleteRecord(id) {
  return call("DELETE", `/api/records/${id}?reason=test%20debt%20delete`, { cookie: adminCookie });
}

let debtLender;
let debtBorrower;
let firstLend;

test("debts: lending writes two linked legs; the lender's balance drops, the borrower's rises", async () => {
  debtLender = await makeKasa(`${RUN_TAG}_dLender`, 1000);
  debtBorrower = await makeKasa(`${RUN_TAG}_dBorrower`);
  const res = await lend(debtLender, debtBorrower, 300);
  assert.equal(res.status, 201);
  const [lent, borrowed] = res.json.records;
  firstLend = { lent, borrowed };

  assert.equal(lent.kind, "expense");
  assert.equal(lent.debtRole, "lent");
  assert.equal(lent.cashAccountId, debtLender);
  assert.equal(lent.debtCashAccountId, debtBorrower);
  assert.equal(lent.source, "Borç verildi");
  assert.equal(lent.detail, `Borç verildi → ${RUN_TAG}_dBorrower`);
  assert.equal(borrowed.kind, "income");
  assert.equal(borrowed.debtRole, "borrowed");
  assert.equal(borrowed.cashAccountId, debtBorrower);
  assert.equal(borrowed.debtCashAccountId, debtLender);
  assert.equal(borrowed.source, "Borç alındı");
  assert.equal(borrowed.detail, `Borç alındı ← ${RUN_TAG}_dLender`);
  assert.equal(lent.amount, 300);
  assert.equal(borrowed.amount, 300);
  assert.equal(lent.debtLinkId, borrowed.id, "the legs point at each other");
  assert.equal(borrowed.debtLinkId, lent.id);

  assert.equal(await kasaBalance(debtLender), 700, "lender: 1000 opening − 300 lent");
  assert.equal(await kasaBalance(debtBorrower), 300);
  assert.equal(await outstanding(debtBorrower, debtLender), 300);

  // The money-defining fields of a debt leg are locked; descriptive edits apply to that leg only.
  const amountEdit = await call("PUT", `/api/records/${borrowed.id}`, { cookie: adminCookie, body: { amount: 1 } });
  assert.equal(amountEdit.status, 400);
  const noteEdit = await call("PUT", `/api/records/${borrowed.id}`, { cookie: adminCookie, body: { note: "only this leg" } });
  assert.equal(noteEdit.status, 200);
});

test("debts: a repayment writes two legs, lowers the outstanding and never touches past records", async () => {
  const res = await repay(debtBorrower, debtLender, 100);
  assert.equal(res.status, 201);
  const [repaid, collected] = res.json.records;
  assert.equal(repaid.kind, "expense");
  assert.equal(repaid.debtRole, "repay");
  assert.equal(repaid.cashAccountId, debtBorrower);
  assert.equal(repaid.source, "Borç ödemesi");
  assert.equal(repaid.detail, `Borç ödemesi → ${RUN_TAG}_dLender`);
  assert.equal(collected.kind, "income");
  assert.equal(collected.debtRole, "collected");
  assert.equal(collected.cashAccountId, debtLender);
  assert.equal(collected.source, "Borç tahsilatı");
  assert.equal(collected.detail, `Borç tahsilatı ← ${RUN_TAG}_dBorrower`);
  assert.equal(repaid.debtLinkId, collected.id);
  assert.equal(collected.debtLinkId, repaid.id);

  assert.equal(await outstanding(debtBorrower, debtLender), 200);
  assert.equal(await kasaBalance(debtLender), 800);
  assert.equal(await kasaBalance(debtBorrower), 200);

  // The original lending is not reduced any more.
  const all = (await call("GET", "/api/records", { cookie: adminCookie })).json.records;
  assert.equal(all.find((r) => r.id === firstLend.lent.id).amount, 300);
  assert.equal(all.find((r) => r.id === firstLend.borrowed.id).amount, 300);

  const overpay = await repay(debtBorrower, debtLender, 250);
  assert.equal(overpay.status, 400);
  assert.match(overpay.json?.error ?? "", /kalan borçtan büyük olamaz/);
  const otherCurrency = await repay(debtBorrower, debtLender, 10, { currency: "EUR" });
  assert.equal(otherCurrency.status, 400, "no debt in that currency");
  const reversed = await repay(debtLender, debtBorrower, 10);
  assert.equal(reversed.status, 400, "the lender owes nothing");
  assert.match(reversed.json?.error ?? "", /borcu yok/);
  const zero = await repay(debtBorrower, debtLender, 0);
  assert.equal(zero.status, 400);
  assert.equal(await outstanding(debtBorrower, debtLender), 200, "rejected payments change nothing");

  // Deleting either repayment leg removes its twin and restores the outstanding.
  const del = await deleteRecord(collected.id);
  assert.equal(del.status, 200);
  assert.deepEqual([...del.json.removedRecordIds].sort(), [repaid.id, collected.id].sort());
  assert.equal(await recordExists(repaid.id), false);
  assert.equal(await outstanding(debtBorrower, debtLender), 300);
  assert.equal(await kasaBalance(debtLender), 700);
  assert.equal(await kasaBalance(debtBorrower), 300);
});

test("debts: a lending cannot be deleted below its repayments; deleting a lend leg deletes its twin", async () => {
  const pay = await repay(debtBorrower, debtLender, 250);
  assert.equal(pay.status, 201);
  const second = await lend(debtLender, debtBorrower, 100);
  assert.equal(second.status, 201);
  assert.equal(await outstanding(debtBorrower, debtLender), 150);

  // 300 lent + 100 lent − 250 repaid: removing the 300 would leave −150.
  const blocked = await deleteRecord(firstLend.lent.id);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json?.error ?? "", /önce borç ödemelerini silin/);
  assert.equal(await recordExists(firstLend.lent.id), true);
  assert.equal(await recordExists(firstLend.borrowed.id), true);

  // Removing the second lending (via its borrowed leg) is fine: 150 − 100 = 50.
  const [secondLent, secondBorrowed] = second.json.records;
  const delSecond = await deleteRecord(secondBorrowed.id);
  assert.equal(delSecond.status, 200);
  assert.deepEqual([...delSecond.json.removedRecordIds].sort(), [secondLent.id, secondBorrowed.id].sort());
  assert.equal(await outstanding(debtBorrower, debtLender), 50);

  // Repayments can always be deleted; afterwards the first lending can go too.
  const [payLeg] = pay.json.records;
  assert.equal((await deleteRecord(payLeg.id)).status, 200);
  const delFirst = await deleteRecord(firstLend.lent.id);
  assert.equal(delFirst.status, 200);
  assert.equal(await recordExists(firstLend.borrowed.id), false, "the borrowed twin is gone too");
  assert.equal(await outstanding(debtBorrower, debtLender), 0);
  assert.equal(await kasaBalance(debtLender), 1000, "the lender's balance is back where it started");
  assert.equal(await kasaBalance(debtBorrower), 0);
});

test("debts: different kasas, the income+expense permissions and access to both kasas are required", async () => {
  const same = await lend(debtLender, debtLender, 10);
  assert.equal(same.status, 400);
  assert.match(same.json?.error ?? "", /farklı olmalıdır/);
  const zero = await lend(debtLender, debtBorrower, 0);
  assert.equal(zero.status, 400);

  // The reporter has "expense" but not "income": a debt writes both, so it is refused.
  const noIncome = await lend(debtLender, debtBorrower, 5, { cookie: reporterCookie });
  assert.equal(noIncome.status, 403);

  const created = await call("POST", "/api/users", {
    cookie: adminCookie,
    body: { username: `${RUN_TAG}_debtor`, password: "ApiTest1234", name: "Debt User", roleLabel: "Test", isAdmin: false, permissions: ["cash", "income", "expense"] },
  });
  assert.equal(created.status, 201);
  try {
    const cookie = (await call("POST", "/api/auth/login", { body: { username: `${RUN_TAG}_debtor`, password: "ApiTest1234" } })).cookie;
    const own = await call("POST", "/api/cash-accounts", { cookie, body: { sectionId: testWsId, name: `${RUN_TAG}_debtorKasa` } });
    assert.equal(own.status, 201);
    const ownId = own.json.cashAccount.id;
    extraKasaIds.push(ownId);
    // Lending to a kasa the user cannot see, or from one they do not own, is refused.
    const toForeign = await lend(ownId, debtBorrower, 5, { cookie });
    assert.equal(toForeign.status, 403);
    assert.match(toForeign.json?.error ?? "", /erişim/);
    const fromForeign = await lend(debtLender, ownId, 5, { cookie });
    assert.equal(fromForeign.status, 403);
    const repayForeign = await repay(ownId, debtLender, 5, { cookie });
    assert.equal(repayForeign.status, 403);
    assert.equal(await outstanding(debtBorrower, ownId), 0, "nothing was written");
    assert.equal(await outstanding(ownId, debtLender), 0);
  } finally {
    await call("DELETE", `/api/users/${created.json.user.id}`, { cookie: adminCookie });
  }
});

test("debts: POST /api/records no longer creates debt legs", async () => {
  const res = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: {
      kind: "expense", date: "2026-02-01", source: `${RUN_TAG}_olddebt`, amount: 5, currency: "USD",
      cashAccount: `${RUN_TAG}_dLender`, debtMode: "lent", debtCashAccountId: debtBorrower,
    },
  });
  assert.equal(res.status, 400);
  const all = (await call("GET", "/api/records", { cookie: adminCookie })).json.records;
  assert.ok(!all.some((r) => r.source === `${RUN_TAG}_olddebt`), "no record was written");
  assert.equal(await outstanding(debtBorrower, debtLender), 0);
});

test("debts: deleting a kasa also removes the debt legs on the other kasa", async () => {
  const lender = await makeKasa(`${RUN_TAG}_dKill`, 100);
  const borrower = await makeKasa(`${RUN_TAG}_dKeep`);
  const res = await lend(lender, borrower, 40);
  assert.equal(res.status, 201);
  const del = await call("DELETE", `/api/cash-accounts/${lender}`, { cookie: adminCookie, body: { password: "admin123", reason: "test kasa delete" } });
  assert.equal(del.status, 200);
  assert.equal(await recordExists(res.json.records[1].id), false, "the borrowed leg does not survive alone");
  assert.equal(await kasaBalance(borrower), 0);
});

// ---- Sistem dışı kasaya / projeye borç (tek kayıt; app/api/_lib/debts.ts runPartyDebtOperation) ----
async function partyOutstanding(kasaId, party, currency = "USD") {
  const res = await call("GET", "/api/records", { cookie: adminCookie });
  const key = party.trim().toLocaleUpperCase("tr-TR");
  return res.json.records
    .filter((r) => r.cashAccountId === kasaId && r.debtCashAccountId == null && (r.debtParty ?? "").toLocaleUpperCase("tr-TR") === key && r.currency === currency)
    .reduce((t, r) => t + (r.debtRole === "lent" ? r.amount : r.debtRole === "collected" ? -r.amount : 0), 0);
}

async function plainRecord(kasaName, kind, amount, source, person = "") {
  const res = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind, date: "2026-03-01", source, person, amount, currency: "USD", cashAccount: kasaName },
  });
  assert.equal(res.status, 201, `create ${kind} ${source}`);
  return res.json.record;
}

test("party debts: lending to a project outside the system writes one record; collecting brings the money back", async () => {
  const kasaName = `${RUN_TAG}_pLender`;
  const kasa = await makeKasa(kasaName, 1000);
  const party = `${RUN_TAG}_C.GROUP`;
  const res = await call("POST", "/api/debts", {
    cookie: adminCookie,
    body: { lenderCashAccountId: kasa, borrowerParty: `  ${party} `, person: "SİNAN", amount: 400, currency: "USD", date: "2026-03-02" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.records.length, 1, "no counterpart kasa, so a single record");
  const [lent] = res.json.records;
  assert.equal(lent.kind, "expense");
  assert.equal(lent.debtRole, "lent");
  assert.equal(lent.debtCashAccountId, null);
  assert.equal(lent.debtParty, party, "the name is trimmed");
  assert.equal(lent.source, party);
  assert.equal(lent.person, "SİNAN");
  assert.equal(await kasaBalance(kasa), 600, "the money left the kasa");
  assert.equal(await partyOutstanding(kasa, party), 400);

  // Both counterparties, or neither, is a validation error.
  const both = await call("POST", "/api/debts", { cookie: adminCookie, body: { lenderCashAccountId: kasa, borrowerCashAccountId: kasa, borrowerParty: party, amount: 1, date: "2026-03-02" } });
  assert.equal(both.status, 400);
  const neither = await call("POST", "/api/debts", { cookie: adminCookie, body: { lenderCashAccountId: kasa, amount: 1, date: "2026-03-02" } });
  assert.equal(neither.status, 400);

  // Collecting: the name matches whatever the case; more than is owed is refused.
  const over = await call("POST", "/api/debts/repay", { cookie: adminCookie, body: { debtorParty: party.toLowerCase(), creditorCashAccountId: kasa, amount: 401, date: "2026-03-05" } });
  assert.equal(over.status, 400);
  assert.match(over.json?.error ?? "", /kalan alacaktan büyük olamaz/);
  const pay = await call("POST", "/api/debts/repay", { cookie: adminCookie, body: { debtorParty: party.toLowerCase(), creditorCashAccountId: kasa, person: "SİNAN", amount: 150, date: "2026-03-05" } });
  assert.equal(pay.status, 201);
  const [collected] = pay.json.records;
  assert.equal(collected.kind, "income");
  assert.equal(collected.debtRole, "collected");
  assert.equal(collected.debtParty, party, "the first spelling is kept");
  assert.equal(await kasaBalance(kasa), 750);
  assert.equal(await partyOutstanding(kasa, party), 250);
  const nobody = await call("POST", "/api/debts/repay", { cookie: adminCookie, body: { debtorParty: `${RUN_TAG}_nobody`, creditorCashAccountId: kasa, amount: 1, date: "2026-03-05" } });
  assert.equal(nobody.status, 400, "nothing is owed by an unknown project");

  // The lending cannot be deleted while its collection would exceed what is left; the collection can.
  const second = await call("POST", "/api/debts", { cookie: adminCookie, body: { lenderCashAccountId: kasa, borrowerParty: party, amount: 50, date: "2026-03-06" } });
  assert.equal(second.status, 201);
  const blocked = await deleteRecord(lent.id);
  assert.equal(blocked.status, 409);
  assert.equal(await recordExists(lent.id), true);
  const delSecond = await deleteRecord(second.json.records[0].id);
  assert.equal(delSecond.status, 200);
  assert.deepEqual(delSecond.json.removedRecordIds, [second.json.records[0].id], "a single record, no twin");
  assert.equal((await deleteRecord(collected.id)).status, 200);
  assert.equal((await deleteRecord(lent.id)).status, 200);
  assert.equal(await kasaBalance(kasa), 1000, "back where it started");
});

test("party debts: an expense becomes a debt and an income becomes its collection, and back", async () => {
  const kasaName = `${RUN_TAG}_pMark`;
  const kasa = await makeKasa(kasaName, 1000);
  const project = `${RUN_TAG}_PROJA`;
  const expense = await plainRecord(kasaName, "expense", 300, project, "XALIT");
  assert.equal(await kasaBalance(kasa), 700);

  // Income cannot be marked as a collection before anything is owed.
  const income = await plainRecord(kasaName, "income", 120, `${RUN_TAG}_payback`, "XALIT");
  const early = await call("POST", `/api/records/${income.id}/debt`, { cookie: adminCookie, body: { party: project } });
  assert.equal(early.status, 400);
  assert.match(early.json?.error ?? "", /kalan alacaktan büyük olamaz/);

  const stale = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { party: project, updatedAt: "2020-01-01T00:00:00.000Z" } });
  assert.equal(stale.status, 409, "an out-of-date screen cannot mark the record");
  const mark = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { party: project, updatedAt: expense.updatedAt } });
  assert.equal(mark.status, 200);
  assert.equal(mark.json.record.debtRole, "lent");
  assert.equal(mark.json.record.debtParty, project);
  assert.equal(mark.json.record.amount, 300, "amount, date, title and person are kept");
  assert.equal(mark.json.record.source, project);
  assert.equal(mark.json.record.person, "XALIT");
  assert.ok(mark.json.archiveEntry, "the previous version is archived");
  assert.equal(await kasaBalance(kasa), 820, "the balance does not change");
  assert.equal(await partyOutstanding(kasa, project), 300);
  const again = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { party: project } });
  assert.equal(again.status, 200, "marking a debt again just (re)sets its counterpart");
  assert.equal(await partyOutstanding(kasa, project), 300, "nothing is counted twice");
  const amountEdit = await call("PUT", `/api/records/${expense.id}`, { cookie: adminCookie, body: { amount: 1 } });
  assert.equal(amountEdit.status, 400, "a debt record's amount is locked");

  const collect = await call("POST", `/api/records/${income.id}/debt`, { cookie: adminCookie, body: { party: project } });
  assert.equal(collect.status, 200);
  assert.equal(collect.json.record.debtRole, "collected");
  assert.equal(await partyOutstanding(kasa, project), 180);

  // Unmarking the lending would leave the collection above what was lent.
  const blocked = await call("DELETE", `/api/records/${expense.id}/debt`, { cookie: adminCookie });
  assert.equal(blocked.status, 409);
  const unCollect = await call("DELETE", `/api/records/${income.id}/debt`, { cookie: adminCookie });
  assert.equal(unCollect.status, 200);
  assert.equal(unCollect.json.record.debtRole, "");
  const unLend = await call("DELETE", `/api/records/${expense.id}/debt`, { cookie: adminCookie });
  assert.equal(unLend.status, 200);
  assert.equal(unLend.json.record.debtRole, "");
  assert.equal(unLend.json.record.debtParty, "");
  assert.equal(await kasaBalance(kasa), 820, "marks never move money");

  // Transfer legs and kasa-to-kasa debt legs cannot be marked.
  const other = await makeKasa(`${RUN_TAG}_pOther`);
  const t = await transfer(kasa, other, 10);
  const transferMark = await call("POST", `/api/records/${t.fromRecordId}/debt`, { cookie: adminCookie, body: { party: project } });
  assert.equal(transferMark.status, 400);
  // A kasa-to-kasa debt leg can be unmarked too: it stays as a plain record and its twin goes.
  const kasaDebt = await lend(kasa, other, 5);
  const [kasaLent, kasaBorrowed] = kasaDebt.json.records;
  const twinMark = await call("DELETE", `/api/records/${kasaLent.id}/debt`, { cookie: adminCookie });
  assert.equal(twinMark.status, 200);
  assert.deepEqual(twinMark.json.removedRecordIds, [kasaBorrowed.id]);
  assert.equal(await recordExists(kasaBorrowed.id), false);
  assert.equal(twinMark.json.record.debtRole, "");
});

test("party debts: a user without write access to the kasa cannot lend from it or mark its records", async () => {
  const kasaName = `${RUN_TAG}_pGuard`;
  const kasa = await makeKasa(kasaName, 100);
  const expense = await plainRecord(kasaName, "expense", 10, `${RUN_TAG}_guarded`);
  const res = await call("POST", "/api/debts", { cookie: testUserCookie, body: { lenderCashAccountId: kasa, borrowerParty: "X", amount: 1, date: "2026-03-02" } });
  assert.equal(res.status, 403);
  const mark = await call("POST", `/api/records/${expense.id}/debt`, { cookie: testUserCookie, body: { party: "X" } });
  assert.equal(mark.status, 403);
  assert.equal(await partyOutstanding(kasa, "X"), 0);
});

test("debt mark: an expense becomes a kasa-to-kasa debt picked from the list, with a twin in the borrowing kasa", async () => {
  const lenderName = `${RUN_TAG}_kmLender`;
  const lender = await makeKasa(lenderName, 1000);
  const borrower = await makeKasa(`${RUN_TAG}_kmBorrower`);
  const expense = await plainRecord(lenderName, "expense", 300, `${RUN_TAG}_kmProject`, "SİNAN");
  assert.equal(await kasaBalance(lender), 700);

  const same = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: lender } });
  assert.equal(same.status, 400, "the record's own kasa cannot borrow");
  const both = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: borrower, party: "X" } });
  assert.equal(both.status, 400, "a kasa from the list or an outside name, not both");

  const mark = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: borrower, updatedAt: expense.updatedAt } });
  assert.equal(mark.status, 200);
  const lent = mark.json.record;
  const twin = mark.json.twin;
  assert.equal(lent.debtRole, "lent");
  assert.equal(lent.debtCashAccountId, borrower);
  assert.equal(lent.debtParty, `${RUN_TAG}_kmBorrower`);
  assert.equal(lent.amount, 300);
  assert.equal(lent.person, "SİNAN", "the person stays");
  assert.equal(lent.source, `${RUN_TAG}_kmBorrower`, "inside the system the title becomes the chosen kasa");
  assert.equal(twin.source, lenderName, "the twin is titled with the lending kasa");
  assert.equal(twin.kind, "income");
  assert.equal(twin.debtRole, "borrowed");
  assert.equal(twin.cashAccountId, borrower);
  assert.equal(twin.debtCashAccountId, lender);
  assert.equal(twin.debtLinkId, lent.id);
  assert.equal(lent.debtLinkId, twin.id);
  assert.equal(await kasaBalance(lender), 700, "the lender's balance does not move");
  assert.equal(await kasaBalance(borrower), 300, "the borrower received the money");
  assert.equal(await outstanding(borrower, lender), 300);

  // The borrower repays with the usual flow; then an income in the lender can be marked as a further repayment.
  assert.equal((await repay(borrower, lender, 100)).status, 201);
  assert.equal(await outstanding(borrower, lender), 200);
  const income = await plainRecord(lenderName, "income", 50, `${RUN_TAG}_kmPayback`);
  const collect = await call("POST", `/api/records/${income.id}/debt`, { cookie: adminCookie, body: { cashAccountId: borrower } });
  assert.equal(collect.status, 200);
  assert.equal(collect.json.record.debtRole, "collected");
  assert.equal(collect.json.twin.debtRole, "repay");
  assert.equal(collect.json.twin.cashAccountId, borrower);
  assert.equal(await outstanding(borrower, lender), 150);
  const tooMuch = await plainRecord(lenderName, "income", 500, `${RUN_TAG}_kmTooMuch`);
  const over = await call("POST", `/api/records/${tooMuch.id}/debt`, { cookie: adminCookie, body: { cashAccountId: borrower } });
  assert.equal(over.status, 400, "a collection cannot exceed what is owed");

  // Unmarking the lending is refused while repayments exceed what would remain; unmarking a collection removes its twin.
  const blocked = await call("DELETE", `/api/records/${lent.id}/debt`, { cookie: adminCookie });
  assert.equal(blocked.status, 409);
  const unCollect = await call("DELETE", `/api/records/${income.id}/debt`, { cookie: adminCookie });
  assert.equal(unCollect.status, 200);
  assert.deepEqual(unCollect.json.removedRecordIds, [collect.json.twin.id]);
  assert.equal(await recordExists(collect.json.twin.id), false);
  assert.equal(unCollect.json.record.debtRole, "");
  assert.equal(await outstanding(borrower, lender), 200);
});

test("debt mark: the counterpart can be changed later, and unmarking restores the original title", async () => {
  const lenderName = `${RUN_TAG}_chLender`;
  const lender = await makeKasa(lenderName, 1000);
  const first = await makeKasa(`${RUN_TAG}_chFirst`);
  const second = await makeKasa(`${RUN_TAG}_chSecond`);
  const expense = await plainRecord(lenderName, "expense", 200, `${RUN_TAG}_typedByHand`, "ŞOREŞ");

  // Outside first, then moved onto a kasa from the list.
  const outside = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { party: `${RUN_TAG}_typedByHand` } });
  assert.equal(outside.status, 200);
  assert.equal(outside.json.record.source, `${RUN_TAG}_typedByHand`, "outside debts keep the title");
  const toFirst = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: first } });
  assert.equal(toFirst.status, 200);
  assert.equal(toFirst.json.record.debtCashAccountId, first);
  assert.equal(toFirst.json.record.source, `${RUN_TAG}_chFirst`);
  assert.equal(await kasaBalance(first), 200);
  assert.equal(await partyOutstanding(lender, `${RUN_TAG}_typedByHand`), 0, "the outside debt is gone");

  // Kasa to another kasa: the old twin goes, a new one is written.
  const oldTwinId = toFirst.json.twin.id;
  const toSecond = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: second } });
  assert.equal(toSecond.status, 200);
  assert.deepEqual(toSecond.json.removedRecordIds, [oldTwinId]);
  assert.equal(await recordExists(oldTwinId), false);
  assert.equal(toSecond.json.record.source, `${RUN_TAG}_chSecond`);
  assert.equal(await kasaBalance(first), 0);
  assert.equal(await kasaBalance(second), 200);
  assert.equal(await kasaBalance(lender), 800, "the lender's balance never moves");

  // A failed change rolls everything back: once the second kasa has repaid, the debt cannot move.
  assert.equal((await repay(second, lender, 50)).status, 201);
  const blocked = await call("POST", `/api/records/${expense.id}/debt`, { cookie: adminCookie, body: { cashAccountId: first } });
  assert.equal(blocked.status, 409);
  const after = (await call("GET", "/api/records", { cookie: adminCookie })).json.records.find((r) => r.id === expense.id);
  assert.equal(after.debtCashAccountId, second, "nothing changed");
  assert.equal(await outstanding(second, lender), 150);

  // Unmarking (after the repayment is undone) restores the hand-typed title.
  const repayLeg = (await call("GET", "/api/records", { cookie: adminCookie })).json.records.find((r) => r.cashAccountId === second && r.debtRole === "repay");
  assert.equal((await deleteRecord(repayLeg.id)).status, 200);
  const un = await call("DELETE", `/api/records/${expense.id}/debt`, { cookie: adminCookie });
  assert.equal(un.status, 200);
  assert.equal(un.json.record.source, `${RUN_TAG}_typedByHand`);
  assert.equal(un.json.record.debtRole, "");
  assert.equal(await kasaBalance(second), 0);
});

// ---- Döviz (app/api/fx, app/api/records/:id/convert, app/api/_lib/fx.ts) ----
async function kasaBalanceIn(kasaId, currency) {
  const res = await call("GET", "/api/records", { cookie: adminCookie });
  return res.json.records
    .filter((r) => r.cashAccountId === kasaId && r.currency === currency)
    .reduce((t, r) => t + (r.kind === "income" ? r.amount : -r.amount), 0);
}

test("fx: exchanging inside a kasa writes two linked records, moves both balances and deletes as one", async () => {
  const kasaName = `${RUN_TAG}_fxKasa`;
  const kasa = await makeKasa(kasaName, 100);
  const syp = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-03-01", source: `${RUN_TAG}_sypIn`, amount: 2600000, currency: "SYP", cashAccount: kasaName },
  });
  assert.equal(syp.status, 201);

  const same = await call("POST", "/api/fx", { cookie: adminCookie, body: { cashAccountId: kasa, fromCurrency: "SYP", toCurrency: "SYP", amount: 1, rate: 1, date: "2026-03-02" } });
  assert.equal(same.status, 400);
  const noRate = await call("POST", "/api/fx", { cookie: adminCookie, body: { cashAccountId: kasa, fromCurrency: "SYP", toCurrency: "USD", amount: 1, rate: 0, date: "2026-03-02" } });
  assert.equal(noRate.status, 400);

  // 1 USD = 13.000 SYP (typed by hand): 1.300.000 SYP → 100 USD.
  const res = await call("POST", "/api/fx", { cookie: adminCookie, body: { cashAccountId: kasa, fromCurrency: "SYP", toCurrency: "USD", amount: 1300000, rate: 13000, date: "2026-03-02", note: "elden" } });
  assert.equal(res.status, 201);
  const [out, inn] = res.json.records;
  assert.equal(out.kind, "expense");
  assert.equal(out.fxRole, "out");
  assert.equal(out.currency, "SYP");
  assert.equal(out.amount, 1300000);
  assert.equal(inn.kind, "income");
  assert.equal(inn.fxRole, "in");
  assert.equal(inn.currency, "USD");
  assert.equal(inn.amount, 100);
  assert.equal(inn.originalAmount, 1300000, "the converted money stays on the record");
  assert.equal(inn.originalCurrency, "SYP");
  assert.equal(inn.fxRate, 13000);
  assert.equal(out.fxLinkId, inn.id);
  assert.equal(inn.fxLinkId, out.id);
  assert.equal(await kasaBalanceIn(kasa, "SYP"), 1300000);
  assert.equal(await kasaBalanceIn(kasa, "USD"), 200);

  // USD → SYP uses the same "1 USD = x" rate.
  const back = await call("POST", "/api/fx", { cookie: adminCookie, body: { cashAccountId: kasa, fromCurrency: "USD", toCurrency: "SYP", amount: 10, rate: 13500, date: "2026-03-03" } });
  assert.equal(back.status, 201);
  assert.equal(back.json.records[1].amount, 135000);

  // Money fields are locked; deleting one side removes both; the pair cannot become a debt or be converted.
  const edit = await call("PUT", `/api/records/${inn.id}`, { cookie: adminCookie, body: { amount: 1 } });
  assert.equal(edit.status, 400);
  const asDebt = await call("POST", `/api/records/${out.id}/debt`, { cookie: adminCookie, body: { party: "X" } });
  assert.equal(asDebt.status, 400);
  const asConvert = await call("POST", `/api/records/${out.id}/convert`, { cookie: adminCookie, body: { rate: 1 } });
  assert.equal(asConvert.status, 400);
  const del = await deleteRecord(out.id);
  assert.equal(del.status, 200);
  assert.deepEqual([...del.json.removedRecordIds].sort(), [out.id, inn.id].sort());
  assert.equal(await kasaBalanceIn(kasa, "SYP"), 2600000 + 135000);
  assert.equal(await kasaBalanceIn(kasa, "USD"), 90);
});

test("fx: a record entered in another currency is converted to dollars, keeps the original, and can be undone", async () => {
  const kasaName = `${RUN_TAG}_fxConvert`;
  const kasa = await makeKasa(kasaName);
  const created = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "expense", date: "2026-03-01", source: `${RUN_TAG}_oldSyp`, amount: 650000, currency: "SYP", cashAccount: kasaName },
  });
  assert.equal(created.status, 201);
  const rec = created.json.record;

  const stale = await call("POST", `/api/records/${rec.id}/convert`, { cookie: adminCookie, body: { rate: 13000, updatedAt: "2020-01-01T00:00:00.000Z" } });
  assert.equal(stale.status, 409);
  const conv = await call("POST", `/api/records/${rec.id}/convert`, { cookie: adminCookie, body: { rate: 13000, updatedAt: rec.updatedAt } });
  assert.equal(conv.status, 200);
  assert.equal(conv.json.record.currency, "USD");
  assert.equal(conv.json.record.amount, 50);
  assert.equal(conv.json.record.originalAmount, 650000);
  assert.equal(conv.json.record.originalCurrency, "SYP");
  assert.equal(conv.json.record.fxRate, 13000);
  assert.ok(conv.json.archiveEntry, "the previous version is archived");
  assert.equal(await kasaBalanceIn(kasa, "SYP"), 0);
  assert.equal(await kasaBalanceIn(kasa, "USD"), -50);

  const already = await call("POST", `/api/records/${rec.id}/convert`, { cookie: adminCookie, body: { toCurrency: "USD", rate: 1 } });
  assert.equal(already.status, 400, "already in dollars");
  const lockedAmount = await call("PUT", `/api/records/${rec.id}`, { cookie: adminCookie, body: { amount: 60 } });
  assert.equal(lockedAmount.status, 400, "undo the conversion before changing the amount");
  const note = await call("PUT", `/api/records/${rec.id}`, { cookie: adminCookie, body: { note: "ok" } });
  assert.equal(note.status, 200, "other fields stay editable");

  const undo = await call("DELETE", `/api/records/${rec.id}/convert`, { cookie: adminCookie });
  assert.equal(undo.status, 200);
  assert.equal(undo.json.record.currency, "SYP");
  assert.equal(undo.json.record.amount, 650000);
  assert.equal(undo.json.record.originalCurrency, "");
  assert.equal(undo.json.record.originalAmount, null);
  const undoAgain = await call("DELETE", `/api/records/${rec.id}/convert`, { cookie: adminCookie });
  assert.equal(undoAgain.status, 400);
});

test("records: two saves from the same version — exactly one wins", async () => {
  await makeKasa(`${RUN_TAG}_race`);
  const create = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_raced`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_race` },
  });
  assert.equal(create.status, 201);
  const rec = create.json.record;
  createdRecordIds.push(rec.id);
  const [a, b] = await Promise.all([
    call("PUT", `/api/records/${rec.id}`, { cookie: adminCookie, body: { amount: 2, updatedAt: rec.updatedAt } }),
    call("PUT", `/api/records/${rec.id}`, { cookie: adminCookie, body: { amount: 3, updatedAt: rec.updatedAt } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test("polling: an unchanged GET answers 304 to its ETag, a changed one sends the new body", async () => {
  const first = await callRaw("GET", "/api/records", { cookie: adminCookie });
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.ok(etag, "GET responses carry an ETag");
  const again = await callRaw("GET", "/api/records", { cookie: adminCookie, headers: { "if-none-match": etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");

  await makeKasa(`${RUN_TAG}_etag`, 1);
  const changed = await callRaw("GET", "/api/records", { cookie: adminCookie, headers: { "if-none-match": etag } });
  assert.equal(changed.status, 200, "data changed → full body again");
  assert.notEqual(changed.headers.get("etag"), etag);
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

test("view as user: a super admin browses as another user, read-only and without a trace", async () => {
  // A fresh user that never signs in, so "online" can only come from the view session.
  const quiet = await call("POST", "/api/users", {
    cookie: adminCookie,
    body: { username: `${RUN_TAG}_viewed`, password: "ApiTest1234", name: "Viewed User", roleLabel: "Test", isAdmin: false, permissions: ["cash"] },
  });
  assert.equal(quiet.status, 201);
  const viewedId = quiet.json.user.id;

  // Only a (real) super admin can open a view.
  assert.equal((await call("POST", "/api/admin/view-as", { cookie: testUserCookie, body: { userId: viewedId } })).status, 403);
  assert.equal((await call("POST", "/api/admin/view-as", { cookie: adminCookie, body: { userId: 999999999 } })).status, 404);

  const opened = await call("POST", "/api/admin/view-as", { cookie: adminCookie, body: { userId: viewedId } });
  assert.equal(opened.status, 200);
  assert.match(opened.cookie ?? "", /^mfv01_view=/);
  const both = `${adminCookie}; ${opened.cookie}`;

  // Requests now run as the viewed user, flagged read-only.
  const session = await call("GET", "/api/auth/session", { cookie: both });
  assert.equal(session.status, 200);
  assert.equal(session.json.profile.username, `${RUN_TAG}_viewed`);
  assert.equal(session.json.viewAs?.viewerName, "Admin");
  assert.equal((await call("GET", "/api/records", { cookie: both })).status, 200);
  assert.equal((await call("GET", "/api/users", { cookie: both })).status, 403, "sees only what the user may see");

  // Nothing can be changed.
  const write = await call("POST", "/api/records", { cookie: both, body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_viewwrite`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa` } });
  assert.equal(write.status, 403);
  assert.equal(write.json?.code, "read_only");
  assert.equal((await call("PUT", "/api/profile", { cookie: both, body: { name: "x", avatar: "", language: "en" } })).status, 403);
  assert.equal((await call("POST", "/api/notes/read-all", { cookie: both })).status, 403);
  assert.equal((await call("POST", "/api/admin/view-as", { cookie: both, body: { userId: testUserId } })).status, 403);

  // Not shown as online.
  const online = await call("GET", "/api/users/online", { cookie: adminCookie });
  assert.ok(!online.json.onlineUserIds.includes(viewedId), "viewed user is not online");

  // The view cookie alone, or next to someone else's session, opens nothing.
  assert.equal((await call("GET", "/api/auth/session", { cookie: opened.cookie })).status, 401);
  const other = await call("GET", "/api/auth/session", { cookie: `${testUserCookie}; ${opened.cookie}` });
  assert.equal(other.json.profile.username, testUsername);
  assert.equal(other.json.viewAs, null);

  // "Çıkış" while viewing only ends the view; the admin stays signed in.
  const out = await call("POST", "/api/auth/logout", { cookie: both });
  assert.equal(out.json?.endedView, true);
  const back = await call("GET", "/api/auth/session", { cookie: both });
  assert.equal(back.json.profile.username, "admin");
  assert.equal(back.json.viewAs, null);

  assert.equal((await call("DELETE", `/api/users/${viewedId}`, { cookie: adminCookie })).status, 200);
});

test("notes: a sheet note keeps its cells; updates without format leave the sheet untouched", async () => {
  const sheet = { rows: 20, cols: 8, data: [["Kalem", "Tutar"], ["Kira", "1.250,50"], ["Toplam", "=TOPLA(B2:B2)"]] };
  const created = await call("POST", "/api/notes", { cookie: adminCookie, body: { title: `${RUN_TAG}_sheet`, content: "", format: "sheet", sheet } });
  assert.equal(created.status, 201);
  const id = created.json.note.id;
  try {
    assert.equal(created.json.note.format, "sheet");
    assert.deepEqual(created.json.note.sheet, sheet);
    // Eski istemci gibi format/sheet göndermeden güncelleme: tablo korunur.
    const moved = await call("PUT", `/api/notes/${id}`, { cookie: adminCookie, body: { title: `${RUN_TAG}_sheet`, content: "açıklama", status: "pending" } });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.note.format, "sheet");
    assert.deepEqual(moved.json.note.sheet, sheet);
    // Boyutu aşan tablo reddedilir.
    const bad = await call("PUT", `/api/notes/${id}`, { cookie: adminCookie, body: { title: "x", format: "sheet", sheet: { rows: 1, cols: 1, data: [["a", "b"]] } } });
    assert.equal(bad.status, 400);
    // Düz nota çevrilince tablo silinir.
    const plain = await call("PUT", `/api/notes/${id}`, { cookie: adminCookie, body: { title: `${RUN_TAG}_sheet`, content: "düz", format: "text" } });
    assert.equal(plain.json.note.format, "text");
    assert.equal(plain.json.note.sheet, null);
    // Format verilmeyen yeni not düz nottur.
    const legacy = await call("POST", "/api/notes", { cookie: adminCookie, body: { title: `${RUN_TAG}_plain`, content: "x" } });
    assert.equal(legacy.json.note.format, "text");
    await call("DELETE", `/api/notes/${legacy.json.note.id}`, { cookie: adminCookie });
  } finally {
    await call("DELETE", `/api/notes/${id}`, { cookie: adminCookie });
  }
});

test("database backup: the BACKUP_TOKEN bearer opens only the backup, and only when configured", async () => {
  const w = await loadWorker();
  const post = (path, token, body) =>
    callWorker(
      w,
      new Request(`http://127.0.0.1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mfv01-remote-addr": "203.0.113.77", authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
      ctx,
    );
  const token = `${RUN_TAG}_backup_token_0123456789abcdef`;

  delete process.env.BACKUP_TOKEN;
  assert.equal((await post("/api/database/backup", token)).status, 401, "no token configured → refused");

  process.env.BACKUP_TOKEN = token;
  try {
    assert.equal((await post("/api/database/backup", `${token}x`)).status, 401, "wrong token");
    const ok = await post("/api/database/backup", token);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "application/gzip");
    assert.ok(Number(ok.headers.get("x-backup-size")) > 0);
    const { gunzipSync } = await import("node:zlib");
    assert.equal(JSON.parse(gunzipSync(Buffer.from(await ok.arrayBuffer())).toString("utf8")).format, "mfv01-db-backup");
    // The token is not a session: it opens nothing else.
    assert.equal((await post("/api/database/restore", token)).status, 401);
    const records = await callWorker(w, new Request("http://127.0.0.1/api/records", { headers: { authorization: `Bearer ${token}` } }), env, ctx);
    assert.equal(records.status, 401);
  } finally {
    delete process.env.BACKUP_TOKEN;
  }

  // A too-short configured token is ignored.
  process.env.BACKUP_TOKEN = "short";
  try {
    assert.equal((await post("/api/database/backup", "short")).status, 401);
  } finally {
    delete process.env.BACKUP_TOKEN;
  }
});

// Runs last: a restore signs everyone out (the test logs the admin back in for the cleanup hook).
test("database backup: full backup round-trips through restore; bad files change nothing", async () => {
  const wrong = await call("POST", "/api/database/backup", { cookie: adminCookie, body: { password: "definitely-wrong" } });
  assert.equal(wrong.status, 403);

  const w = await loadWorker();
  const backupResponse = await callWorker(
    w,
    new Request("http://127.0.0.1/api/database/backup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mfv01-remote-addr": TEST_IP, cookie: adminCookie },
      body: JSON.stringify({ password: "admin123" }),
    }),
    env,
    ctx,
  );
  assert.equal(backupResponse.status, 200);
  assert.equal(backupResponse.headers.get("content-type"), "application/gzip");
  assert.match(backupResponse.headers.get("content-disposition") ?? "", /attachment; filename="mfv01-yedek-.+\.json\.gz"/);
  const backupBytes = Buffer.from(await backupResponse.arrayBuffer());
  const { gunzipSync, gzipSync } = await import("node:zlib");
  const doc = JSON.parse(gunzipSync(backupBytes).toString("utf8"));
  assert.equal(doc.format, "mfv01-db-backup");
  for (const table of ["users", "cash_accounts", "records", "cash_transfers", "finance_notes", "settings"]) {
    assert.ok(Array.isArray(doc.tables[table]), `backup has ${table}`);
  }
  assert.ok(!("sessions" in doc.tables), "sessions are not backed up");
  assert.ok(doc.tables.records.some((r) => createdRecordIds.includes(r.id)), "test records are in the backup");

  // Broken uploads are rejected and leave the data alone.
  const garbage = await callForm("/api/database/restore", { cookie: adminCookie, fields: { password: "admin123" }, files: { file: { bytes: Buffer.from("not a backup"), name: "x.json" } } });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.json?.code, "bad_file");
  const otherSchema = gzipSync(JSON.stringify({ ...doc, schema: "1:0" }));
  const mismatch = await callForm("/api/database/restore", { cookie: adminCookie, fields: { password: "admin123" }, files: { file: { bytes: otherSchema, name: "old.json.gz" } } });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.json?.code, "schema_mismatch");
  const wrongPw = await callForm("/api/database/restore", { cookie: adminCookie, fields: { password: "definitely-wrong" }, files: { file: { bytes: backupBytes, name: "b.json.gz" } } });
  assert.equal(wrongPw.status, 403);

  // A record created after the backup must be gone after the restore.
  const after = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_afterbackup`, amount: 7, currency: "USD", cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(after.status, 201);
  createdRecordIds.push(after.json.record.id);

  const restored = await callForm("/api/database/restore", { cookie: adminCookie, fields: { password: "admin123" }, files: { file: { bytes: backupBytes, name: "b.json.gz" } } });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.ok(restored.json.rows > 0);

  // Everyone is signed out.
  const oldSession = await call("GET", "/api/auth/session", { cookie: adminCookie });
  assert.equal(oldSession.status, 401);
  const login = await call("POST", "/api/auth/login", { body: { username: "admin", password: "admin123" } });
  assert.equal(login.status, 200);
  adminCookie = login.cookie;

  const records = await call("GET", "/api/records", { cookie: adminCookie });
  const ids = records.json.records.map((r) => r.id);
  assert.ok(!ids.includes(after.json.record.id), "post-backup record is gone");
  assert.ok(createdRecordIds.slice(0, -1).some((id) => ids.includes(id)), "pre-backup records are back");

  // Id counters were moved past the restored rows: a new record gets a fresh id.
  const fresh = await call("POST", "/api/records", {
    cookie: adminCookie,
    body: { kind: "income", date: "2026-01-15", source: `${RUN_TAG}_afterrestore`, amount: 1, currency: "USD", cashAccount: `${RUN_TAG}_kasa` },
  });
  assert.equal(fresh.status, 201);
  assert.ok(!ids.includes(fresh.json.record.id));
  createdRecordIds.push(fresh.json.record.id);
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
  for (const kasaId of [adminKasaId, ...extraKasaIds]) {
    if (kasaId) await call("DELETE", `/api/cash-accounts/${kasaId}`, { cookie: adminCookie }).catch(() => {});
  }
  if (testUserId) {
    await call("DELETE", `/api/users/${testUserId}`, { cookie: adminCookie }).catch(() => {});
  }
  if (testWsId) await call("DELETE", `/api/sections/${testWsId}?reason=test%20cleanup`, { cookie: adminCookie }).catch(() => {});
  await call("DELETE", `/api/admin/blocked-ips/${encodeURIComponent(TEST_IP)}`, { cookie: adminCookie }).catch(() => {});
});
