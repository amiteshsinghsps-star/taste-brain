# Neutronz Company Brain — single-image build:
#   the Express API and the built React UI are served from one port (:5000),
#   so `docker compose up` gives you the whole demo.
# Stages: client bundle -> server build -> migrator -> slim runtime.

# ==========================================
# Stage 1: client bundle (Vite + React)
# ==========================================
FROM node:20-alpine AS client-builder
WORKDIR /app/client

# Empty string = the UI calls the same origin it was served from (server/index.ts
# exposes the API on the same port). Set VITE_BACKEND_URL at build time to split them.
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ==========================================
# Stage 2: server build (Express + TS + Prisma)
# ==========================================
FROM node:20-alpine AS server-builder
WORKDIR /app/server

RUN apk add --no-cache openssl

COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma/
RUN npm ci

COPY server/ ./
RUN npx prisma generate && npm run build

# ==========================================
# Stage 3: migrator (one-shot `prisma migrate deploy`)
# ==========================================
FROM server-builder AS migrator
WORKDIR /app/server
CMD ["npx", "prisma", "migrate", "deploy"]

# ==========================================
# Stage 4: runtime (production deps only)
# ==========================================
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production \
    PORT=5000

ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT

COPY server/package.json server/package-lock.json ./server/
COPY server/prisma ./server/prisma/
RUN cd server && npm ci --omit=dev

COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/node_modules/.prisma ./server/node_modules/.prisma
COPY --from=server-builder /app/server/node_modules/@prisma ./server/node_modules/@prisma

# Built UI, served by the API process for single-port demo hosting.
COPY --from=client-builder /app/client/dist ./server/public

WORKDIR /app/server
EXPOSE 5000

CMD ["node", "dist/index.js"]
