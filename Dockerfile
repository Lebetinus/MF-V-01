# ---- Build stage: every dependency, then compile the app ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Runtime stage: production dependencies only ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# server.mjs binds to 127.0.0.1 by default, which nothing outside the
# container can reach — the reverse proxy in front of it included.
ENV HOST=0.0.0.0
ENV PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
# dist/ is what the server serves; drizzle/ holds the migrations it applies
# on start, before it accepts traffic.
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY server.mjs ./
# The only way to create the first account: there is no self-service
# bootstrap, and login looks the user up in a table that starts empty.
COPY scripts/seed-users.mjs ./scripts/

EXPOSE 8080
# Lets Docker (and Coolify's rolling update) know when the new container is
# actually serving: traffic is switched to it only once /api/health answers,
# instead of the moment the process starts. Uses node because the slim image
# has no curl/wget. start-period covers the migrations run at startup.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node runs as PID 1 and handles SIGTERM itself (graceful shutdown in server.mjs).
CMD ["node", "server.mjs"]
