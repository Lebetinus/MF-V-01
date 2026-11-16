import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Server-side route handlers read process.env directly (e.g. db/index.ts's
  // DATABASE_URL) — Vite only auto-exposes VITE_-prefixed vars to client code,
  // so .env.local values are loaded and copied onto process.env explicitly.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    // The dev server only listens on this machine: it runs with .env.local
    // (database credentials) loaded and must not be reachable from the LAN.
    server: { host: "localhost" },
    plugins: [vinext()],
    // pg lazily requires the optional native "pg-native" addon in a try/catch
    // at runtime; Vite's static resolution doesn't know that, so it must be
    // excluded rather than bundled.
    optimizeDeps: { exclude: ["pg-native"] },
    ssr: { external: ["pg", "pg-native", "exceljs", "jszip"] },
  };
});
