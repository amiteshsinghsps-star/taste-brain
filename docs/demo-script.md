# Demo script (7 minutes) + claims audit

Run against the Docker stack so the graph is visibly the backend:

```bash
docker compose up -d --build          # FalkorDB + Postgres + API + UI on :5000
curl -s localhost:5000/api/status | python -m json.tool | head -20
open http://localhost:3001            # FalkorDB Browser UI, keep it in a second window
```

`/api/status` answers with `backend: "falkordb"` and live node/edge counts pulled
from `CALL db.meta.stats()` — the numbers below are from the same instance, not
a description of it.

## Scene 0 — the graph is load-bearing (40 s)

```bash
cd server && npm run test:removal
```

Expected: 9/9, including `ask-the-brain fails with GRAPH_UNAVAILABLE` (HTTP 503)
while `FALKORDB_PORT` points at a dead port, and `same binary seeds the demo
company once the graph is back`. Say out loud: there is no keyword-search or
SQL fallback in the answer path; when the graph is gone the product says so.

## Scene 1 — load a company (45 s)

Sign up at `http://localhost:5000` → **Load demo company**. The banner on
*Connectors* states live Gmail/Drive/Slack sync is OFF: the graph contains only
synthetic Northwind Logistics data plus anything you upload.

Proof it landed in FalkorDB, not Postgres: open the Browser UI and run

```cypher
MATCH (n) RETURN labels(n)[0] AS label, count(n) AS nodes ORDER BY nodes DESC
```

Seeded tenant `tenant_demo-northwind` measures **135 nodes / 156 edges** —
13 people, 4 teams, 9 documents, 7 policies, 5 rules, 30 bookings, 22 decisions,
4 systems, 3 agents, 3 watchlist entries.

## Scene 2 — ask the brain, read the trace (90 s)

Ask Brain: *"Which systems and agents does the credit approval policy govern?"*
Then open **Why?** / the Decision Trace.

Expected (measured over HTTP): 8 citations, 12 graph hops over 20 nodes,
~175 ms, with `latencyMs` in the payload. The trace reads as sentences in
meaning order (`Rule → IMPLEMENTS → Policy`, `Person → OWNS → Policy`,
`Policy → GOVERNS → System`), each hop traceable via `GET /api/brain/trace/:traceId`.

Then the honest negative: ask who owns a policy that does not exist.
`POST /api/brain/tools` with `{"tool":"find_owner","args":{"entity":"Quantum Widget Policy"}}`
returns an **absence proof** — `candidateNodes: 0, edgesFound: 0` and the
sentence "0 OWNS edges exist. The graph does not record this relationship." —
instead of an empty list that looks like a bug.

## Scene 3 — an agent acts on connected data (90 s)

Freight Desk → new booking, shipper **Denied Trading LLC**, booking `BK-1042`.

Expected: the pure rule engine (not the LLM) returns `FLAGGED`; Copilot stages
the task even though the answer is "do not ship". Open **Task Approvals**: the
card now carries three columns — engine verdict with per-rule numeric margins,
the **precedents** pulled out of the graph, and the trace. Measured precedent
output for that booking:

```
REJECTED by Raj Mehta; FROZEN by Maya Rao; FLAGGED by Tom Okafor
```

Approve it → `GET /api/ledger/verify` shows the chain grew and still verifies
(`ok=true`), and the approval writes `(Person)-[:DECIDED]->(Decision)-[:ABOUT]->(Task|Policy)`,
so "who approved this, under which SOP" is answerable from the graph.

## Scene 4 — HERO: Policy Time Machine (120 s)

Executable Skills → pick **Automated Invoice Credit Approval**
(`maxCreditLimit = 10000`) → candidate `5000` → **Simulate**.

Expected, measured: `total=31 changed=5 replayFidelity=100% (31/31)` — the
current rule reproduces every stored verdict, which is what makes the
counterfactual trustworthy — plus impact: 2 affected rules, 1 owner, 1 agent,
and the customers whose bookings flip.

- **Discard** → `GET /api/brain/rules` still shows `maxCreditLimit=10000`. Nothing moved.
- **Apply** → `newRuleId=..._v2`, `maxCreditLimit=5000`, exactly one ACTIVE credit rule,
  the old version stays as `SUPERSEDED` (history is never deleted), ledger seq 4 appended.

Ask "why wasn't BK-1043 flagged?" (`GET /api/brain/why-not?booking=BK-1043`) to show
the margin: *amount 10,000 within the 10,000 threshold, margin 0* — and note it is
about to change if the new rule stands.

## Scene 5 — the graph tells you where it is rotting (60 s)

**Knowledge Health** → score **67/100 with 6 findings**
(`ORPHAN_POLICY, STALE_RULE, BUS_FACTOR ×3, DOC_NOT_REFRESHED`). **Needs Review**
→ pick *Legacy 4-digit HS Manifest Rule* → Impact (shows dependent policy, owners,
agents, prior decisions) → Mark reviewed → the queue drops from 2 to 1.

## Close (30 s)

```bash
cd server && npm run e2e:v3     # 26/26
npm run test:ci                 # 17 passed, 0 failed, 0 skipped
node ../scripts/check-lockfile.mjs
```

Graph-vs-plain-RAG eval (`npm run eval`, 20 golden questions × 3 runs, median):
entity recall 55% → **70%**, source recall 65% → **90%**, currency 95% → **100%**,
and on temporal questions specifically source recall 20% → **100%**.

---

## Scene 6 — agent memory, scoped per tenant (40 s)

**Agent Memory** in the sidebar. Write an episode ("Screened booking X: staged
for a human, nothing shipped", outcome `STAGED_FOR_APPROVAL`) → it lands as an
`Episode` node in *that tenant's* graph → recall it by keyword.

Measured over HTTP (`e2e:v3` checks 25–26): write returns 201, recall finds the
marker, and the **same query from a second tenant returns 0 memories** — memory
is not a shared vector store. Scope toggle shows agent-private vs tenant-shared;
`GET /api/memory/stats` reports the counts from the graph, not from Postgres rows.

---

## Track mapping

| Graph Hacks track | What in this demo is evidence |
| :--- | :--- |
| Company Brain | Scenes 1–2, 5: ingest → per-tenant graph → cited answers with traces → freshness queue |
| Agents That Act on Connected Data | Scene 3–4: policy lookup is Cypher, screening reads `WatchlistEntry` nodes, the ledger and Time Machine both write graph nodes |
| Agent Memory & Coordination | Scene 6: `Episode`/`Fact`/`Procedure`/`Conversation`+`Turn` nodes scoped per agent, `HANDED_OFF_TO` between agents, `GET /api/memory/recall`, per-tenant isolation asserted in `e2e:v3` |

## Claims audit

| Claim on the README | Where it is proven | Re-run |
| :--- | :--- | :--- |
| FalkorDB is the primary store, no silent fallback | `tests/neutronz.test.ts` T3, `src/eval/removal-test.ts` | `npm run test:removal` |
| One isolated graph per tenant | T1 (two tenants, overlapping entity names) + graph names derived from the JWT only | `npm run test:ci` |
| Every answer carries a trace | T2 + `traceId` on audit rows and approvals | `npm run e2e:v3` |
| The LLM never decides pass/fail | T5 (same screening input → same verdict across repeated runs); the engine in `src/services/rules/` is a pure function | `npm run test:ci` |
| Tamper-evident ledger | T16 (edit one entry → `brokenAt` == that seq), T16b (10 concurrent appends stay gapless) | `npm run test:ci` |
| Time Machine discard is pure / apply versions the rule | T17/T18 (discard mutates nothing, apply versions the rule + ledger entry, replay fidelity gate) + e2e checks | `npm run test:ci` |
| Graph beats plain RAG on these metrics | `src/eval/golden.json` + `src/eval/results.json`, written by `npm run eval` | `npm run eval` |
| Absence is reported, not swallowed | T23 (proves 0 OWNS edges; `find_owner` carries the statement) | `npm run test:ci` |
| Precedents come out of the graph, with the decider named | T22 (ranking by shared terms, `decidedBy` populated, unknown subject → `[]`) + e2e check on the approval card | `npm run test:ci` |
| User text is never part of a query | T7 (injection payload stored literally, not executed) + T23 allow-list refusal + the extraction validation gate in `tests/neutronz.test.ts`; identifiers are whitelisted before interpolation in `precedent.service.ts` and `tools.service.ts` | `npm run test:ci` |
| `/api/status` reports real graph counts | `src/services/brain/status.service.ts` (`CALL db.meta.stats()`) + `scripts/check-status.mjs --expect-graph`, run in CI and in the removal test | `node scripts/check-status.mjs --expect-graph` |
| Live connectors are off by default | `src/config/flags.ts`, 403 `LIVE_CONNECTORS_DISABLED`, e2e check, UI banner | `npm run e2e:v3` |
| Agent memory is typed and per-tenant, not a shared vector store | e2e checks 25–26 (write 201, recall finds the marker, second tenant recalls 0, stats from the graph) | `npm run e2e:v3` |
| Lockfiles install cleanly | `scripts/check-lockfile.mjs` in CI, `npm ci` for both packages | `node scripts/check-lockfile.mjs` |
| Cypher cannot be injected through identifiers | T6, plus label/relationship allow-lists in `precedent.service.ts` and `centralEntities` | `npm run test:ci` |
| "Graph algorithms" claims | **not claimed** — no `algo.pageRank`/`WCC`/`BFS` in the code; centrality is Cypher degree counting, path is `shortestPath()` | see `docs/cypher-queries.md` |
| SOC 2 / ISO / immutable / zero-hallucination | **not claimed anywhere** | `docs/features.md` §E |

## Recording note

The previous demo recording was removed with the branding it carried, so the
video has to be re-recorded before submission. Record the scenes above in order
(0–6, ≈7 min), keep the FalkorDB Browser UI visible in Scene 1 and 4, and show
`npm run e2e:v3` output (26/26) in the last 20 seconds. Captions: `ffmpeg` with
the SRT written from this script.
