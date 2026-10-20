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

A freshly loaded demo company measures **133 nodes / 150 edges** —
13 people, 4 teams, 9 documents, 10 chunks, 7 policies, 5 rules, 30 bookings,
22 decisions, 4 systems, 4 customers, 12 invoices, 3 agents, 3 watchlist entries,
plus the planted `SUPERSEDES` versions and one `STALE` rule. That count was taken
by seeding a scratch graph (`tenant_scratch-seedcount-v4`) and reading it back
with `MATCH (n) RETURN labels(n)[0], count(n)`, then deleting the scratch graph —
the graph you get from **Load demo company** is the same seed, so if the numbers
on screen differ by a node or two, something was approved, screened or exported
first, which is the point.

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
cd server && npm run e2e:v3     # 42/42
npm run test:ci                 # 35 passed, 0 failed, 0 skipped
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

## Scene 7 — the graph answers questions a vector store cannot (75 s)

**Graph Insights** in the sidebar (five tabs), plus two panels on existing pages.

1. **Connection path** — ask *"how are Maya Rao and Operations connected?"* →
   `Person:Maya Rao → Team:Operations`, `hops=1`. Then ask for a pair that is not
   linked and read the honest answer: no path ≤ 5 hops in either direction, plus
   each endpoint's incident-edge count, and the statement that FalkorDB's
   `shortestPath` is **directed**, so this is the shape of the data rather than a
   symmetric lookup. (`GET /api/brain/path`)
2. **Rule versions** — after Scene 4's Apply, open *Automated Invoice Credit
   Approval*: three versions (`v1 SUPERSEDED`, `v1 SUPERSEDED`, `v2 ACTIVE`) and
   the parameter diff `maxCreditLimit 5000 → 10000`, each new version traced to
   the `Simulation` that produced it. History was never deleted.
3. **Handoff board** — `Freight Desk Agent → Email Triage Agent`, read from
   `HANDED_OFF_TO` edges with per-agent task/memory counts; the seeded edge is
   labelled as seeded. (`GET /api/brain/handoffs`)
4. **Explain this node** — Knowledge Graph → click the *Denied-Party Screening*
   policy: 14 neighbours by type, the owning SOP, the two source chunks it is
   `DERIVED_FROM` (quoted, not summarised), six decisions, and the 👍/👎 the
   answer built from it earned. (`GET /api/brain/explain/:id`)
5. **Feedback changes health, for real** — Ask Brain: 👎 the answer you got in
   Scene 2 → **Knowledge Health** refreshes and the score moves **67 → 63** with
   one new `SOURCE_THUMBS_DOWN` finding pointing at the exact chunk. 👍 the same
   answer and the finding disappears. Say out loud: the rating is a `Feedback`
   node `ABOUT` that `Chunk` in the graph — it is not a counter in Postgres.
6. **Your entry changes the next verdict** — Screening List: add
   "Globex Restricted Ltd" → preview says which stored bookings would match →
   **Add** → run the Freight Desk for that shipper → `FLAGGED` by the pure
   engine → **Remove** → the same booking `PASSED`. Try deleting a seeded demo
   entry and get the 409 refusal. Also show **Export** (JSON/GraphML/CSV) landing
   the same node/edge counts the Explorer shows.

Say plainly in this scene that the path, versions, timeline, handoffs, digest and
export are **graph facts read straight out of FalkorDB with no LLM in the loop**
— no key is set in this stack, and the answers are Cypher results.

**If the recording has to stay at 3–4 minutes**, show items 1, 5 and 6 (path +
feedback→health + watchlist flip) and put 2–4 in a still screenshot: they are
built, endpoint-tested and asserted in `server/tests/insights-v4.test.ts`, but
they are **not** in the video. Do not claim a track for what the video does not
show.

---

## Track mapping

| Graph Hacks track | What in this demo is evidence |
| :--- | :--- |
| Company Brain | Scenes 1–2, 5, 7: ingest → per-tenant graph → cited answers with traces → freshness queue; plus the connection path, rule-version diff, explain-node, freshness digest, and feedback that moves the Health score |
| Agents That Act on Connected Data | Scene 3–4, 7: policy lookup is Cypher, screening reads `WatchlistEntry` nodes, the ledger and Time Machine both write graph nodes, and a watchlist entry **you** add flips the next verdict through the same pure engine |
| Agent Memory & Coordination | Scene 6–7: `Episode`/`Fact`/`Procedure`/`Conversation`+`Turn` nodes scoped per agent, `HANDED_OFF_TO` between agents (the handoff board reads exactly those edges), `GET /api/memory/recall`, per-tenant isolation asserted in `e2e:v3` |

Graph export and pinned queries are **not** claimed as evidence for a track beyond
"the graph is the store": both are `MATCH` reads/writes over the same tenant graph,
with no algorithm behind them.

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
| **"How are X and Y connected?" is a real graph path** | `insights-v4.test.ts` — *returns a hop chain where node count = edge count + 1*, *reports an unconnected pair as an absence with both degrees, not an empty list*, *`shortest_path` tool answers instead of erroring*. **Directed edges only** — `shortestPath` here does not ignore direction, and the UI says so | `npx vitest run tests/insights-v4.test.ts` |
| **Rule versions diff in the right order** | `insights-v4.test.ts` — *diffs a rule against the version it superseded*: chronology is derived from `SUPERSEDES` edges, not the stored `version` string (the demo seed puts `1` on both nodes), and the test asserts every newest end sorts after its `to` | `npx vitest run tests/insights-v4.test.ts` |
| **Decision timeline replays one subject** | `insights-v4.test.ts` — *replays decisions for one subject, newest first* (sorted-descending assertion on `at`) and *empty timeline is an explicit absence, not a silent zero* ("Nothing in the graph…") | `npx vitest run tests/insights-v4.test.ts` |
| **Handoff board reads `HANDED_OFF_TO`, not a table** | `insights-v4.test.ts` — *handoff board reads HANDED_OFF_TO edges*; e2e check over HTTP returns 1 handoff across 4 agents | `npm run e2e:v3` |
| **Explain-node is citations, not generated prose** | `insights-v4.test.ts` — *explains a node with neighbours, provenance and feedback counters* (14 neighbours / 2 chunks / 6 decisions measured) and *explains an unknown id as null so the caller can 404* | `npx vitest run tests/insights-v4.test.ts` |
| **👎 actually moves Knowledge Health** | `insights-v4.test.ts` — *a thumbs-down on a cited chunk becomes a finding on that exact chunk*: **67 → 63**, new `SOURCE_THUMBS_DOWN` finding keyed to the cited `Chunk` id, and the same call path with 👍 removes it (upvote cancels). The rating is a `Feedback` node `ABOUT` the chunk, not a Postgres counter | `npx vitest run tests/insights-v4.test.ts` |
| **A watchlist entry you add flips the next verdict** | `insights-v4.test.ts` — *add → engine FLAGGED → remove → engine PASSED* (the pure engine reads `WatchlistEntry` nodes, so there is nothing to redeploy), plus *seeded demo entries are refused, never deleted* (409) and *rejects junk names instead of writing noise into the graph* | `npx vitest run tests/insights-v4.test.ts` |
| **Export formats agree** | `insights-v4.test.ts` — *JSON, GraphML and CSV all carry the same node/edge counts* (150 nodes / 183 edges measured on the demo tenant) and *escapes markup in node names instead of breaking the document*; the filename carries no internal graph name | `npx vitest run tests/insights-v4.test.ts` |
| **Pinned queries are tenant-scoped** | `insights-v4.test.ts` — *saves, isolates and deletes* (second tenant sees 0) and *refuses an empty question*. **Known gap, disclosed:** the saved-query writes and the two deletes are behind auth but carry no `apiRateLimiter`; only `POST /brain/feedback` and `POST /watchlist` do | `npx vitest run tests/insights-v4.test.ts` |
| "Graph algorithms" claims | **not claimed** — no `algo.pageRank`/`WCC`/`BFS` in the code; centrality is Cypher degree counting, path is `shortestPath()` | see `docs/cypher-queries.md` |
| SOC 2 / ISO / immutable / zero-hallucination | **not claimed anywhere** | `docs/features.md` §F |

## Recording note

The previous demo recording was removed with the branding it carried, so the
video has to be re-recorded before submission. Record the scenes above in order
(0–7, ≈7–8 min), keep the FalkorDB Browser UI visible in Scene 1 and 4, and show
`npm run e2e:v3` output (42/42) in the last 20 seconds. Captions: `ffmpeg` with
the SRT written from this script. The **spoken voiceover** for each scene — with
the honesty call-outs to say aloud and the overclaims to avoid — is in
[`demo-narration.md`](demo-narration.md).

If you cut the video to 3–4 minutes, the scenes you drop must also drop out of the
track list in the submission form: Scene 7 beats 2–4 (rule versions, timeline,
handoffs) and the export/pins are then **screenshot evidence, not video evidence**,
and `e2e:v3` 42/42 in the Close is what backs them.
