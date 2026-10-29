# Taste Brain — one image: the built client is served by the API.
# Build from the repository root:  docker build -t taste-brain .
# Node 24 because the graph store and the ledger use the built-in node:sqlite.

FROM node:24-slim AS build
WORKDIR /app
ENV CI=1

# Dependencies first, so a source-only change reuses this layer.
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN cd server && npm ci && cd ../client && npm ci

# Client: tsc -b + vite build -> client/dist
COPY client/ ./client/
RUN cd client && npm run build

# Server: tsc + copy-assets (packs/data, qloo/fixtures, eval) -> server/dist
COPY server/ ./server/
RUN mkdir -p server/public && cp -r client/dist/. server/public/ && cd server && npm run build


FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080

# Only the three runtime packages are installed: express, cors, zod.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/server/dist ./dist
# The static client the API mounts when server/public is present (http.ts:541).
COPY --from=build /app/server/public ./public

# No .env is copied. Configuration comes from host variables only:
#   QLOO_API_KEY, QLOO_ENABLED, DEFAULT_MODE, QLOO_FORCE_LIVE, GRAPH_DB,
#   TRUST_PROXY_HOPS, LEDGER_HMAC_SECRET, PACK_OVERLAY_B64.
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
