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

## E. Not claimed

No SOC 2 / ISO certification, no encryption-at-rest marketing, no "zero
hallucinations", no real sanctions feed (the demo watchlist is seeded synthetic
data and labelled), no immutability guarantee for the ledger, and no edge-level
access control. Scale is a single FalkorDB instance with graphs of demo size.
