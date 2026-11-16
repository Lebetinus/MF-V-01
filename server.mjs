// Production entry point for running MF-V-01 on a self-hosted Node server
// (systemd, pm2, a plain `node server.mjs`, etc). Independent of the Electron
// desktop app in desktop/main.cjs — this is the one that actually listens on
// a network-reachable port and talks to Postgres.
//
// Serving itself (static assets, RSC/SSR rendering, API route dispatch,
// compression) is delegated entirely to vinext's own production server
// (see node_modules/vinext/dist/server/prod-server.js) rather than
// reimplemented here: an earlier version of this file hand-rolled an HTTP
// adapter that called `worker.fetch(request, env, ctx)` on dist/server/
// index.js's default export, copying a pattern from desktop/main.cjs. That
// assumption turned out to be wrong for a `vinext build` App Router output
// — the default export can also be a plain `handler(request)` function
// (this project's actual shape), which the hand-rolled adapter silently
// couldn't call, only discovered once tests/api.test.mjs exercised a real
// build. vinext's own `startProdServer` already handles both shapes
// correctly (see resolveAppRouterHandler in prod-server.js) plus static
// asset caching, compression, image optimization, etc. — reimplementing
// that here would just be a worse copy of it.
//
// What this file adds on top of `vinext start`: running migrations before
// the server accepts traffic, and a periodic sweep of expired sessions.
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
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[migrate] up to date");
  } finally {
    await pool.end();
  }
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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
}

async function main() {
  await runMigrations();
  startSessionCleanupTimer();

  const { server } = await startProdServer({
    port: PORT,
    host: HOST,
    outDir: path.resolve(__dirname, "dist"),
  });
  // Runs before vinext's own request handler, so every response (pages,
  // API, static files, errors) carries the security headers. Headers vinext
  // sets later for the same name would win, but it sets none of these.
  server.prependListener("request", (_req, res) => {
    for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value);
  });
  console.log(`[server] MF-V-01 listening on http://${HOST}:${PORT}`);
  console.log(
    "[server] Reminder: run this behind a reverse proxy (nginx/caddy) for TLS, " +
      "security headers (CSP, X-Frame-Options, HSTS), request body size limits, " +
      "and cross-origin request filtering — see deploy/ for examples.",
  );
}

main().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
