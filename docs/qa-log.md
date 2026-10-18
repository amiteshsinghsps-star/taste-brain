# QA log

Date: 2026-10-18. Environment: Windows 11 (build 26200), Node 20 in Docker / Node 26
for scripts, FalkorDB `falkordb/falkordb:latest` and PostgreSQL 16 in Docker on
`localhost`, app server on `:5000`, FalkorDB Browser UI on `:3001`.

## Method — and its limits (read this first)

Three kinds of verification are recorded below, and they are **not** equally
strong. Each row says which kind backs it:

| Kind | What it actually means |
| :--- | :--- |
| **HTTP** | A black-box request against the running server, asserted by `npm run e2e:v3` (26 checks) or `curl`. Real, reproducible, but it checks payloads, not pixels. |
| **TEST** | Vitest against the live FalkorDB + Postgres (`npm run test:ci`, `npm run test:removal`). Graph tests refuse to skip when FalkorDB is down (`FALKORDB_REQUIRED=1`, `server/tests/global-setup.ts`). |
| **INSPECT** | I read the code path and confirmed it is wired (component → `client/src/lib/api.ts` → route → service → Cypher). This is **not** the same as watching the page render. |

**What was NOT done:** nobody clicked through the React UI in a browser and
watched these screens paint. There is no browser automation in this repo, and I
did not fabricate a click-through log. The UI is verified by a clean production
build (`npm run build` in `client/`), by the HTTP layer every page calls, and by
code inspection. Anything that only INSPECT supports is marked below, so a
reviewer knows exactly where to point a browser.

The one visual check that was done: the served bundle. `GET /` from the Docker
app container returns the built `index.html` and every referenced asset resolves
with 200 (see "Static UI" in the table).

## Automated results, as measured

| Suite | Command | Result |
| :--- | :--- | :--- |
| Unit + graph tests | `cd server && npm run test:ci` (then `node ../scripts/check-no-skips.mjs server/tests/vitest.json`) | **17 passed, 0 failed, 0 skipped** with `FALKORDB_REQUIRED=1` |
| Black-box HTTP | `cd server && npm run e2e:v3` | **26/26** |
| Removal test (graph is load-bearing) | `cd server && npm run test:removal` | **9/9** — 503 `GRAPH_UNAVAILABLE` on a dead port, same binary works when the graph returns |
| Type check | `cd server && npx tsc --noEmit` | clean |
| Server build | `cd server && npm run build` | clean |
| Client build | `cd client && npm run build` | clean (Vite, no errors) |
| Lockfile guard | `node scripts/check-lockfile.mjs` | clean — no rewritten/integrity-damaged lockfiles |
| Eval | `cd server && npm run eval` | entity recall 55% → 70%, source recall 65% → 90%, currency 95% → 100% (`server/docs/EVAL.md`) |
| Docker stack | `docker compose up -d --build` | built and started: `neutronz-falkordb`, `neutronz-postgres`, one-shot `migrate`, `neutronz-app` — all healthy; `prisma migrate deploy` applied on the blank-service path, and `npm ci` succeeded in all four image stages (which is the lockfile install proof for both packages) |
| Status assertion | `node scripts/check-status.mjs --expect-graph` | `HTTP 200 backend=falkordb falkordb=true graphs=34 nodes=3080 edges=3607 llm=none version=dev` (totals climb with every demo tenant loaded; nothing is cached) |
| Docker e2e | `E2E_BASE_URL` default `http://localhost:5000` → `cd server && npm run e2e:v3` | **26/26 against the container**, not against a dev server: register → seed demo (135/156) → why-not → query (8 citations, 12 hops, 161 ms) → freight `FLAGGED` → precedents on the card → approve → ledger 1→3→4 → simulate `total=31 changed=5 replayFidelity=100%` → discard no-op → apply `..._v2` + `maxCreditLimit=5000` → stale queue 2 → isolation on a fresh tenant → memory write+recall round-trip isolated per tenant → memory stats from the graph |
| Static UI served by the image | `curl -I http://localhost:5000/` and its assets | `GET /` → 200 `text/html` (1421 B), `/assets/index-*.js` → 200 `application/javascript`, `/assets/index-*.css` → 200 `text/css`, `/favicon.svg` → 200, `GET /api/status/connectors` → 200 with the banner string |

## Page-by-page

| Screen | Backing | What was confirmed |
| :--- | :--- | :--- |
| Auth (sign up / log in) | HTTP + TEST | `POST /api/auth/register`, `POST /api/auth/login` return a JWT + rotating refresh cookie; every e2e check runs through this path. |
| Onboarding / *Load demo company* | HTTP | `POST /api/brain/seed-demo` returns node/edge counts; `GET /api/status/graph` for the new tenant reports **135 nodes / 156 edges**, i.e. the demo data really landed in FalkorDB. |
| Ask Brain | HTTP + TEST | `POST /api/brain/query` returns answer, citations and a `trace` (T2 asserts trace presence). Trace panel is INSPECT for layout. |
| Decision Trace ("Why?") | HTTP + TEST | `GET /api/brain/trace/:traceId` returns the hop list; T22 asserts graph hops surface for an ownership question. Rendering order is INSPECT. |
| Graph explorer | HTTP | `GET /api/brain/graph`, `GET /api/brain/graph/node/:id` return nodes/edges. Canvas rendering INSPECT. |
| Freight Desk | HTTP | `POST /api/agents/:id/freight` with shipper "Denied Trading LLC" → engine verdict `FLAGGED`, staged task in Copilot (e2e check "copilot stages even a blocked shipment"). |
| Task Approvals | HTTP | Approval card payload carries verdict, per-rule margins, `precedents` (T22 + e2e check "approval card carries precedents from the graph") and the trace. Approving appends a ledger entry and writes `Person-[:DECIDED]->Decision-[:ABOUT]->Task`. |
| Policy Time Machine | HTTP + TEST | `POST /api/brain/simulate` → `total=31 changed=5 replayFidelity=100%`; T17/T18 assert Discard mutates nothing and Apply versions the rule + appends the ledger. Button wiring INSPECT. |
| Executable Skills (rules) | HTTP | `GET /api/brain/rules`, `POST /api/skills/update` (version bump) exercised in e2e. |
| Why-Not | HTTP + TEST | `GET /api/brain/why-not?booking=BK-1043` returns every rule with a numeric margin (T19). |
| Ledger | HTTP + TEST | `GET /api/ledger/verify` → `ok=true` and grows after each decision; T16 proves a tampered entry reports `brokenAt` at that exact seq, T16b proves 10 concurrent appends stay gapless. |
| Knowledge Health | HTTP + TEST | `GET /api/brain/health` → 67/100, 6 findings (T21 asserts the planted ones). |
| Needs Review | HTTP | `GET /api/brain/stale` lists the STALE rule + the superseded policy; revalidate drops the queue from 2 to 1. Toast/queue rendering INSPECT. |
| Impact analysis | HTTP | `POST /api/brain/impact` accepts a Policy **or** a Rule id and returns affected rules, owners, governed systems/agents, prior decisions. |
| Sources / Connectors | HTTP + TEST | With `FF_LIVE_CONNECTORS` unset, `POST /api/ingestion/sources` and `/sync` answer **403 `LIVE_CONNECTORS_DISABLED`**; `GET /api/status/connectors` returns the banner string the page renders. Upload-based ingestion still works. |
| Team & Access | HTTP | `POST /api/control/team`, `POST /api/control/access/grant|revoke` exercised; grants are audit-logged. |
| Agent memory | HTTP + TEST | `POST /api/memory/episodes` → 201, `GET /api/memory/recall?q=` round-trips the written marker and returns **0 for a second tenant**, `GET /api/memory/stats` reports counts from the graph. All three are now asserted inside `e2e:v3`, so this is HTTP-verified end to end, not just inspected. UI page layout remains INSPECT. |
| Static UI | HTTP | The Docker `app` container serves the built client: `GET /` → 200 `text/html`, `/assets/*.js` and `/assets/*.css` → 200. Healthcheck in `docker-compose.yml` hits `/api/status`. |
| MCP server | TEST + INSPECT | `cd server && npm run mcp -- --tenant <userId>` registers nine read-only tools; `similar_decisions` and `absence_check` are the same services the HTTP layer uses. Not driven from an actual MCP client in this session. |

## Bugs found and fixed during this QA pass

1. **`/api/status` reported `nodes: 0` while the label maps were populated.**
   `add()` merged label/relType counts but never recomputed the totals. Fixed in
   `server/src/services/brain/status.service.ts` (totals recomputed from the
   merged maps, so aggregating N graphs cannot lose counts).
2. **Graph-down requests returned HTTP 500 with a raw redis error** instead of
   the documented 503. `FalkorDB.connect()` resolves even against a dead port,
   so `requireFalkor()` now probes with `client.list()` (2 s TTL) and converts
   any connection failure to `GRAPH_UNAVAILABLE`.
3. **Idle containers failed the first click** after Docker dropped the socket.
   Added `startKeepAlive()` (30 s ping, discards the handle on failure).
4. **Approvals were not attributable in the graph.** `approveTask` wrote the
   `Decision` and `ABOUT` edge but no `Person-[:DECIDED]->` edge, and the ledger
   actor was the literal `human:approver`. Now merges the real user's Person node
   and records `human:<email>`.
5. **`central_entities` interpolated caller-supplied labels into Cypher.** Now
   allow-list filtered, refusal asserted by T23.
6. **Vitest hung 10 s at exit** ("close timed out after 10000ms"). Global setup
   teardown now closes the FalkorDB client and disconnects Prisma.
7. **Skipped tests could hide a dead graph.** `describe.skipIf` is evaluated at
   collection time, so skipping is now paired with `FALKORDB_REQUIRED=1` +
   `global-setup.ts` hard failure + `check-no-skips.mjs` in CI.
8. **Approval card read `c.text` for citations** — the citation shape is
   `{documentTitle, chunkId, snippet}`; switched to `c.snippet`.

## Open items a reviewer should check in a browser

- Visual layout of the three-column evidence block on Task Approvals at narrow
  widths.
- Graph explorer canvas (zoom/pan) — API responses verified, rendering not.
- Chat/answer markdown rendering with an LLM key configured (this run had none,
  so every answer above came from the cited-graph-facts fallback).
- Any page reachable only through the pre-existing connectors OAuth flow — those
  are intentionally disabled by the flag and were not exercised.
