# QA log

Date: 2026-10-18. Environment: Windows 11 (build 26200), Node 20 in Docker / Node 26
for scripts, FalkorDB `falkordb/falkordb:latest` and PostgreSQL 16 in Docker on
`localhost`, app server on `:5000`, FalkorDB Browser UI on `:3001`.

## Method — and its limits (read this first)

Three kinds of verification are recorded below, and they are **not** equally
strong. Each row says which kind backs it:

| Kind | What it actually means |
| :--- | :--- |
| **HTTP** | A black-box request against the running server, asserted by `npm run e2e:v3` (42 checks) or `curl`. Real, reproducible, but it checks payloads, not pixels. |
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
| Unit + graph tests | `cd server && npm run test:ci` (then `node ../scripts/check-no-skips.mjs tests/vitest.json`) | **35 passed, 0 failed, 0 skipped** with `FALKORDB_REQUIRED=1` — 3 files: `neutronz.test.ts` (7: T1–T5, T7, extraction gate, T16–T23), `graph-v3.test.ts` (10) and `insights-v4.test.ts` (18 Track 04) |
| Black-box HTTP | `cd server && npm run e2e:v3` | **42/42** (checks 1–26 the pre-v4 demo path, 27–42 the Track 04 endpoints) |
| Removal test (graph is load-bearing) | `cd server && npm run test:removal` | **9/9** — 503 `GRAPH_UNAVAILABLE` on a dead port, same binary works when the graph returns |
| Type check | `cd server && npx tsc --noEmit` | clean |
| Server build | `cd server && npm run build` | clean |
| Client build | `cd client && npm run build` | clean (Vite, no errors) |
| Lockfile guard | `node scripts/check-lockfile.mjs` | clean — no rewritten/integrity-damaged lockfiles |
| Eval | `cd server && npm run eval` | entity recall 55% → 70%, source recall 65% → 90%, currency 95% → 100% (`server/docs/EVAL.md`) |
| Docker stack | `docker compose up -d --build` | built and started: `neutronz-falkordb`, `neutronz-postgres`, one-shot `migrate`, `neutronz-app` — all healthy; `prisma migrate deploy` applied on the blank-service path, and `npm ci` succeeded in all four image stages (which is the lockfile install proof for both packages) |
| Status assertion | `node scripts/check-status.mjs --expect-graph` | last run: `HTTP 200 backend=falkordb falkordb=true graphs=52 nodes=4872 edges=5715 llm=none version=dev`. Totals climb with every demo tenant **and every test run** (each `e2e:v3` pass registers throwaway tenants and each vitest graph test writes scratch graphs), so this number is intentionally a moving one — nothing is cached, which is the point of the assertion |
| Docker e2e | `E2E_BASE_URL` default `http://localhost:5000` → `cd server && npm run e2e:v3` | **42/42 against the container**, after rebuilding the image (`docker compose up -d --build`, exit 0). The image running before the rebuild was a v3 bundle without the Track 04 routes, so this run is the one that backs the deployed-stack claim. The same 42 also passed against a dev server on `:5050` on the same code. Route presence checked directly on `:5000`: `GET /api/brain/path`, `/brain/handoffs`, `/brain/freshness-digest`, `/brain/graph/export`, `/watchlist`, `/brain/saved-queries` each answer **401 unauthenticated, not 404**, so all sixteen endpoints are registered in the image. Container path: register → seed demo → why-not → query with 8 citations / 12 hops → freight `FLAGGED` → precedents on the card → approve → ledger grows → simulate `total=31 changed=5 replayFidelity=100%` → discard no-op → apply `..._v2` → stale queue → second-tenant isolation → memory write/recall/stats → the 16 Track 04 checks → `ledger still verifies`. |
| Static UI served by the image | `curl -I http://localhost:5000/` and its assets | `GET /` → 200 `text/html` (1421 B), `/assets/index-*.js` → 200 `application/javascript`, `/assets/index-*.css` → 200 `text/css`, `/favicon.svg` → 200, `GET /api/status/connectors` → 200 with the banner string |

## Page-by-page

| Screen | Backing | What was confirmed |
| :--- | :--- | :--- |
| Auth (sign up / log in) | HTTP + TEST | `POST /api/auth/register`, `POST /api/auth/login` return a JWT + rotating refresh cookie; every e2e check runs through this path. |
| Onboarding / *Load demo company* | HTTP | `POST /api/brain/seed-demo` returns node/edge counts; a scratch-tenant re-seed and census measures **133 nodes / 150 edges** for `NorthwindSeeder` + `SeedV3` together (the 135/156 this doc previously quoted did **not** reproduce; nothing here explains the two-node difference, so the re-measured census is the number to quote), i.e. the demo data really landed in FalkorDB. |
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
| **Connection path** (Track 04) | HTTP + TEST | `GET /api/brain/path?from=&to=&hops=` returns a directed `shortestPath` chain (measured: `"Maya Rao" → "Operations"`, hops=1, node count = edge count + 1) and an **absence with both endpoint degrees** for an unmatched id. The `shortest_path` MCP/HTTP tool now delegates here instead of erroring. **The panel nobody has opened in a browser.** |
| **Rule version diff** | HTTP + TEST | `GET /api/brain/rules/:ruleId/versions` — measured `3 version(s): v1(SUPERSEDED), v1(SUPERSEDED), v2(ACTIVE); maxCreditLimit 5000 → 10000`. Order comes from `SUPERSEDES` edges, not the `version` string (bug 11). |
| **Decision timeline** | HTTP + TEST | `GET /api/brain/timeline?subject=BK-1042` — 3 events, newest first; an unmatched subject returns "Nothing in the graph…" rather than an empty list. |
| **Handoff board** | HTTP + TEST | `GET /api/brain/handoffs` — 1 handoff over 4 agents (`Freight Desk Agent→Email Triage Agent`), read from `HANDED_OFF_TO` edges. |
| **Explain this node** | HTTP + TEST | `GET /api/brain/explain/:id` — Policy "Denied-Party Screening": 14 neighbours, 2 source chunks quoted verbatim, 6 decisions, the 👍/👎 the answers built from it earned. Unknown id → `null` → 404. |
| **Freshness digest** | HTTP + TEST | `GET /api/brain/freshness-digest?days=30` — supersededDocs=1 supersededRules=3 stale=1 pending=0. **Limitation (documented in cypher-queries.md §Y-8): the `days` window applies only to the decision count.** |
| **Answer feedback 👍/👎** | HTTP + TEST | `POST /api/brain/feedback` → 201; the rating lands as a `Feedback` node `ABOUT` the cited `Chunk`. Measured coupling: thumbs-down moved Knowledge Health **67 → 63** and added one `SOURCE_THUMBS_DOWN` finding for `doc_seed_denied_party_sop_v3_c0`; a 👍 on the same pair cancels it. Bogus chunk ids are refused (`linkedOnBogusId=0`). Writes **no** ledger entry, deliberately. |
| **Your own watchlist entry** | HTTP + TEST | `POST /api/watchlist` → node written + preview over the 31 stored bookings (`GET /api/watchlist/preview`) using the same substring match as the engine → the **pure** engine then returns `FLAGGED` for that shipper → `DELETE /api/watchlist/:id` → the same booking returns `PASSED`. Deleting a seeded demo entry is refused with 409. |
| **Pinned brain queries** | HTTP + TEST | `POST`/`GET /api/brain/saved-queries`, `DELETE /api/brain/saved-queries/:id` — saved=201, owner sees 1, a second tenant sees 0, after delete 0. Empty question refused. |
| **Graph export** | HTTP + TEST | `GET /api/brain/graph/export?format=json|graphml|csv|nodes` — json nodes=150 edges=183, graphml 70410 chars containing 183 `<edge>`, csv 183 rows, `Content-Disposition: attachment; filename="neutronz-brain-2026-10-18.json"` (no internal graph name in the filename). All three formats carry the same counts. |

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
9. **The UI showed fabricated data as if live.** The Overview "Needs Attention"
   card invented a specific booking awaiting verification and a staged email
   reply (no such queue state existed), the Header/Overview greeting hard-coded a
   fake "Ops Manager / ADMIN / VERIFIED" persona, the Profile page defaulted to a
   fake company/email/domain/role, and the Freight form was pre-filled with fake
   parties. All removed: the UI now binds the real logged-in user (name/role/
   email/id from `/auth/me`) and makes no fabricated state claims. The Freight
   "Sanction Flagged" preset named a shipper that is **not** on the seeded
   watchlist, so it never actually flagged — corrected to a real watchlist name.
   The security-claims panel on Profile was checked against `server/src` and is
   accurate (Argon2id with PBKDF2 fallback, the five HTTP security headers are set
   in `index.ts`), so it stays. **This is a code fix, not yet browser-verified —
   the human click-through (below) is still outstanding.**

### Track 04 pass (the ten new features)

10. **`shortest_path` errored on every call.** The tool used a form FalkorDB does
    not evaluate (`shortestPath` outside a WITH/RETURN, and undirected). Fixed by
    `directedShortest()` in `insights.service.ts:142-155`, called forward then in
    reverse (`:194-195`). Asserted by *`shortest_path` tool answers instead of
    erroring*. Consequence, stated in the answer itself: connectivity here is
    **directed** — there is no symmetric "connected at any cost" lookup
    (`insights.service.ts:203`, `:231`), and the UI repeats that.
11. **Rule-version diff could report the wrong direction.** `ruleVersionDiff`
    ordered versions by the stored `version` number, and the demo seed writes
    `version: 1` on **both** credit-rule nodes with *different* params, so the
    chronology was a coin flip. Now ordered by `SUPERSEDES` edges with the id as a
    deterministic tiebreak (`insights.service.ts:316-322`), and
    `insights-v4.test.ts:68-98` asserts that every newest end of a `SUPERSEDES`
    edge sorts after the end it supersedes. Related cosmetic fix: equal version
    numbers no longer print a misleading `v1 → v1`, they fall back to ids
    (`insights.service.ts:347`).
12. **The export filename leaked the internal graph name** (`tenant_<userId>`),
    which is an identifier the client is never supposed to learn. Now
    `neutronz-brain-<date>.<ext>`.
13. **GraphML mangled names containing markup.** One `xml()` helper escaped both
    element text *and* attribute ids, so an escaped `&` in a node name produced a
    broken `id="n_…"` reference. Split into `xmlText()` and `xmlId()`
    (`export.service.ts:48`, `:59`) with the test
    *escapes markup in node names instead of breaking the document*.
14. **FalkorDB aggregation traps** (three separate wrong-answer bugs, all found by
    running the query and counting, not by reading docs): implicit grouping needs
    an explicit `WITH … collect()`; two `OPTIONAL MATCH`es cross-multiply so the
    count must be `count(DISTINCT …)`; `LIMIT` accepts a parameter but a
    variable-length bound does not, so `hops` is clamped with `clampInt(…, 1, 6, 5)`
    and interpolated as a literal only after that (`insights.service.ts:131-135`).
15. **The Ask Brain UI read fields that do not exist** — `brainResult.query` and a
    top-level `traceId`. The response carries `searchQuery` and
    `trace.traceId` (`client/src/pages/AskBrainPage.tsx:9`, `:53-55`). This would
    have shown empty pins and a missing trace id in the feedback payload — a
    silent UI bug the production build alone did not catch, because TypeScript was
    not told about the shape.
16. **Two defects that only a build reveals:** an unannotated `graphData.links`
    inferred `unknown[]` and broke `npm run build` in `client/`; and the new
    vitest booking fixture passed `value`, which `BookingInput` does not have
    (`invoiceAmount` is the field) — the engine had been reading `undefined` and
    the assertion still passed, which is exactly why the fixture was wrong.
17. **Watchlist preview does not re-implement screening.** It calls the same
    substring match the pure engine uses (`AB2` in
    [`cypher-queries.md`](cypher-queries.md)) rather than duplicating rule logic —
    deliberately, so preview and verdict can never drift. Documented as a design
    note, not a bug.

## Open items a reviewer should check in a browser

- Visual layout of the three-column evidence block on Task Approvals at narrow
  widths.
- Graph explorer canvas (zoom/pan) — API responses verified, rendering not.
- Chat/answer markdown rendering with an LLM key configured (this run had none,
  so every answer above came from the cited-graph-facts fallback).
- Any page reachable only through the pre-existing connectors OAuth flow — those
  are intentionally disabled by the flag and were not exercised.
- **All ten Track 04 panels.** Every one of them is asserted over HTTP and in
  vitest with the measured values quoted above, and the client compiles clean,
  but **no human has opened the connection path, rule diff, timeline, handoff
  board, explain-node, digest, feedback buttons, watchlist add/remove, pins or
  export in a browser.** That is the single largest gap in this log, and it is the
  first thing to do before recording the demo.
- ~~The `:5000` container is behind the code being tested~~ — resolved during this
  pass: the image was rebuilt and `npm run e2e:v3` passes **42/42 against the
  container** (see the Docker e2e row above), so the deployed stack and the
  tested stack are now the same code.

## What is still owed before submission (not verification, shipping)

Unchecked when this was written, in the order they should be done: human
click-through of every page with the results entered above corrected to what is
actually seen; a fresh-clone install in a new directory (`docker compose up -d`,
`npm ci`, seed, `test:ci`); key rotation for anything in `server/.env` that ever
appeared in a chat, screenshot or shared zip, plus a secret scan before publish;
deployment on an always-on host so `/api/status` answers logged-out (or local
instructions plus the video); the demo recording itself; the public push and a
logged-out read of the README; then the blog post and submission. **Commit
timestamps in this repo are a single Oct 18 consolidation of a working copy, not a
development timeline** — see the provenance section of the README. Nothing here
should be backdated or rewritten.
