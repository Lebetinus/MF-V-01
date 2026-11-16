import assert from "node:assert/strict";
import test from "node:test";
import { callWorker } from "./helpers/call-worker.mjs";

test("renders the app shell with its title and the asset-recovery script", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await callWorker(
    worker,
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Maliye-Finans<\/title>/);
  assert.match(html, /mfv01-asset-reload/, "layout ships the stale-asset reload guard");
});
