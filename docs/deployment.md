# Deployment

The only deployment target this repo is built and verified for is **the local
Docker stack**: four services in one `docker-compose.yml`, no cloud account, no
managed service, no IaC. Nothing here creates or assumes an external resource.

```bash
docker compose up -d --build          # FalkorDB + Postgres + migrate + app
open http://localhost:5000            # the product (API and built UI, one port)
open http://localhost:3001            # FalkorDB Browser UI — the graph itself
curl -s http://localhost:5000/api/status | python -m json.tool
```

`/api/status` is the proof step: it asks FalkorDB for live node/edge counts via
`CALL db.meta.stats()` (`server/src/services/brain/status.service.ts`) and
reports `backend: "falkordb"`, graph reachability, graph count, Postgres
presence, whether an LLM key is configured, and the feature flags. It returns
`nodes`/`edges` summed across at most 100 graphs and never leaks tenant names
or ids. A stale cache cannot fake it, because there is no cache.

Re-run that assertion with `node scripts/check-status.mjs --expect-graph`
(fails non-zero if the backend is not FalkorDB, or if node/edge counts are 0).
This is also a CI step.

## Services

| Service | Image / target | Port | Role | Healthcheck |
| :--- | :--- | :--- | :--- | :--- |
| `falkordb` | `falkordb/falkordb:latest` | 6379 (data), 3001→3000 (Browser UI) | System of record: one graph per tenant | `redis-cli ping` |
| `postgres` | `postgres:16` | 5432 | Users, refresh tokens, connector metadata, raw ingested payload, audit rows | `pg_isready` |
| `migrate` | Dockerfile target `migrator` | — | Runs `prisma migrate deploy` once, then exits | `restart: "no"`, gating for `app` |
| `app` | Dockerfile target `runner` | 5000 | Express API + the built React client, same origin | `GET /api/status` from inside the container |

Startup order is enforced by `depends_on` conditions: `app` starts only after
`migrate` completed successfully and both databases are healthy.

## Image layout (`Dockerfile`, four stages)

1. **`client-builder`** — `node:20-alpine`, `npm ci`, `vite build`. Takes
   `ARG VITE_BACKEND_URL`; empty by default, meaning the UI calls the same
   origin it is served from. Split the two only if you front the API separately.
2. **`server-builder`** — `npm ci`, `prisma generate`, `tsc`. `openssl` is
   installed because Prisma's engines and `argon2` need it on Alpine.
3. **`migrator`** — same layer as the build, `CMD ["npx","prisma","migrate","deploy"]`.
   Migrations, not `db push`, so a blank volume converges to the committed schema.
4. **`runner`** — production dependencies only (`npm ci --omit=dev`), the
   compiled `dist`, the generated Prisma client, and the client bundle copied
   to `server/public`, which `server/src/index.ts` serves statically. `GIT_COMMIT`
   is baked in as `ARG`/`ENV` and surfaces in `/api/status` and `server/src/eval/results.json`.

`.dockerignore` keeps `node_modules`, `dist`, `.env`, media and docs out of the
context — the image is built from source, and local secrets never enter a layer.

## Configuration

Everything is environment-driven; `server/.env.example` documents every variable.

| Variable | Compose default | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/Neutronz_auth` | set inside the network, not on the host |
| `FALKORDB_HOST` / `FALKORDB_PORT` | `falkordb` / `6379` | the app reaches the graph by service name |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | throwaway local values | **the server refuses to start in production with the defaults** — set long random values |
| `CLIENT_ORIGIN` | `http://localhost:5000` | CORS allow-list |
| `OPENAI_API_KEY` | empty | optional; without it extraction uses the heuristic extractor and answers are cited graph facts |
| `EMBEDDINGS_MODEL` / `EMBEDDINGS_DIM` | `text-embedding-3-small` / `256` | `EMBEDDINGS_DIM` must equal the model's output dimension; the vector index is created with it |
| `FF_LIVE_CONNECTORS` | `0` | live Gmail/Drive/Slack/SQL sync stays off; see below |
| `FALKORDB_REQUIRED` | unset (CI sets `1`) | when set, tests fail instead of skipping if the graph is unreachable |
| `GIT_COMMIT` | `dev` | provenance stamp |

### Live connectors are off by default

`FF_LIVE_CONNECTORS` gates `IngestionService.connectSource` / `syncSource`
(`server/src/config/flags.ts`). With the flag unset, OAuth-style sources return
**403 `LIVE_CONNECTORS_DISABLED`**, the Connectors page renders a banner saying
so, and `GET /api/status/connectors` returns the same statement the UI shows.
The graph therefore contains only synthetic demo data plus files you upload.
Turning it on requires real credentials and is out of scope for this submission:
the demo must not depend on, or leak, anyone's private account.

## Volumes and data

`falkordb_data` and `pg_data` are named volumes. `docker compose down` keeps
them; `docker compose down -v` deletes them (and with them the demo company —
re-create it with *Load demo company*). Nothing in this repo writes to a bind
mount outside the project directory.

## Verifying a deployment

```bash
node scripts/check-status.mjs --expect-graph          # graph is the backend, counts > 0
cd server && npm run e2e:v3                           # 42 black-box checks over HTTP
cd server && npm run test:removal                     # 9 checks: graph down = 503, no fallback
```

There is no staging/production split, no secrets manager, no TLS termination, no
backup automation and no horizontal scaling story in this repo, and none is
claimed. The compose file is a single-host developer stack: the database
passwords are the literal defaults, so it must not be exposed to a network.
