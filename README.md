# Taste Brain

**Agents that decide with taste and prove why.** Taste Brain joins an organization's own rules with Qloo's audience taste data, and attaches a checkable Decision Trace to every recommendation.

> Rules from the business, taste from Qloo, a trace for every decision.

Built for the **Qloo Agentic Hackathon** — theme *"Agents, but with taste."*

---

## Try it in 60 seconds

```bash
# 1. Backend (no credential needed — runs in Replay mode from committed fixtures)
cd server && npm install
cp .env.example .env          # defaults are fine for the demo
npm run dev                    # http://localhost:4000

# 2. Frontend (in a second terminal)
cd client && npm install
npm run dev                    # open http://localhost:3000
```

In the UI: pick **Retail and fashion → Store 3 - East Austin → "Add 4 brands for spring"** and hit **Run the agent**. You get a ranked proposal, a Decision Trace, Auditor rejections, and a Qloo call log — first full trace well under 60 seconds. Then open **Taste Lift** and run the fixed request set, and switch to **Venues** to see the same engine on new data.

> **Data mode honesty:** the demo ships in **Replay** mode using **synthetic sample fixtures** (clearly labelled `mode: "replay"` on every result). They are *not* live Qloo output. With a Qloo API key configured (`QLOO_API_KEY` in `server/.env`) and `QLOO_ENABLED=true` / `DEFAULT_MODE=live`, the engine makes direct real REST calls to the official Qloo API (`https://hackathon.api.qloo.com`) via `X-Api-Key`.

---

## What it is

Taste Brain is a platform where agents make offer / assortment / campaign decisions for organizations that serve many audiences (chains, venue operators, hotel groups, agencies, care providers). Each decision joins:

1. **The organization's own rules** (budgets, contracts, capacity, brand safety, dietary or care constraints), stored as Rule nodes linked to the SOP documents they came from.
2. **Qloo's taste data** about the audience at each location (aggregate affinities across brands, places, music and more, with explainability).

Every proposal carries a **Decision Trace**. A **Grounding Auditor** blocks anything that cannot be traced to a Qloo result or a passing Rule. A **Taste Lift** panel runs the same request through a plain LLM and through the grounded agent. A **Vertical Pack** (one config file) adapts the engine to retail, restaurants, venues, and more.

### Why this would not work without Qloo

- Location audience portraits come from Qloo entity/tag results, not guesses.
- Candidate ranking is by Qloo affinity score — the LLM never decides the ranking.
- The Auditor vetoes any item without a Qloo entity id in the run's stored results.
- Taste Lift measures the grounded agent against a plain LLM on the same request.

---

## Qloo workflows used, and where

| Need | Workflow (`QlooRequest.workflow`) | Endpoint & Method | Files |
|---|---|---|---|
| Describe a location's audience | `describe_audience` | `GET /v2/tags?filter.query=...` and `GET /v2/insights` | `server/src/qloo/rest-client.ts`, `server/src/agents/pipeline.ts` |
| Rank candidate offers for a location | `recommend` | `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=...&filter.location.query=...` | `server/src/qloo/rest-client.ts`, `server/src/agents/pipeline.ts` |
| Style/keyword → tag resolution | `find_tags` | `GET /v2/tags?filter.query=...` | `server/src/qloo/rest-client.ts` |
| Entity search & seed resolution | `resolve_entity` | `GET /search?query=...&type=urn:entity:...` | `server/src/qloo/rest-client.ts` |
| Rank a company-approved shortlist | `rank_shortlist` | `GET /v2/insights?filter.type=...&signal.interests.entities=...&take=...` | `server/src/qloo/rest-client.ts` |
| Live transport | Direct REST Client | HTTP GET with `X-Api-Key` header | `server/src/qloo/rest-client.ts` |

### Production REST Protection
- **Global Throttle Queue:** 250 ms delay between outbound calls (~4 calls/s max) ensuring strict adherence to the ~5 req/s Qloo rate limit.
- **Resilience:** Automatic retry with exponential backoff and jitter on HTTP 429 and 5xx errors (up to 3 retries).
- **In-flight Deduplication & Caching:** Concurrent identical requests share a single network call. Results are cached in a LRU memory cache and persistent gitignored private disk cache (`.private-cache/`).
- **Secret Isolation:** The `QLOO_API_KEY` is accessed only within `rest-client.ts`. It is never returned in HTTP responses, never logged, and never committed to version control.

**Live request→result walkthrough** (`POST /api/proposals` with `{pack:"retail", location:"store_1", goal:"Add 4 brands", mode:"live"}`):

```text
1. Seed Resolution   → "Patagonia" → 205AF33F-118E-..., "Filson" → DF938ECD-5CE5-...
2. Seed Ambiguity    → "Seattle Anchor Outfitters" matches 5 candidates (surfaced in UI)
3. Describe Audience → Qloo tags retrieved for Belltown, Seattle (Outdoors, Pacific Northwest)
4. Taste Explorer    → GET /v2/insights returns top local brands:
                       - Recreational Equipment Inc (fit 99)
                       - Huckberry (fit 95)
                       - Danner (fit 93)
                       - Pendleton Woolen Mills (fit 92)
                       - Smartwool (fit 90)
                       - Fjällräven (fit 88)
                       - Backcountry (fit 85)
                       - Arc'teryx (fit 82)
5. Rule Checker      → budget_cap (unit_cost <= $40), min_order (minimum_order <= 500)
                       - Arc'teryx: unit_cost $65 > $40 → FAIL budget_cap
                       - Backcountry: minimum_order 600 > 500 → FAIL min_order
6. Grounding Auditor → Arc'teryx & Backcountry vetoed by Auditor (Check 3).
                       Surviving items (REI, Huckberry, Danner, Pendleton, Smartwool, Fjällräven) pass 100%.
7. Unsupported       → Backpacker Magazine, L.L.Bean (strong Qloo affinity, but no buying contract on file).
```

---

## Architecture

```text
Browser UI -> Express API -> fixed pipeline (agent steps inside)
  Profiler -------> Qloo adapter (describe_audience; handle needs_input)
  Taste Explorer --> Qloo adapter (recommend; rank by Qloo score)
  Rule Checker ---> SQLite graph (Rules, Offers)
  Strategist -----> LLM (explanations only; never ranks)
  Auditor --------> graph + stored Qloo results (veto power)
  Approver -------> SQLite graph (Decision nodes)
Qloo adapter modes: live | cached | replay — labelled on every result
```

Graph store is **SQLite** (`node:sqlite`) — see `server/src/graph/store.ts`. A license-safe store for a public open-source release, with no external database to stand up.

Full model, contracts and the trace spec: [`docs/architecture.md`](docs/architecture.md).

---

## Vertical Packs

Adding a pack is config only — no change to the agents, graph or trace code.

| Pack | Depth | Files |
|---|---|---|
| Retail and fashion | Deep | `server/src/packs/data/retail.json` |
| Restaurants and hospitality | Thin | `server/src/packs/data/restaurants.json` |
| Venues, events and media | Thin | `server/src/packs/data/venues.json` |

Each pack defines entity types, goal templates, Rule templates (with their SOP source), fictional locations, and a candidate catalog. Rule kinds implemented: `numeric_max`, `numeric_min`, `exclude_tags`, `require_tags`, `allow_list`, `deny_list`, `capacity` (`server/src/agents/rule-checker.ts`).

---

## Evidence: tests, Taste Lift, and Cache Warming

```bash
cd server
npm test                 # Grounding Auditor checks (§11), REST client contracts, rule kinds, pipeline hard scenario
npm run eval             # Taste Lift fixed request set -> server/src/eval/results.json
npm run warm-cache       # Pre-fetches one-click scenarios on deployment host into gitignored .private-cache/
```

- The **Grounding Auditor** has automated unit tests verifying that unsupported items are vetoed, rule violations are caught, and decision traces produce reproducible `rerun_hash` values.
- **REST Client Tests** cover throttle contracts, exponential backoff on 429/5xx, timeouts, error shapes, and ensure credentials are never leaked.
- **Taste Lift** publishes whatever the numbers are. On a host with no LLM key it runs Arm B (grounded) and states plainly that Arm A (plain LLM) did not run — **no lift figure is fabricated.**
- **Cache Warmer (`npm run warm-cache`):** Run on the deployed host to populate `.private-cache/` for all one-click demo scenarios. The cache directory is gitignored and never committed.

---

## Data & provenance

- All sample data is fictional. No customer data, credentials or personal data are present.
- Every result is labelled with its mode (Live / Cached / Replay); nothing is presented as live that isn't.
- Live responses are kept strictly on the server in `.private-cache/` and never checked into source control.

---

## Known limitations

- Qloo returns **aggregate audience affinities**, not evidence about any individual. The UI says so and never claims to know a person's individual taste.
- This build ships with **Replay mode with synthetic sample fixtures** enabled by default so the demo is 100% runnable offline without any credentials.
- In **Live mode**, recommendations derive from real calls to `https://hackathon.api.qloo.com`. An API key must be supplied in `server/.env`.
- Outbound API calls are limited by a 250ms throttle queue and daily soft quota limits.
- Results provide **decision support and proof traces**, not guarantees of commercial sales or performance.
- Multi-tenancy, billing and production cloud isolation are out of scope for the hackathon.

---

## Repo layout

```text
taste-brain/
  README.md  LICENSE  server/.env.example
  server/  src/{config,types,graph,qloo,packs,agents,trace,eval,http,index}.ts  tests/  verification/
  client/  src/{App.tsx,lib/api.ts,components/ui/*}
  docs/    architecture.md  limits.md  demo-script.md  devpost-description.md  live-run-scorecard.md
  .github/workflows/ci.yml
```

License: **MIT** (see `LICENSE`).
