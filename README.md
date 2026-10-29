# Taste Brain

**Agents that decide with taste and prove why.** Taste Brain joins an organization's own rules with Qloo's audience taste data, and attaches a checkable Decision Trace to every recommendation.

> Rules from the business, taste from Qloo, a trace for every decision.

Built for the **Qloo Agentic Hackathon** — theme *"Agents, but with taste."*

> Read [`FINAL.md`](FINAL.md) for the single-document submission: the multi-agent roster, all 24
> shipped capabilities with the endpoint and screen each one lives on, the measured live figures, and
> where the engine can be used.

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

> **Data mode honesty.** Every result says where its data came from: **Live** (a Qloo answer read on
> that request), **Cached** (a stored Qloo answer, no new call), or **Sample** (rows committed to this
> repository so the app runs with no key and no network — those names are invented and are never
> presented as a Qloo answer). A fresh clone runs credential-free: the shipped defaults are
> `QLOO_ENABLED=false` and `DEFAULT_MODE=replay`. **The hosted demo judges see runs the other
> configuration**: `QLOO_ENABLED=true`, `DEFAULT_MODE=live` and `QLOO_FORCE_LIVE=true`, so a click
> makes a real read against `https://hackathon.api.qloo.com` instead of serving a stored answer. The
> `QLOO_API_KEY` stays on the server and never reaches the browser, an API response, a log or git.

---

## What it is

Taste Brain is a platform where agents make offer / assortment / campaign decisions for organizations that serve many audiences (chains, venue operators, hotel groups, agencies, care providers). Each decision joins:

1. **The organization's own rules** (budgets, contracts, capacity, brand safety, dietary or care constraints), stored as Rule nodes linked to the SOP documents they came from.
2. **Qloo's taste data** about the audience at each location (aggregate affinities across brands, places, music and more, with explainability).

Every proposal carries a **Decision Trace**. A **Grounding Auditor** blocks anything that cannot be traced to a Qloo result or a passing Rule. A **Taste Lift** panel runs the same request through a plain LLM and through the grounded agent — the plain-LLM arm only runs when an LLM key is configured, and the panel says so when it did not. A **Vertical Pack** (one config file) adapts the engine to retail, restaurants, venues, and more.

### Why this would not work without Qloo

- Location audience portraits come from Qloo entity/tag results, not guesses.
- Candidate ranking is by Qloo's own returned result order — `/v2/insights` gives no score field, so the app reads rank, not a number, and the LLM never decides the ranking.
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
- **Global Throttle Queue:** `QLOO_THROTTLE_MS` (default 250 ms, floored at 220 ms in `rest-client.ts`) between outbound calls — about 4 calls/s, comfortably inside the 100-per-5-second burst cap this client enforces.
- **Resilience:** Automatic retry with exponential backoff and jitter on HTTP 429 and 5xx errors (up to 3 retries).
- **In-flight Deduplication & Caching:** Concurrent identical requests share a single network call. Results are cached in a LRU memory cache and persistent gitignored private disk cache (`.private-cache/`).
- **Secret Isolation:** The `QLOO_API_KEY` is accessed only within `rest-client.ts`. It is never returned in HTTP responses, never logged, and never committed to version control.

**Request→result walkthrough** (`POST /api/proposals` with `{pack:"retail", location:"store_3", goal:"Add 4 brands for spring", mode:"replay"}`) — the trace below was copied off this build's own output, and the pack data is the invented worked example, so every name and figure in it is fixture data and not a Qloo answer:

```text
1. Seeds             → type Audience: "Replay mode: 3 configured seed(s) not re-resolved
                       against /search" — Replay trusts the stored fixture ids; a Live run
                       records "seed resolved to a Qloo entity" per seed, and an ambiguous
                       or unresolvable seed is recorded as its own step, never guessed.
2. Audience portrait → type Audience: "Store 3 - East Austin, TX audience portrait"
                       (GET /v2/insights filter.type=urn:tag)
3. Candidates        → type QlooEntity: "Qloo returned 10 candidates for this audience"
                       — the order Qloo returned is the ranking. /v2/insights carries no
                       score field, so the fit figure shown per item is derived from that
                       rank by this app and the item's own text says so.
4. Rule Checker      → per item, one step per rule with the value it read:
                       budget_cap "unit_cost 46 exceeds the ceiling 40" → fail
                       min_order  "minimum_order 260 <= 500"           → pass
                       brand_safety "no excluded tag present"              → pass
5. Grounding Auditor → Riverstone Co. (Qloo rank 1, popularity 0.490) rejected on
                       budget_cap, check 3; Boggy Creek Vapor Co. rejected on brand_safety
                       (carries the excluded tag qlootag:adult_content); Mesa & Main
                       rejected on min_order (620 > 500). Each rejection is a Filter step.
6. Shown             → Cedar Row, Lumen Threads, Arbor & Ledge, Northbound Supply,
                       Halo Athletics, Dusk Records Apparel — six, in Qloo's order.
7. Unsupported       → Unknown Indie Label: Qloo ranks it for this audience, but there is
                       no approved offer or entered term to rule-check, so it is surfaced,
                       never approved.
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

Each pack defines entity types, goal templates, Rule templates (with their SOP source), fictional locations, and a candidate catalog. Rule kinds implemented: `numeric_max`, `numeric_min`, `band`, `exclude_tags`, `require_tags`, `allow_list`, `deny_list`, `exclude_recent`, `require_present` (`server/src/agents/rule-checker.ts`).

---

## Evidence: tests, Taste Lift, and Cache Warming

```bash
cd server
npm test                 # Grounding Auditor checks (§11), REST client contracts, rule kinds, pipeline hard scenario
npm run eval             # Taste Lift fixed request set -> server/src/eval/results.json
npm run gate:public      # the publish checklist below, run against committed content
npm run warm-cache       # Pre-fetches one-click scenarios on deployment host into gitignored .private-cache/
```

- The **Grounding Auditor** has automated unit tests verifying that unsupported items are vetoed, rule violations are caught, and decision traces produce reproducible `rerun_hash` values.
- **REST Client Tests** cover throttle contracts, exponential backoff on 429/5xx, timeouts, error shapes, and ensure credentials are never leaked.
- **Taste Lift** publishes whatever the numbers are. On a host with no LLM key it runs Arm B (grounded) and states plainly that Arm A (plain LLM) did not run — **no lift figure is fabricated.**
- **Cache Warmer (`npm run warm-cache`):** Run on the deployed host to populate `.private-cache/` for all one-click demo scenarios. The cache directory is gitignored and never committed.

---

## Data & provenance

Disclosed 2026-10-29 against this tree; the live figures were re-measured the same day.

- All sample data is fictional. No customer data, credentials or personal data are present.
- **Nothing committed names a real company, artist or venue, and no committed file carries a Qloo entity id.** Qloo entity ids are 36-character UUIDs, so every entity in a tracked pack, fixture, test or document is a symbolic `qloo:brand:cedar_row`-style name, and ids that appeared inside live request parameters are recorded as `qloo-entity-N` tokens (`server/verification/gate-report.json` says so in its own provenance field).
- **Live mode reaches real entities through a gitignored identity overlay** — `server/.private-data/<pack>.overlay.json` (or the `PACK_OVERLAY_B64` bundle on a host that cannot upload files). It maps each fictional seed to the real name to ask Qloo for, and each offer row to its real entity id, and it is merged in memory at pack load (`server/src/packs/overlay.ts`). It holds Qloo data, so it is treated as the same class of secret as the API key: one custodian, never committed, never printed. A checkout without it runs Replay and Cached exactly as published, and the two live-drawing rooms report that they have no fixture rather than inventing one.
- Committed artifacts (`npm run eval`, `npm run verify:sample`, `npm run smoke:replay`) set `PACK_OVERLAY_DISABLE=true`, so a Replay-generated file can never carry a real identity from the machine that made it.
- Every result is labelled with its mode (Live / Cached / Replay); nothing is presented as live that isn't.
- Live responses are kept strictly on the server in `.private-cache/` and never checked into source control.

### Two configurations, stated plainly

**A fresh clone (the committed default) is credential-free.** `QLOO_ENABLED=false` and
`DEFAULT_MODE=replay` are the defaults in code and in `server/.env.example`:

- the header's **live** control renders disabled with the reason in its tooltip, and the header shows `live off on this host`;
- the Plan screen offers no one-click **Re-run live** button;
- even a hand-made `POST /api/proposals` with `"mode":"live"` comes back labelled Cached or Sample, with the reason written into the run.

**The hosted demo runs live, on purpose.** Those judges see real Qloo reads, so the host sets
`QLOO_ENABLED=true`, `DEFAULT_MODE=live` and `QLOO_FORCE_LIVE=true`. The last one matters: it stops a
run from quietly serving the stored answer, so a badge that says LIVE was earned by a request that
left the box. Live traffic is still metered — 8 live runs per visitor per hour, 40 per visitor per
day, 400 globally per day, a 1,500 monthly floor and at most 12 Qloo calls per run — and going over
a bucket is **not an error**: the run answers `HTTP 200` as `cached` with the reason written into the
proposal ("this visitor hit the hourly live-run budget…"), because a judge mid-click should get a
honest labelled answer rather than a 429. The key custodian turns live off again when the demo is
over.

`cd server && npm run gate:public` re-checks the committed content (that the shipped defaults are
still credential-free, plus no key, no entity id, no real name, the license and the keyless Replay
path), and runs in CI.

### Deploying the hosted demo

`Dockerfile` at the repository root builds both halves into one image — the client is built, copied
to `server/public`, and served by the API (`server/src/http.ts:541`). No `.env` is baked into the
image; real environment variables always win over the file, and a missing file is fine.

```bash
docker build -t taste-brain .
docker run -p 8080:8080 -e PORT=8080 -e QLOO_API_KEY=… -e QLOO_ENABLED=true \
  -e DEFAULT_MODE=live -e QLOO_FORCE_LIVE=true -e TRUST_PROXY_HOPS=1 \
  -e GRAPH_DB=/data/taste-brain.db -e PACK_OVERLAY_B64=… taste-brain
```

Host variables for Northflank or Render, and why each one is needed:

| variable | value | why |
| --- | --- | --- |
| `PORT` | injected by the host | the container `EXPOSE`s 8080 and reads `PORT` |
| `QLOO_API_KEY` | secret | the only place the key exists; never sent to the browser |
| `QLOO_ENABLED` / `DEFAULT_MODE` | `true` / `live` | live reads, and the badge a judge sees |
| `QLOO_FORCE_LIVE` | `true` | no run may be served from the stored answer |
| `PACK_OVERLAY_B64` | secret bundle | the identity overlay; file upload is often impossible on a free host |
| `TRUST_PROXY_HOPS` | `1` | both hosts terminate TLS in front of the app, so without it every visitor shares one rate bucket and one quota bucket |
| `GRAPH_DB` | a path on a mounted volume | holds the quota counters and the ledger; on an ephemeral disk both reset with the container |
| `LEDGER_HMAC_SECRET` | any long secret | makes the ledger keyed rather than self-attested |
| `NODE_ENV` | `production` | turns on the static client mount and the startup warnings |

On an ephemeral filesystem `GRAPH_DB` resets with the host, which resets the day's counters — so on a
free tier, keep the buckets conservative (`QUOTA_VISITOR_HOUR=4`, `QUOTA_GLOBAL_DAY=200`) and warm the
cache before the session (`npm run warm-cache`) so a degraded run still has a real Qloo answer to
serve.

The overlay bundle is a command, not a guess: `cd server && npm run overlay:bundle` writes a
one-line base64 value to `server/.private-data/overlay-bundle.b64` (gitignored, never printed) and
checks every seed id and `offer_id` key against the committed packs first — `applyOverlay` drops a
patch that matches nothing without complaining, so a mistyped key is a demo that still prints LIVE
badges on invented names.

`gate:public` fails the build if any tracked line carries a credential value, a Qloo entity id (UUID literal) or a name taken from the private overlay; if `.env`, `.private-cache/`, `.private-data/` or a live capture is tracked; if the shipped defaults are not `QLOO_ENABLED=false` / `DEFAULT_MODE=replay`; if `LICENSE` is missing; if the README disclosure is older than the evidence files it describes; or if a keyless Replay run returns nothing for the three demo rooms.

### Host settings the operator chooses

Three settings describe the machine, not the product, and each defaults to the behaviour that is safe on a laptop:

- `GRAPH_DB` (default `.private-data/taste-brain.db`) is a file, not `:memory:`, because `server/src/agents/quota.ts` promises the day's counters survive a restart — an in-memory database would break that promise on the first redeploy. Set it to a path on persistent storage; on ephemeral filesystems the quota resets with the host and the ledger starts over.
- `TRUST_PROXY_HOPS` (default `0`) is how many proxy layers sit in front of the server. Rate limiting and the per-visitor quota are keyed on `req.ip`, and behind a reverse proxy every visitor arrives as `127.0.0.1` — so with the default, one visitor's traffic spends the whole world's bucket. Set it to `1` on a host that terminates TLS in front of the app, and leave it `0` if the client connects directly, because a directly-connected client can otherwise invent its own address. The server logs which of the two it is at startup, and `/api/ledger` keeps using the same key.
- `LEDGER_HMAC_SECRET` (unset by default) keys each ledger hash with `createHmac('sha256', …)` instead of a bare `createHash('sha256', …)`. Entries record which algorithm made them, so a chain written before the key existed still verifies.

### What the ledger chain does and does not prove

The ledger is **hash-chained and tamper-evident**, not tamper-proof. Recomputing it proves no entry was edited in place unnoticed — an edit changes the entry's hash, which breaks the `prev_hash` link below it. It does not prove the chain is the only chain: without `LEDGER_HMAC_SECRET`, anyone holding the database file can rewrite every entry consistently and produce a chain that verifies. The honest mitigation is outside the file, so `npm run ledger:anchor` prints the current head hash for publishing somewhere the writer does not control (the README, a commit, a screenshot). Same rule applies to the item names: a hash binds a name to the run that recorded it, not to Qloo's wording.

---

## Known limitations

- Qloo returns **aggregate audience affinities**, not evidence about any individual. The UI says so and never claims to know a person's individual taste.
- A fresh clone ships with **Replay mode on the committed sample fixtures** enabled by default, so the demo is 100% runnable offline without any credentials. The hosted demo runs Live with Force-live on — see *Two configurations, stated plainly*.
- In **Live mode**, recommendations derive from real calls to `https://hackathon.api.qloo.com`. An API key must be supplied in `server/.env`, `QLOO_ENABLED` must be turned on by the key custodian, and the host needs the private identity overlay described above — without it, the fictional seeds in the committed packs resolve to nothing real.
- Outbound API calls are limited by a 250ms throttle queue and daily soft quota limits.
- The decision ledger is tamper-evident, not tamper-proof: without `LEDGER_HMAC_SECRET` set on the host, whoever holds the database file can rewrite the whole chain and it will still verify. The chain proves an entry was not edited in place, not that the file is the only version of itself — see *What the ledger chain does and does not prove*.
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
