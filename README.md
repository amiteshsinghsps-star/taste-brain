# Neutronz Company Brain

*A company brain where every agent action traces through a graph path back to the SOP, the decision, and the person behind it — and every claim in this file is a number you can re-run.*

Neutronz ingests scattered company knowledge (SOPs, email, Slack, Drive, uploads), turns it into a **per-tenant FalkorDB knowledge graph** of people, teams, projects, documents, policies, systems, rules, decisions and bookings, and lets AI agents **answer questions and do real work** — freight screening, invoice approvals, email triage — by walking that graph. Every answer and every action ships with a **Decision Trace** (the exact graph path plus the source snippets), a **tamper-evident ledger**, **precedents and absence proofs pulled from the graph itself**, and a **before/after simulation** of any rule change before a human applies it.

Built for **Graph Hacks: Context for AI Agents** (FalkorDB × WeMakeDevs).

**Tracks this demo shows end-to-end** (only these — nothing is claimed for tracks it cannot demonstrate):

| Track | Evidence in this repo |
| :--- | :--- |
| **Company Brain** | ingest → per-tenant graph → cited answers with graph paths → freshness / Needs Review → Knowledge Health |
| **Agents That Act on Connected Data** | policy lookup, watchlist screening, simulation replay sets and memory recall are all Cypher; the ledger and Time Machine write graph nodes |
| **Agent Memory & Coordination** | `Episode` / `Fact` / `Procedure` / `Conversation`+`Turn` nodes scoped per agent, `HANDED_OFF_TO` between agents, `GET /api/memory/recall` |

## Run it (one command)

```bash
docker compose up -d --build        # FalkorDB + Postgres + migrations + API + built UI
open http://localhost:5000          # the product, single origin
open http://localhost:3001          # FalkorDB Browser UI — look at the graph while you use it
curl -s http://localhost:5000/api/status
```

`/api/status` is the "the graph is really the backend" proof: it runs
`CALL db.meta.stats()` against the live FalkorDB instance(s) and returns
`backend: "falkordb"`, reachability, graph count and summed node/edge totals
(measured here: `graphs=35 nodes=3213 edges=3757` — the count climbs with every
demo tenant you load, because each signup gets its own graph), plus whether an
LLM key is present and which feature flags are on. Nothing is cached, so the
numbers cannot be a stale counter. Assert it with `node scripts/check-status.mjs --expect-graph`
(also a CI step). Then: sign up → **Load demo company** → ask the brain.

No `OPENAI_API_KEY` is needed: extraction falls back to the heuristic extractor
and answers fall back to cited graph facts. Add a key for LLM-synthesised prose.

**Development mode** (hot reload, UI on :3000):

```bash
docker compose up -d falkordb postgres
cd server && cp .env.example .env && npm ci && npx prisma migrate dev && npm run dev
cd ../client && npm ci && npm run dev
```

**Demo path:** sign up → *Load demo company* → Ask Brain: *"Which systems and agents does the credit approval policy govern?"* → open **Why?** to watch the hops (`Rule → IMPLEMENTS → Policy`, `Person → OWNS → Policy`, `Policy → GOVERNS → System`) → ask about a policy that does not exist and get an **absence proof** instead of an empty list → Freight Desk with shipper **Denied Trading LLC** → *Task Approvals*: verdict + per-rule margins + **precedents from the graph** + trace → approve (Person→DECIDED→Decision written, ledger entry appended) → **Policy Time Machine** → simulate `10000 → 5000`, read the diff and impact, Apply or Discard → **Needs Review** → Impact / Mark reviewed → **Knowledge Health** → `GET /api/ledger/verify`.

Full walkthrough with expected output per scene: [`docs/demo-script.md`](docs/demo-script.md).

## Measured: graph-first vs plain RAG

Same chunks, same model, temperature 0; baseline = top-5 similar chunks only. 20 golden questions × 3 runs, median. Reproduce with `npm run eval` (methodology in [`server/docs/EVAL.md`](server/docs/EVAL.md), raw numbers in [`server/src/eval/results.json`](server/src/eval/results.json)).

| Metric | Plain RAG | Graph-first (Neutronz) |
| :--- | :--- | :--- |
| Entity recall | 55% | **70%** |
| Source recall | 65% | **90%** |
| Citation validity | 100% | 100% |
| Currency (no superseded sources cited) | 95% | **100%** |

The graph is worth most exactly where a vector store is weakest — **temporal** questions: source recall 20% → 100%, currency 80% → 100% (ownership 80% → 100%, impact 60% → 80%, provenance flat at 40%: those need an LLM to synthesise and this run had no API key, so the fallback quotes graph hops verbatim).

**Policy Time Machine**, measured on the seeded demo company: lowering the credit auto-approval threshold 10,000 → 5,000 USD replays **31 stored booking verdicts**, **5 change**, with **100% replay fidelity** — the current rule reproduces every recorded verdict, which is what makes the counterfactual trustworthy. Below 100% the result is marked `unreliable` instead of being shown as fact. (The replay set grows by one each time you run the Freight Desk; that is why you may see 31 where this says 30+1.)

## What's actually in the box

| Area | Status |
| :--- | :--- |
| Per-tenant FalkorDB graphs (`tenant_<id>`) with an allow-listed node/relationship schema — schema is enforced at write time | ✅ working |
| One-click demo company (Northwind Logistics: **135 nodes / 156 edges** — 13 people, 4 teams, 9 documents, 10 chunks, 7 policies, 5 rules, 30 bookings, 22 decisions, 4 systems, 3 agents, 3 watchlist entries, planted staleness) | ✅ working |
| Ask-the-brain: entity linking → in-graph vector seeds → multi-hop expansion → currency filter, with citations + Decision Trace | ✅ working |
| Graph-driven freight agent: deterministic screening (**the LLM never decides pass/fail**), Copilot stages **every** outcome for a human, including a blocked shipment | ✅ working |
| **Precedents** — "what was decided last time this came up, and who decided it", scored from `Decision`/`ABOUT`/`DECIDED` edges and shown in the approval card | ✅ working |
| **Absence proofs** — "N nodes matched, 0 OWNS edges exist. The graph does not record this relationship" instead of an empty list that looks like a bug | ✅ working |
| Freshness: `SUPERSEDES` versioning, dependent rules flagged `STALE`, impact analysis by Policy **or** Rule id, **Needs Review** queue in the UI | ✅ working |
| **Policy Time Machine** — simulate a rule change over stored bookings, see the diff + graph impact, then Apply (versions the rule) or Discard (mutates nothing) | ✅ working |
| **Hash-chained ledger** — every decision/approval appends a chained entry; `/api/ledger/verify` reports the exact `seq` where a tamper broke the chain | ✅ working (tamper-*evident*, not immutable) |
| **Why-Not** — "why wasn't BK-1043 flagged?" with each rule's numeric margin and the nearest miss | ✅ working |
| **Knowledge Health** — orphan policies, provenance-less rules, stale rules, bus-factor-1 systems, un-refreshed docs, scored (demo company measures **67/100 with 6 findings**) | ✅ working |
| **Graph-vs-RAG eval** — 20 golden questions, deterministic scoring, median of 3 runs, side-by-side in the UI (`POST /api/brain/compare`) | ✅ working |
| Typed agent memory (Episode / Fact / Procedure / Conversation+Turn) + handoffs | ✅ working |
| **`/api/status`** — live graph counts from `CALL db.meta.stats()`, store reachability, LLM presence, feature flags | ✅ working |
| Read-only MCP tool server (9 tools) + the same tools over `POST /api/brain/tools` | ✅ working |
| Tenant isolation: one graph per tenant, graph names derived from the JWT, never from client input | ✅ working, tested (T1) |
| **Live Gmail/Drive/Slack/SQL connectors are OFF by default** behind `FF_LIVE_CONNECTORS`; with the flag unset they return `403 LIVE_CONNECTORS_DISABLED` and the UI says so — the demo graph contains only synthetic data plus your uploads | ✅ working |
| Honest failure modes: **no LLM key** → retrieval still answers with cited graph facts; **FalkorDB down** → `/api/brain/query` fails loudly with HTTP 503 `GRAPH_UNAVAILABLE`, never silently degrades to keyword search | ✅ working, tested (T3 + removal test) |

Not shipped / roadmap: a real sanctions feed (the watchlist is labelled demo data), edge-level access control inside the graph, embedding-based semantic re-ranking, multi-tenant graph clustering, HR/IT/Legal/Sales verticals, compliance certifications (none claimed), cloud/IaC deployment (this is a single-host Docker stack), production hardening of the demo's in-process trace cache and ledger append mutex.

## Architecture

```
Client (Vite + React, served from the API origin in Docker)
        │  REST + JWT (access token + rotating httpOnly refresh cookie)
        ▼
Neutronz Server (Express + TypeScript)
  brain · retrieval · rules engine · simulation · ledger · memory · MCP
        │
   ┌────┴─────────────────────┬──────────────────────────┐
   ▼                          ▼                          ▼
FalkorDB                 PostgreSQL (Prisma)      OpenAI-compatible LLM
one graph per tenant     users · refresh tokens    extraction · synthesis
(`tenant_<id>`):         sync/source metadata      (OPTIONAL — every path
people, teams, docs,     raw ingested payload      above has an honest,
chunks (+embeddings),    skill-rule rows           labelled fallback without
policies, rules,         agent instances/tasks    it: heuristic extractor,
systems, projects,       audit rows · query logs  cited graph-fact answer)
bookings, customers,
watchlist, invoices,
shipments, decisions,
tasks, simulations,
ledger chain, memory
vector index lives IN the graph
```

**Why the graph is not decoration:** retrieval seeds are vector lookups *inside* FalkorDB and expansion is Cypher; policy lookup, watchlist screening, precedent ranking, absence counting, simulation replay sets, impact analysis, memory recall and the ledger chain are all Cypher. There are **100 numbered Cypher statements across 21 groups** in the codebase, each catalogued with its file:line and its parameters in [`docs/cypher-queries.md`](docs/cypher-queries.md), and the schema (labels, properties, relationship types, indexes, constraints) in [`docs/graph-data-model.md`](docs/graph-data-model.md). Stopping FalkorDB makes ask-the-brain fail by design — there is no keyword-search fallback pretending to be a brain, and the removal test proves the same binary works the moment the graph returns.

Postgres is deliberately narrow: identity, sync metadata, the raw ingested text, and audit rows. It holds no company-knowledge graph — the pre-graph `Entity`/`EntityRelation` tables are still in the Prisma schema but no service reads or writes them.

## Tests & verification

Requires `docker compose up -d` (graph tests do not silently pass: `FALKORDB_REQUIRED=1` makes the suite fail instead of skipping when FalkorDB is unreachable, and `check-no-skips.mjs` fails CI on any skipped test):

```bash
cd server
npm run test:ci        # 17 tests: T1–T5, T7, extraction gate, T16–T23 → then
node ../scripts/check-no-skips.mjs tests/vitest.json   # 17 passed, 0 failed, 0 skipped
npm run test:removal   # 9 checks: graph down → 503 GRAPH_UNAVAILABLE, no fallback answer
npm run e2e:v3         # 26 black-box HTTP checks over the whole demo path
npm run eval           # graph-vs-RAG numbers → server/docs/EVAL.md + src/eval/results.json
node ../scripts/check-lockfile.mjs                      # lockfiles untampered, installable
```

CI (`.github/workflows/ci.yml`) runs the same set against FalkorDB + Postgres service containers: lockfile guard → `npm ci` → `prisma generate`/`db push` → both builds → tests with the no-skip assertion → removal test → boot the built server → `/api/status` assertion → e2e.

Current measured state on this machine: **17 passed / 0 failed / 0 skipped**, **`e2e:v3` 26/26 against the Docker stack**, **`test:removal` 9/9**, both builds clean, `tsc --noEmit` clean. Verification method and its limits (what was exercised over HTTP vs what nobody clicked in a browser) are written up honestly in [`docs/qa-log.md`](docs/qa-log.md).

## API surface

Status: `GET /api/status` (public) · `GET /api/status/connectors` (public) · `GET /api/status/graph` (tenant-scoped)

Brain: `POST /api/brain/query` · `GET /api/brain/graph` · `GET /api/brain/graph/node/:id` · `GET /api/brain/trace/:traceId` · `GET /api/brain/stale` · `POST /api/brain/stale/:id/revalidate` · `POST /api/brain/impact` (Policy **or** Rule id) · `GET /api/brain/who-knows?topic=` · `POST /api/brain/seed-demo` · `POST /api/brain/tools`

Rules / simulation / evidence: `GET /api/brain/rules` · `POST /api/brain/simulate` · `POST /api/brain/simulate/:id/apply` · `POST /api/brain/simulate/:id/discard` · `GET|POST /api/brain/why-not?booking=BK-1043` · `GET /api/ledger/verify` · `GET /api/ledger` · `GET /api/brain/health` · `POST /api/brain/compare`

Agents / desk / control: `POST /api/agents` · `PATCH /api/agents/:id/mode|status` · `POST /api/agents/:id/freight` · `POST /api/agents/:id/workflow` · `POST /api/agents/tasks/:taskId/approve` · `GET /api/agents/audit` · `POST /api/email-desk/triage` · `POST /api/control/team` · `POST /api/control/access/grant|revoke` · `POST|GET /api/skills*`

Memory: `POST /api/memory/episodes` · `GET /api/memory/recall?q=` · `GET /api/memory/conversations/:id` · `GET /api/memory/stats`

## MCP (read-only tools over the tenant graph)

```bash
cd server && npm run mcp -- --tenant <userId>     # same nine tools as POST /api/brain/tools
```

Claude Desktop config:

```json
{
  "mcpServers": {
    "neutronz-brain": {
      "command": "npx",
      "args": ["ts-node", "src/mcp/server.ts", "--tenant", "<userId>"],
      "cwd": "/path/to/Neutronz-brain-main/server"
    }
  }
}
```

The server exposes **read-only** tools only — `find_owner`, `get_policy_for`, `impact_of_change`, `who_knows_most`, `shortest_path`, `central_entities`, `recent_decisions`, `similar_decisions`, `absence_check`. No write path, no raw-Cypher escape hatch, and the tenant comes from the start-up flag, never from a model-supplied argument.

## Provenance: what pre-existed, what this build added

This repo did not start from an empty directory, and pretending otherwise would be the least interesting kind of dishonest.

| Layer | Origin |
| :--- | :--- |
| Express + TypeScript skeleton, Argon2/JWT auth with rotating refresh cookies, Prisma schema for users/tokens/sources/documents/agents/audit, connector (Composio) scaffolding, agent CRUD + approval flow, the Vite/React shell and its pages | **pre-existing baseline** in this repo |
| FalkorDB graph client, per-tenant graphs, allow-listed schema + extraction validation gate, graph-first retrieval with Decision Traces, heuristic + LLM extraction, `SUPERSEDES` freshness, impact analysis, Needs Review, Policy Time Machine + replay-fidelity gate, hash-chained ledger, Why-Not margins, Knowledge Health, graph-vs-RAG eval harness, typed agent memory, tool registry + MCP server, `central_entities`/precedent/absence hardening, `/api/status`, `FF_LIVE_CONNECTORS` gating, Docker multi-stage image + compose stack, CI workflow, removal test, no-skip enforcement, the synthetic Northwind demo company, and the evidence block in the approval card | **built for Graph Hacks** |

AI-assisted development was used heavily here; the tools, what they got wrong, and what was verified by hand are disclosed in [`docs/ai-use.md`](docs/ai-use.md).

**About the git history — please read before judging the timeline.** This repository's commit history was created on **2026-10-18 by consolidating a single working copy** into logical commits (containerize → auth baseline → graph layer → retrieval → agents/ledger/memory → tests → UI/docs). The commit timestamps are that consolidation, **not a development timeline** — several commits landed within minutes of each other, and that reflects reorganising files, not the order or dates the code was actually written. The "auth + ingestion baseline" layer is **pre-existing code** (the table above), and the event work was built on top of it between roughly Oct 15–18. Nothing is backdated. Every line is explained in the docs and disclosure above; the author can walk through any file on request.

## Repository layout

```
├── client/            Vite + React SPA (pages, components, lib/api.ts)
├── server/
│   ├── src/
│   │   ├── graph/     FalkorDB client, schema allow-list, parameterised helpers
│   │   ├── services/
│   │   │   ├── brain/ retrieval · graph · tools · rule-engine · simulation ·
│   │   │   │          ledger · freshness · precedent · health · status · eval
│   │   │   ├── agent/ · memory/ · control/ · email-desk/ · ingestion/ · rules/
│   │   ├── routes/ controllers/ middlewares/
│   │   ├── seed/      synthetic Northwind Logistics demo company
│   │   ├── eval/      e2e-v3, removal-test, eval runner
│   │   └── mcp/       read-only MCP tool server
│   ├── prisma/        schema + migrations (Postgres)
│   ├── tests/         vitest suites + global-setup (no silent skips)
│   └── docs/EVAL.md   eval methodology and results
├── docs/              graph-data-model · cypher-queries · features · demo-script ·
│                      deployment · ai-use · qa-log
├── scripts/           check-lockfile · check-no-skips · check-status
├── .github/workflows/ CI: build + tests + removal + status + e2e
├── Dockerfile         4 stages: client bundle → server build → migrator → runner
└── docker-compose.yml FalkorDB + Postgres + migrate + app
```

## Documentation

| Document | What it answers |
| :--- | :--- |
| [`docs/graph-data-model.md`](docs/graph-data-model.md) | every label, property, relationship type, index, naming rule and known schema limitation, with file:line |
| [`docs/cypher-queries.md`](docs/cypher-queries.md) | all 100 Cypher statements grouped by subsystem, why each is Cypher rather than SQL, and the injection-safety analysis |
| [`docs/features.md`](docs/features.md) | full feature set, what is built vs partial vs not claimed |
| [`docs/demo-script.md`](docs/demo-script.md) | 6-minute walkthrough with the expected measured output per scene, plus the claims audit |
| [`docs/deployment.md`](docs/deployment.md) | the Docker stack, configuration, and what is *not* provided (no cloud, no IaC) |
| [`docs/ai-use.md`](docs/ai-use.md) | AI-use disclosure, including the failure modes AI produced here |
| [`docs/qa-log.md`](docs/qa-log.md) | how each screen was verified, and how it wasn't |
| [`server/docs/EVAL.md`](server/docs/EVAL.md) | eval methodology and numbers |

## Honest limitations

- **Ledger is tamper-evident, not immutable.** A sha256 hash chain in FalkorDB: rewriting an entry is detected at that exact `seq` (`brokenAt`), but anyone with DB access can delete the whole chain. No blockchain, no SOC 2, no encryption-marketing claims.
- **Hallucinations are reduced, not zero.** Answers are grounded in retrieved graph context and carry citations, and the LLM never decides pass/fail (a pure rule engine does), but the synthesis step is an LLM and can misphrase what it was given.
- **All company data is synthetic.** The watchlist, bookings, people, documents and invoices are seeded demo data, labelled with `demoSeed` and a "Demo data" badge. It is not a sanctions feed; no real customer or personal data is in this repo, and live connectors stay off by default for exactly that reason.
- **Eval is 20 hand-written golden questions scored deterministically** (string/chunk-id matching, median of 3 runs, no LLM judge) on one tenant. Entity-recall gains partly come from the no-LLM fallback printing graph facts; with an LLM key the numbers move.
- **The UI was not click-tested in a browser by a human.** Production build is clean and every endpoint each page calls is exercised over HTTP; rendering and layout are unverified. See [`docs/qa-log.md`](docs/qa-log.md).
- **Scale:** per-tenant graphs on a single FalkorDB instance, an in-process trace cache (500 entries) and a per-tenant in-process append mutex for the ledger — fine for a demo, not a horizontal sharding story.
- **Absence and precedent queries scan by `CONTAINS`**, not by an index, so they are O(nodes) per call; correct at demo scale, not at corpus scale.
