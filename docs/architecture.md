# Architecture, agents, data model, trace, auditor, evaluation

## Pipeline (fixed flow, agent steps inside — PRD principle #6)

`server/src/agents/pipeline.ts` → `runPipeline({pack, location, goal, mode})`:

1. **Profiler** — calls `describe_audience` for the location's seeds, stores an `Audience` node, records the taste portrait as a trace step.
2. **Taste Explorer** — calls `recommend`, collects `QlooEntityResult[]` (entity id, type, Qloo affinity score, tags, explainability, mode). Adds `AFFINITY` edges.
3. **Rule Checker** (`rule-checker.ts`) — maps each Qloo result to a company-approved `Offer` in the pack catalog and evaluates every applicable `Rule` deterministically.
4. **Strategist** — ranks surviving items **by the Qloo score** (the LLM never ranks), then optionally writes a narrative via `llm.ts`.
5. **Grounding Auditor** (`auditItem`) — vetoes any item lacking a Qloo id in the run's stored results (check 1) or failing a rule (check 3). Rejections are logged and shown.
6. **Approver** (`decide`) — records a human `Decision` node linked to the proposal and approver.

## Data model (SQLite graph — `server/src/graph/store.ts`)

Generic `nodes(kind,id,data)` + `edges(src,rel,dst,data)` tables. Node kinds: `Tenant, Pack, Location, Audience, QlooEntity, QlooTag, Offer, Rule, SOPDocument, Proposal, Decision, Person`. Relations: `HAS_AUDIENCE, AFFINITY{score}, DESCRIBED_BY, MATCHES, DEFINED_IN, CONSTRAINS, SUPPORTED_BY, CHECKED_AGAINST, RESULTS_FROM, APPROVED_BY`. A `proposals` table stores the full serialized proposal for retrieval and re-run.

The store is SQLite (`node:sqlite`): license-safe for a public open-source release, no external service to stand up, and it keeps the whole demo runnable offline.

## Qloo adapter modes (`server/src/qloo/adapter.ts`)

- `replay` — reads `fixtures/{pack}.{location}.{workflow}.json` (synthetic samples).
- `cached` — reads a prior result from the SQLite `QlooEntity` cache, else falls back to replay and stores it.
- `live` — spawns one long-running `qloo mcp` child and calls `qloo_<workflow>`; degrades to cached → replay on timeout/error, always labelled.

Throttle (250 ms), per-request memory cache, and a redacted call log (`/api/qloo/log`). Credential is server-side only.

## Decision Trace (`server/src/trace/builder.ts`)

Ordered `steps[]`, each with `type, label, source, mode, result, at`. `rerun_hash` is a sha256 over the decision-relevant steps (Rule / QlooEntity / Offer / Filter with id, result, score) so re-running the export reproduces the ranking — verified by a test.

## Grounding Auditor (PRD §11)

Check 1: recommended item must have a Qloo entity id present in the run's stored results. Check 3: item must pass every applicable rule. Mode recorded on every evidence step. Rejections returned on the proposal and visible in the UI.

## Taste Lift (`server/src/eval/taste-lift.ts`)

Fixed request set (10–15 items, written before testing). Arm B grounded metrics are computed from real proposal runs (grounding rate, rule compliance, specificity). Arm A runs a plain LLM from a rules-only prompt **only when `LLM_API_KEY` is set**; otherwise the harness records that Arm A did not run and publishes no fabricated lift. Deterministic checks are published alongside any pairwise judging.

## Application API (`server/src/http.ts`)

`GET /healthz`, `GET /api/mode`, `GET /api/packs`, `GET /api/packs/:id/locations`, `GET /api/packs/:id/locations/:loc`, `POST /api/proposals`, `GET /api/proposals/:id`, `GET /api/proposals/:id/trace`, `POST /api/proposals/:id/decision`, `POST /api/eval/run`, `GET /api/eval/results`, `GET /api/qloo/log`. Per-IP token-bucket rate limiting; 1 MB payload limit; no credential in any response.
