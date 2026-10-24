# Live Qloo run — measured scorecard

Captured 2026-10-24. Machine-readable version with every per-run and per-arm figure:
[`server/verification/live-scorecard.json`](../server/verification/live-scorecard.json).

This is a self-assessment against the four **equally weighted** criteria published in the
[hackathon rules](https://qloo.devpost.com/rules) — Technological Implementation, Design,
Potential Impact, Quality of the Idea. It is written from numbers read off the running app,
not from intent. Raw live Qloo payloads are kept outside this repository; only statuses,
counts, parameter names and derived metrics are stored here — and an entity id that
appears inside a recorded request parameter is replaced by a `qloo-entity-N` token
(`server/verification/gate-report.json` carries the `redaction` note that explains it).

**How it was obtained.** The dev stack was started once in a documented live configuration
(`QLOO_ENABLED=true`, `DEFAULT_MODE=live`, `GRAPH_DB=verification/live-2026-10-24.db`) and
driven from the browser at `:3000` and `/api` at `:4000` with Playwright — the same surface a
judge uses. That configuration was reverted to Replay as soon as the sweep was captured, so
the shipped default stays credential-free.

## Spend, disclosed up front

| | figure |
| --- | --- |
| Real Qloo reads that left this box | **37** |
| Lookups served from the stored copy (0 bytes) | 24 |
| Logged calls total | 61 |
| Live-read latency (n=37) | min **363 ms** · p50 **950 ms** · p90 **3,662 ms** · max **8,439 ms** |
| Window | 06:53:10Z → 06:56:11Z (**3 min**) |
| Workflows exercised | `search`, `describe_audience`, `recommend`, `recommend_no_location`, `recommend_location_only`, `recommend_trend_bias` |
| Quota after the sweep | 13 of 90 hourly · 13 of 150 daily · 13 of 400 global · 13 of 1,500 floor |

An earlier verification pass spent 4 more live reads and the re-enabled live pass below spent 8
more, all disclosed: **49 real reads** across every pass on this host. The in-memory harness
counter resets on dev-server reload, so the saved call log — not the counter — is the spend
record. What was live and what was not: every audience portrait and every ranking call in the
sweep was a live miss, while the retail and restaurant seed lookups were served from stored
`/search` results dated 2026-10-22 and are logged as cached rather than counted as reads.

## The sweep: 8 proposals, 3 vertical packs, 7 rooms, all badged LIVE

| room | items | with Qloo rank | explained | rules pass / needs_data | flip pts | rejections | unsupported | trace steps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| venues/venue_thalia | 25 | 25 | 25 | 50 / 25 | 0 | 0 | 0 | 130 |
| venues/venue_luckett | 23 | 23 | 23 | 69 / 23 | 2 | 2 | 0 | 154 |
| venues/venue_redroom | 0 | — | — | — | 0 | 0 | 25 | 30 |
| restaurants/loc_westside | 0 | — | — | — | 0 | 0 | 25 | 29 |
| retail/store_1 | 7 | 7 | 7 | 21 / 0 | 2 | 2 | 16 | 66 |
| retail/store_2 | 5 | 5 | 5 | 15 / 0 | 3 | 3 | 17 | 62 |
| retail/store_3 | 6 | 6 | 6 | 18 / 0 | 2 | 3 | 16 | 66 |
| **total (7 rooms)** | **66** | **66** | **66** | **173 / 48** | **9** | **10** | **99** | **537** |

Every recommended item carries a Qloo rank and an explanation — 66 of 66, no exceptions.
Nothing was dropped for want of data: 99 candidates are labelled **unsupported** instead of
being shown as picks.

**Two rooms returned 0 live items, and that is the correct answer.** Their catalogues are
keyed to synthetic entities with no approved offer on file, so Qloo returned rows and the
engine refused to present them as offerable. Reproduced on screen:
`venues/venue_redroom` and `restaurants/loc_westside` render the empty state with the
reasoning, not a padded list.

## Did Qloo's order matter? Ablation, measured on the live runs

Seven live proposals, 5 arms each, compared over the top 10 of a 25-row pool. Arm A is the
ranking the proposal shipped, so it is τ = 1.0 by construction — the informative arms are B,
C, D and E. Arms B and C were issued as separate live requests (distinct parameter hashes,
both live misses in the call log), so they are not the same answer re-labelled.

| arm | what it removes | Kendall τ | overlap@10 | positions moved in top-10 |
| --- | --- | --- | --- | --- |
| A · Full | nothing (reference) | 1.0 | 1.0 | 0 |
| B · Location only | the taste seeds | not defined — no shared items | 0 … 0.1 | 10 of 10 |
| C · Seeds only | the room | venues: not defined · retail/restaurants: **1.0** | venues 0 · retail 0.9 … 1.0 | venues 10 of 10 · retail 0 |
| D · No Qloo | the API entirely | **−0.16 … 0.15** | 0.3 … 0.5 | 10 of 10 |
| E · Shuffled Qloo | only the order | **0.087 (all seven, fixed seed)** | 0.5 | 10 of 10 |

Chance overlap at k=10 from a 25-row pool is **0.4**, so the shuffled control sits essentially
at chance while the shipped ranking does not. Arm D — ordering by smallest known audience, then
alphabetically, with no Qloo ordering at all — moves every top-10 position and correlates at or
below τ 0.15. The ranking is Qloo's.

**And the local story is a venues story, reported as measured.** In venues, removing the room
swaps the whole top 10 (a seeds-only query returns nationally-touring indie acts, a
location-only query returns Kacey Musgraves and Willie Nelson). In retail and restaurants the
live no-location arm returned the **identical order** (τ 1.0, overlap 1.0), so those proposals
publish `local_lift: 0` on every item instead of implying the city moved something. Venues
publish `local_lift: null` — the item simply is not in the other arm's list, so a rank delta
would be invented. That distinction (0 vs null) is the app refusing to overclaim.

Two live reads were slow enough to be worth naming: `recommend_trend_bias` 8,439 ms and
`recommend_location_only` 7,423 ms, both on the same restaurant run. Nothing retried or
duplicated them.


## Is any of it overstated? Guardrails, re-measured after the sweep

| check | result |
| --- | --- |
| Trust Center | **13 pass · 0 fail · 0 unproven** |
| Ledger chain | **verified** — 10 entries, every hash recomputed and every link checked, head `a7b1025f9a4e02e0…` |
| mode-honesty | badge and step mix reconciled from the trace; a run that asked for LIVE and read nothing is relabelled CACHED |
| LLM involvement | 0 trace steps attribute a ranking change to the model; no LLM key on this host, so Arm A never ran and **no lift figure was fabricated** |
| Typecheck | server `tsc --noEmit` 0 errors · client `tsc --noEmit` 0 errors |
| Tests | `vitest run` → **84 passed**, 4 files (later the same day, after the W1 verifier and W6 break-it suites landed: **120 passed**, 6 files) |
| Browser console faults | **0** across every harness run |

The honesty work in this pass was measured, not restated: the server now publishes a per-run
`mode_mix` counted from the trace, every read route backfills it for older runs, Plan/Trace/
header disclose it (`"154 of 154 steps read from Qloo on this run"`), and Trust check 7
**fails** a badge that claims more than its steps show. Driving the same run with every
answer already cached produced `0 live, 130 cached` and a CACHED badge — the label follows
the bytes.

## Qloo capability gate

`gate: pass` — Chicago, Austin and Nashville each returned 20 artists with the location
signal, 20 after the popularity band, and a non-empty English description on every entity.
**10 capabilities verified · 3 accepted-but-empty · 0 not usable.**

Recorded as accepted-but-empty rather than as features: `/v2/trending`, demographics
segmentation, geographic heatmap — HTTP 200, zero rows. Three contract details were learned
by being wrong: `filter.results.entities` must name entities inside the result space (passing
the taste seeds returns 0 rows), tags arrive as `{id, name, type}` objects so rules match on
the id, and `short_descriptions` is multilingual so only the English entry is read. No
affinity/score field is returned for entity results, which is why the app shows Qloo's **rank**
as authoritative and labels its 0..1 `fit` as derived from that rank.

## Self-scores against the published criteria

| criterion (equally weighted) | score | the measured case | the honest gap |
| --- | --- | --- | --- |
| Technological Implementation | **9 / 10** | 37 real reads over 6 workflows, 8 live proposals from one engine across 3 config-only packs, 10 capabilities verified and 3 recorded as empty | 2 of 7 rooms return 0 items — correct, and a weaker screen; and retail's live no-location arm returned the same order, so its local-lift story is 0 |
| Design | **8 / 10** | 12 screens at capture (17 now: Verify, Break it, Brief and five more joined), provenance on every result, evidence cards carrying Qloo's own figures (popularity 0.836, 14,187 followers, Indie Folk), ledger hashes recomputed on view | nothing deployed; no human but the author has seen it outside a terminal |
| Potential Impact | **8 / 10** | a named approver required, no rule silently bypassed, 9 flip points telling the operator which threshold would have changed the answer | no business outcome measured or claimed; 8 proposals is a demo, not evidence of revenue |
| Quality of the Idea | **9 / 10** | the API is the thing being *proved*: shuffled control collapses to chance while the shipped order does not, and the pipeline will downgrade its own LIVE badge | Taste Lift cannot publish an LLM comparison without a key |
| **weighted total** | **8.5 / 10** | | |

## Restored to the shipped default — and what that found

After the sweep the host went back to `DEFAULT_MODE=replay`, `QLOO_ENABLED=false` and was
driven through the browser again. Health reads `live switched on for this host: no` and
`a live call can leave this box: no`; the whole pass cost **0 real Qloo reads**; Trust stayed
**13 pass · 0 fail**, the ledger chain verified, console faults 0.

Driving the offline path found one more overstatement of the same family. A Replay run for a
room with no committed fixture used to emit five `Relax` steps — "after dropping the popularity
band returned no rows", "after dropping the location filter…" — and then
`Qloo returned 0 candidates for this room`. Nothing was dropped and Qloo was never asked: there
is simply no fixture file for that room. The ladder is now skipped when the fixture is absent and
the step names the real cause:

| run | before | after |
| --- | --- | --- |
| venues/venue_thalia (no fixture) | 8 steps, 5 of them fabricated relaxations, "Qloo returned 0 candidates" | **3 steps**, one `fail` naming `Replay holds no committed fixture for venues/venue_thalia … missing sample data on our side, not Qloo having nothing` |
| venues/venue_redroom | 20 steps, 2 items | unchanged ✓ |
| retail/store_1 | 23 steps, 3 items | unchanged ✓ |
| restaurants/loc_westside | 19 steps, 2 items | unchanged ✓ |

Fixtures cover 5 of the 7 rooms; the two rooms whose candidates are real Qloo data (Thalia,
Luckett) cannot ship committed fixtures, because live Qloo payloads must not enter the repo. So
the credential-free judge path is Red Room / Store 1 / Westside — which is the documented 60-second
path — and Thalia says why it is empty instead of blaming Qloo.

## Live re-enabled: what a fresh run cost, and what it exposed

`QLOO_ENABLED=true` again, requested per call rather than globally. Two results are on record:

- **A genuinely fresh live run.** `p_mvm7xz9v_007`, venues/venue_thalia, badge **LIVE**,
  **130/130 trace steps fetched now** (0 cached, 0 replay, 0 steps missing a mode), 25 items with
  real Qloo entities. Trust 13 pass, ledger chain verified (5 entries, head `1917eb001548865e…`),
  console faults 0. The five headliners and their fit scores are live Qloo output, so they are not
  copied into this file — they are on screen in the running app and in the saved run kept outside
  the repo. Six new cache misses plus 2 Partners misses: **8 real Qloo reads** in that pass,
  on top of the 37 disclosed above.
- **The same room asked live again, minutes later: `p_mvm8iv58_001`, badge CACHED, 0/130 fetched
  now.** Every answer was already in `.private-cache`, so no byte crossed the wire. That is the
  labelling rule working, and it cost **0 Qloo reads**.

The second run exposed the third overstatement of this family: the reason lived only on the
request session, so once the run was stored it said `mode: cached` and nothing else. Two viewers
looking at the same proposal could not tell "quota sent this to cache" from "you asked live and we
already had it". `Proposal` now carries `degrade_reason`, written at the time of the run, and the
Plan screen prints it above the portrait:

> **This run is labelled CACHED** — Live was allowed and asked for, but every answer was already in
> this server's stored copy — the run made no live read, so it is labelled Cached.

Finals Mode (re-serving a stored live run) states its own reason, and the quota path reuses the
guardian's sentence. Verified in the browser at `localhost:3000` — note rendered, header badge
`CACHED · 0/130 fetched now`, `restored from the store`; `tsc --noEmit` clean on server and client,
84/84 tests pass, 0 live reads spent.

## What still blocks the submission itself

These are requirements in the rules, not polish:

1. **No public repository.** The rules require a public repo on GitHub/GitLab/Bitbucket with
   all source, assets and instructions, plus an open-source license visible on the repo page.
   `LICENSE` is in this tree; nothing has been pushed. This needs the operator's go-ahead.
2. **No functional demo link.** A judge cannot reach `localhost:3000`. Replay mode is the
   answer — it needs no credential, no personal data and shows the full product — but it still
   has to be hosted somewhere.
3. Recording: a 2–3 minute walkthrough of the 60-second path in the README.
4. Live mode for judges requires their own key; the harness key must not be shared or baked
   into a public build.

## Reproduce it

```bash
# offline, credential-free — the shipped default
cd server && npm run dev      # Replay fixtures, :4000
cd client && npm run dev      # :3000, proxies /api

# the live configuration used for this sweep, if you have a harness key
cd server && GRAPH_DB=verification/live-2026-10-24.db \
  QUOTA_VISITOR_HOUR=90 QUOTA_VISITOR_DAY=150 \
  QLOO_ENABLED=true DEFAULT_MODE=live npm run dev
```

Replay and Cached output is never presented as live. Live responses go only to the gitignored
`.private-cache`; the durable live database under `server/verification/` is gitignored too.
