# Architecture, agents, data model, trace, auditor, evaluation

## Pipeline (fixed flow, agent steps inside — PRD principle #6)

`server/src/agents/pipeline.ts` → `runPipeline({pack, location, goal, mode})`:

1. **Profiler** — calls `describe_audience` for the location's seeds, stores an `Audience` node, records the taste portrait as a trace step.
2. **Taste Explorer** — calls `recommend`, collects `QlooEntityResult[]` (entity id, type, the position Qloo returned it at, tags, explainability, mode). `/v2/insights` carries no score field, so `qloo_rank` is the signal and the app derives `fit` from it. Adds `AFFINITY` edges.
3. **Rule Checker** (`rule-checker.ts`) — maps each Qloo result to a company-approved `Offer` in the pack catalog and evaluates every applicable `Rule` deterministically.
4. **Strategist** — keeps surviving items **in Qloo's own returned order** (the LLM never ranks, and nothing re-sorts), then optionally writes a narrative via `llm.ts`.
5. **Grounding Auditor** (`auditItem`) — vetoes any item lacking a Qloo id in the run's stored results (check 1) or failing a rule (check 3). Rejections are logged and shown.
6. **Approver** (`decide`) — records a human `Decision` node linked to the proposal and approver.

## Data model (SQLite graph — `server/src/graph/store.ts`)

Generic `nodes(kind,id,data)` + `edges(src,rel,dst,data)` tables. Node kinds: `Tenant, Pack, Location, Audience, QlooEntity, QlooTag, Offer, Rule, SOPDocument, Proposal, Decision, Person`. Relations: `HAS_AUDIENCE, AFFINITY{score}, DESCRIBED_BY, MATCHES, DEFINED_IN, CONSTRAINS, SUPPORTED_BY, CHECKED_AGAINST, RESULTS_FROM, APPROVED_BY`. A `proposals` table stores the full serialized proposal for retrieval and re-run.

The store is SQLite (`node:sqlite`): license-safe for a public open-source release, no external service to stand up, and it keeps the whole demo runnable offline.

## Qloo adapter modes (`server/src/qloo/adapter.ts`)

- `replay` — reads `fixtures/{pack}.{location}.{workflow}.json` (synthetic samples).
- `cached` — serves the stored private-cache answer for the same request instead of repeating the live call (in-flight dedup, LRU memory cache and gitignored disk cache, `server/src/qloo/rest-client.ts`).
- `live` — direct `GET` calls to the Qloo REST API with `X-Api-Key`, throttled to ~4 calls/s; degrades to cached, then replay, on error, and every step says which mode served it.

Throttle (250 ms), per-request memory cache, and a redacted call log (`/api/qloo/log`). Credential is server-side only.

## Decision Trace (`server/src/trace/builder.ts`)

Ordered `steps[]`, each with `type, label, source, mode, result, at`. `rerun_hash` is a sha256 over the decision-relevant steps (Rule / QlooEntity / Offer / Filter with id, result, score) so re-running the export reproduces the ranking — verified by a test.

## Grounding Auditor (PRD §11)

Check 1: recommended item must have a Qloo entity id present in the run's stored results. Check 3: item must pass every applicable rule. Mode recorded on every evidence step. Rejections returned on the proposal and visible in the UI.

## Taste Lift (`server/src/eval/taste-lift.ts`)

Fixed request set (10–15 items, written before testing). Arm B grounded metrics are computed from real proposal runs (grounding rate, rule compliance, specificity). Arm A runs a plain LLM from a rules-only prompt **only when `LLM_API_KEY` is set**; otherwise the harness records that Arm A did not run and publishes no fabricated lift. Deterministic checks are published alongside any pairwise judging.

## Application API (`server/src/http.ts`)

`GET /healthz`, `GET /api/health`, `GET /api/mode`, `GET /api/packs`, `GET /api/packs/:id/locations`, `GET /api/packs/:id/locations/:loc`, `POST /api/proposals`, `GET /api/proposals`, `GET /api/proposals/latest`, `GET /api/proposals/:id`, `GET /api/proposals/:id/trace`, `GET /api/proposals/:id/export`, `GET /api/proposals/:id/ablation`, `GET /api/proposals/:id/brief`, `POST /api/proposals/:id/decision`, `POST /api/verify`, `GET /api/breakit`, `POST /api/breakit`, `POST /api/whynot`, `POST /api/whatif`, `POST /api/partners`, `GET /api/coverage`, `GET /api/trust`, `GET /api/ledger`, `GET /api/ledger/verify`, `GET /api/snapshots`, `POST /api/eval/run`, `GET /api/eval/results`, `GET /api/qloo/log`, `GET /api/qloo/rest-log`. Per-IP token-bucket rate limiting; 64 kb request-body limit (`http.ts:93`); no credential in any response.
