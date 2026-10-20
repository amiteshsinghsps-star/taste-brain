# Feature status

Legend: ✅ built and measured · 🟡 partial · ⬜ not built (never claimed)

Endpoint list lives in [README.md](../README.md); graph schema in
[graph-data-model.md](graph-data-model.md); every Cypher in use in
[cypher-queries.md](cypher-queries.md).

## A. Company brain — ingest, structure, ask, act

| Feature | Status | Where |
| :--- | :---: | :--- |
| Ingest SOPs / uploads into the tenant graph | ✅ | `POST /api/ingestion/upload`, `POST /api/brain/graph/extract` |
| Knowledge graph of people, teams, policies, rules, documents, decisions | ✅ | `server/src/graph/`, one FalkorDB graph per tenant |
| Hybrid retrieval (vector + full-text + multi-hop expansion, all in-graph) | ✅ | `services/brain/retrieval.service.ts` |
| Cited answers with a Decision Trace | ✅ | `POST /api/brain/query`, `GET /api/brain/trace/:traceId` |
| Executable skills extracted from the firm's own SOPs | ✅ | `services/brain/skills.service.ts`, `POST /api/skills/extract` |
| Editable, versioned skills | ✅ | `POST /api/skills/update`, `DELETE /api/skills/:id` |
| Closed loop: what happened vs what the rules say | ✅ | `POST /api/agents/:id/freight` → `Task`/`Decision`/ledger |
| Live Gmail / Drive / Slack / SQL connectors | 🟡 built, **off by default** | `FF_LIVE_CONNECTORS=1` to enable; otherwise HTTP 403 `LIVE_CONNECTORS_DISABLED` |

## B. Agents

| Workflow | Status | Notes |
| :--- | :---: | :--- |
| Freight / customs desk | ✅ | Deterministic screening: the LLM never decides pass/fail |
| Answer & draft reply, summarize thread, extract action items | ✅ | Three generic graph-driven workflows |
| Email desk triage → cited draft → approve → send | ✅ | `POST /api/email-desk/triage` |
| Finance (invoices, client credit) | 🟡 | Rule engine active; AR chasing and reconciliation not built |
| HR / IT / Legal / Sales desks | ⬜ | Not built, not claimed |

## C. Control plane — trust and steer

| Feature | Status | Notes |
| :--- | :---: | :--- |
| Team members, roles, agent lifecycle | ✅ | `POST /api/control/team`, `PATCH /api/agents/:id/status` |
| Per-person scoped access grants (6 scopes, instant revoke) | ✅ | `POST /api/control/access/grant` / `revoke` |
| Autopilot ↔ Copilot steering, default copilot | ✅ | `PATCH /api/agents/:id/mode` |
| Copilot staging invariant | ✅ | Every freight outcome is staged in COPILOT mode, including a blocked shipment |
| Approval card shows verdict, margins, citations, trace, precedents | ✅ | `client/src/pages/TaskApprovalsPage.tsx` |
| Audit trail | ✅ | Append-only `AgentAuditLog` rows + hash-chained ledger (`GET /api/ledger/verify`) |

## D. Graph Hacks v3 — evidence, control, time travel

| Feature | Status | Measurement |
| :--- | :--- | :--- |
| Policy Time Machine (counterfactual replay, Apply/Discard) | ✅ | 5 of 30 stored bookings change at 100% replay fidelity |
| Hash-chained decision ledger | ✅ | Tamper-**evident**; editing an entry reports the exact `brokenAt` seq. Not immutable, no compliance claim |
| Why-Not explanations with numeric margins + nearest miss | ✅ | `GET /api/brain/why-not?booking=BK-1043` |
| Graph vs plain-RAG eval on 20 golden questions | ✅ | entity recall 55% → 70%, source recall 65% → 90%, temporal source recall 20% → 100% |
| Knowledge Health report | ✅ | Demo company measures 67/100 with 6 planted findings |
| Needs Review queue (UI) | ✅ | `GET /api/brain/stale`, per-item impact + mark-reviewed |
| Freshness: versioning, `SUPERSEDES`, `STALE`, impact analysis | ✅ | `docs/cypher-queries.md` section on freshness |
| Typed agent memory (Episode / Fact / Procedure / Conversation) | ✅ | `services/memory/memory.service.ts`, UI page `client/src/pages/MemoryPage.tsx`; write + recall round-trip and per-tenant isolation asserted in `e2e:v3` |
| Graph tool registry over REST and MCP | ✅ | 9 tools, read-only over MCP |
| Precedent recall inside the approval card | ✅ | `services/brain/precedent.service.ts`, T22 |
| Absence proofs ("0 `OWNS` edges") instead of empty lists | ✅ | T23 |
| `/api/status` graph proof + removal test | ✅ | `CALL db.meta.stats()`, `npm run test:removal` |

## E. Graph Hacks v4 — insights, curation, export

Ten features, each with a real endpoint and a UI panel. "Measured" values are
from the committed end-to-end run (`server/src/eval/e2e-v3.ts`, freshly seeded
demo tenant), so they are reproducible rather than quoted from a screenshot;
`server/tests/insights-v4.test.ts` is the unit-level proof (18 tests).

| Feature | Status | Measured |
| :--- | :---: | :--- |
| "How are X and Y connected?" path finder | ✅ | `GET /api/brain/path` — e2e resolves Maya Rao → Operations, `hops=1`, chain `Person:Maya Rao → Team:Operations`. Directed-only in FalkorDB, so the answer states which orientation worked |
| Absence is an answer, not an empty list | ✅ | same endpoint, unknown endpoint: `"No node in this tenant graph matches …"` + both endpoint degrees (`ConnectionPathResult.degrees`) |
| Rule version diff | ✅ | `GET /api/brain/rules/:id/versions` — after a Time Machine apply: `3 version(s): v1(SUPERSEDED), v1(SUPERSEDED), v2(ACTIVE); maxCreditLimit 5000 → 10000` |
| Decision timeline for one subject | ✅ | `GET /api/brain/timeline?subject=BK-1042` — `3 event(s) … 3 decision(s), 0 rule version change(s)`; empty result is reported as "Nothing in the graph for …" |
| Cross-agent handoff board | ✅ | `GET /api/brain/handoffs` — `1 handoff(s) over 4 agent(s): Freight Desk Agent → Email Triage Agent`, read from `HANDED_OFF_TO` edges |
| "Explain this node" drill-down | ✅ | `GET /api/brain/explain/:id` — Policy "Denied-Party Screening": `14 neighbour(s), 2 source chunk(s), 6 decision(s)`; unknown id → 404 |
| Freshness digest | ✅ | `GET /api/brain/freshness-digest` — `supersededDocs=1 supersededRules=3 stale=1 pending=0`; a `v1 → v1` seed artefact is labelled as one instead of being presented as a version bump |
| Graph export (JSON / GraphML / CSV edges / CSV nodes) | ✅ | `GET /api/brain/graph/export?format=…` — `json nodes=150 edges=183; graphml 70,410 chars with 183 <edge>; csv 183 rows`; filename `neutronz-brain-<date>.json` (no internal graph name) |
| Answer feedback 👍/👎 wired into Knowledge Health | ✅ | `POST /api/brain/feedback` — a 👎 on the cited chunk moved the health score 67 → 63 and added exactly one `SOURCE_THUMBS_DOWN` finding whose `subjectId` is that chunk; an upvote on the same chunk cancels it. A chunk id that does not exist in the tenant graph is not linked (`linked=0`) |
| Add / remove your own screening entry | ✅ | `POST`/`DELETE /api/watchlist` (+ `GET /watchlist/preview`) — new `WatchlistEntry` node flipped the pure engine `PASSED → FLAGGED`, deleting it flipped back to `PASSED`; deleting a seeded demo entry is refused with 409 |
| Pinned brain queries | ✅ | `POST`/`GET`/`DELETE /api/brain/saved-queries` — saved as `SavedQuery` nodes in the tenant graph; a second tenant sees none |
| Ledger still honest after the new write paths | ✅ | Two new append-only kinds — `WATCHLIST_ENTRY_ADDED`, `WATCHLIST_ENTRY_REMOVED` (`controllers/curation.controller.ts:77-98`). Answer feedback and pinned queries deliberately write no ledger entry: they are opinions and bookmarks, not decisions. `GET /api/ledger/verify` still returns `ok=true` on a graph that has both |
| UI for all of the above | ✅ | `client/src/pages/InsightsPage.tsx` (5 tabs), `WatchlistPage.tsx`, Explain + export + entity chips in `KnowledgeGraphPage.tsx`, feedback/pin controls in `AskBrainPage.tsx` |
| Browser click-through of the new panels | ⬜ | **Not verified by a human yet.** TypeScript build (`npm run build`) and the API are green; no browser run, so layout and interaction are unproven. `docs/qa-log.md` stays honest about this |

## F. Not claimed

No SOC 2 / ISO certification, no encryption-at-rest marketing, no "zero
hallucinations", no real sanctions feed (the demo watchlist is seeded synthetic
data and labelled), no immutability guarantee for the ledger, and no edge-level
access control. Scale is a single FalkorDB instance with graphs of demo size.
