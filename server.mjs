// Production entry point (the Docker image's CMD; deployed on Coolify).
//
// Serving itself (static assets, RSC/SSR rendering, API route dispatch,
// compression) is delegated to vinext's own production server
// (startProdServer). What this file adds on top: migrations before the
// server accepts traffic (under an advisory lock), security headers and
// request body limits on every response, a periodic sweep of expired
// sessions, and graceful shutdown on SIGTERM.
//
// Usage:
//   npm run build
//   node --env-file=.env.local server.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { startProdServer } from "vinext/server/prod-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "127.0.0.1";
const MIGRATIONS_FOLDER = path.resolve(__dirname, "drizzle");

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  pool.on("error", (err) => console.error("[migrate] idle client error", err));
  // During a rolling deploy the old and the new container can start at the
  // same time; a session-level advisory lock makes their migration runs take
  // turns instead of racing on the same tables.
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext('mfv01:migrations'))");
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[migrate] up to date");
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext('mfv01:migrations'))").catch(() => {});
    lockClient.release();
    await pool.end();
  }
}

// Request body limits (bytes, by Content-Length). The app's own validators
// cap individual fields, but nothing stopped a client from sending a huge
// body that the route then buffers in memory — including the unauthenticated
// login route. Attachments are base64 (5 × ~6 MB per record), and the
// database import carries the whole backup, hence the larger allowances.
const MB = 1024 * 1024;
function bodyLimitFor(pathname) {
  if (pathname.startsWith("/api/auth/")) return 64 * 1024;
  if (pathname === "/api/database/import" || pathname === "/api/database/restore") return 512 * MB;
  return 64 * MB;
}

// Security headers. Coolify's Traefik proxy adds none by default, so the app
// sends them itself. (Set here rather than in next.config.ts headers():
// vinext 0.0.50 does not apply config headers to App Router page responses.)
// CSP notes:
// - The app loads nothing from other origins (no fonts/CDNs/analytics).
// - 'unsafe-inline' scripts: vinext/RSC inlines the page payload as
//   <script> tags; needed until nonce support is wired up.
// - data:/blob: images and frames: avatar/logo data URLs, PDF/image attachments.
// HSTS is ignored by browsers over plain HTTP (local testing).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = [
  ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
  ["Strict-Transport-Security", "max-age=31536000"],
];

const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// Belt-and-suspenders alongside the per-login trim in app/api/_lib/auth.ts:
// this catches sessions left behind by users who never log back in.
function startSessionCleanupTimer() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  // Without this, an idle connection dropped by a Postgres restart emits an
  // unhandled "error" event and crashes the whole process.
  pool.on("error", (err) => console.error("[sessions] idle client error", err));
  async function sweep() {
    try {
      const result = await pool.query("DELETE FROM sessions WHERE expires_at < now()");
      if (result.rowCount) console.log(`[sessions] cleaned up ${result.rowCount} expired session(s)`);
    } catch (error) {
      console.error("[sessions] cleanup failed", error);
    }
  }
  sweep();
  const timer = setInterval(sweep, SESSION_CLEANUP_INTERVAL_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await pool.end().catch(() => {});
    },
  };
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  await runMigrations();
  const sessionCleanup = startSessionCleanupTimer();

  const { server } = await startProdServer({
    port: PORT,
    host: HOST,
    outDir: path.resolve(__dirname, "dist"),
  });

  // Wrap vinext's request handler so we run first on every request: security
  // headers on every response (pages, API, static files, errors), the body
  // size limit, and "Connection: close" while shutting down.
  const vinextHandlers = server.listeners("request");
  server.removeAllListeners("request");
  let shuttingDown = false;
  server.on("request", (req, res) => {
    for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value);
    if (shuttingDown) res.setHeader("Connection", "close");
    const length = Number(req.headers["content-length"] ?? 0);
    const pathname = (req.url ?? "/").split("?")[0];
    if (length > bodyLimitFor(pathname)) {
      res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify({ error: "İstek çok büyük" }));
      req.destroy();
      return;
    }
    for (const handler of vinextHandlers) handler.call(server, req, res);
  });

  // Graceful shutdown: Coolify/Docker send SIGTERM on every redeploy. Stop
  // accepting new connections, let in-flight requests (a save, an import)
  // finish, then exit — instead of being SIGKILLed mid-write after the
  // timeout. A hard deadline still guarantees the process exits.
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, finishing in-flight requests…`);
    setTimeout(() => {
      console.warn("[server] shutdown timeout, exiting");
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await sessionCleanup.stop();
      console.log("[server] closed cleanly");
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log(`[server] MF-V-01 listening on http://${HOST}:${PORT}`);
  console.log("[server] Security headers and body size limits are applied here; TLS is the reverse proxy's job.");
}

main().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
