# Taste Brain — final submission

**Agents that decide with taste and prove why.** Taste Brain joins an organisation's own
business rules to Qloo's audience taste data and attaches a checkable Decision Trace to every
recommendation it puts on screen.

Built for the Qloo Agentic Hackathon — theme *"Agents, but with taste."*

| | |
| --- | --- |
| Live app | `http://localhost:4000` (server build deployed to `server/public`) |
| Backend / frontend | Express + TypeScript (`server/`) · React 19 + Vite + Tailwind v4 (`client/`) |
| Qloo workflows | `describe_audience`, `recommend`, `rank_shortlist`, `find_tags`, `resolve_entity` |
| Qloo transport | direct REST `GET https://hackathon.api.qloo.com` with `X-Api-Key`, server-side only |
| Verticals | 3 packs (retail, restaurants, venues) · 7 rooms |
| Agents | 17 cooperating — 7 inside a run, 5 answering about a stored run, 5 guarding the key |
| Shipped capabilities | 24, each owned by one agent and reachable on one endpoint (§12) |
| Tests | 140 passing across 7 files |
| Public gate | `npm run gate:public` — 8 checks, PASS against committed content |
| Ledger right now | 25 entries, chain re-verified, `ok: true` |
| Licence | MIT |

---

## 1. The one-sentence argument

Most hackathon agents answer *"what should I show this audience?"* with a model's opinion.
Taste Brain answers it with three separate authorities kept visibly separate: **Qloo** owns the
taste signal, the organisation's **rule pack** owns the business constraints, and a **named human**
owns the decision. The agent's only permitted job is to explain the result those two produced. Anything
that cannot be traced back to a stored Qloo result or a cited rule is labelled *unsupported* on
screen rather than quietly promoted.

---

## 2. The three-minute judge path

Hash routes mean you can jump straight to any screen; `Ctrl+K` opens the same picker.

1. **Plan** — pick `Retail and fashion → Store 3 - East Austin → "Add 4 brands for spring"`, press
   **Run the agent**. You get the ranked shortlist in Qloo's own order, one mode badge per item, and
   the reason anything was dropped.
2. **Evidence** — hover a rule chip to read the exact value the rule checked (`unit_cost 46 exceeds
   the ceiling 40`). Nothing here is model prose; it is the rule engine's own output.
3. **Trace** — every step the run took, stamped `live`, `cached` or `replay`, with the `rerun_hash`
   that lets the same export be recomputed.
4. **Break it** — press the six attacks. Each one calls the real defence on the live server and
   prints the verdict it actually returned. The counter stays at zero until you press something.
5. **Ledger** — the decision log, hash-chained. **Trust** demonstrates an edit being detected on a
   copy of the file without touching the records.
6. **Taste Lift** — press *Run the fixed request set* to see the grounded arm measured. On a host
   with no LLM key, the plain-LLM arm is recorded as *did not run* and **no lift number is invented.**
7. **Why not? · What if? · Partners** — then ask the same run three questions. Each is answered by a
   different agent off the same stored snapshot, so the answers cannot drift apart.

Everything on those screens is the server's own word. The UI computes nothing that the API did not
return.

---

## 3. How a run works

`server/src/agents/pipeline.ts` → `runPipeline({pack, location, goal, mode})` — a fixed flow with
agent steps inside, so no LLM ever chooses the control path.

| # | Stage | What it does | Authority |
| --- | --- | --- | --- |
| 1 | **Profiler** | `describe_audience` for the room's seeds; stores an `Audience` node | Qloo |
| 2 | **Taste Explorer** | `recommend`; keeps Qloo's returned order as the ranking | Qloo |
| 3 | **Rule Checker** | maps each result to an approved `Offer`, evaluates every applicable rule | pack |
| 4 | **Strategist** | preserves order, writes an explanation | LLM, explanation only |
| 5 | **Grounding Auditor** | vetoes anything without a stored Qloo id or a passing rule | code |
| 6 | **Approver** | records a `Decision` node with the human's name | human |

`/v2/insights` returns no score field. The app therefore reads **rank**, not a number, and the fit
figure shown per card is derived from that rank by Taste Brain — the card itself says so, and the
trace records the Qloo position untouched.

**Flip points** are the honest middle: candidates Qloo ranks for the audience that have no approved
offer to rule-check are surfaced as *unsupported*, never promoted into the list.

---

## 4. The multi-agent roster

Taste Brain is a **multi-agent system with a fixed spine**. Seventeen agents cooperate — seven inside
a run, five that answer questions about a stored run, five that guard the key and the claim — but no
agent plans the work and none may step outside the authority it is given: the order of calls is
written in `pipeline.ts`, so a model cannot decide to skip the Auditor or invent a ranking step.

**Decision agents** (they touch the run):

| agent | module | authority it holds | what it is forbidden to do |
| --- | --- | --- | --- |
| **Profiler** | `agents/pipeline.ts` | asks Qloo for the room's audience portrait | resolve an ambiguous seed by guessing |
| **Taste Explorer** | `agents/pipeline.ts` | brings back Qloo's candidates **in Qloo's order** | re-sort, score or trim the list |
| **Rule Checker** | `agents/rule-checker.ts` | decides pass / fail / needs-data from pack rules | read prose; call a model |
| **Flip Point engine** | `agents/flip.ts` | names the exact policy change that would admit a blocked item | claim a change that was not made |
| **Strategist / LLM** | `agents/llm.ts` | writes the explanation a human reads | rank, filter, approve, or be trusted by the Auditor |
| **Grounding Auditor** | `agents/auditor.ts` | **veto power** — blocks anything without a stored Qloo id or a passing rule | let an unsupported item into the list |
| **Approver** | `http.ts` → `Decision` node | records a human's approve/reject by name, into the ledger | act without a named person |

**Question agents** (read-only; they answer a person about a stored run and never call Qloo, never
re-rank, never write a new number): **Why-not** `whynot.ts`, **What-if** `whatif.ts`, **Partners**
`partners.ts`, **Ablation Lab** `ablation.ts`, **Approval brief** `brief.ts`.

**Guardian agents** (they protect the key and the claim): **Quota Guardian** `quota.ts`, **Coverage
Board** `coverage.ts`, **Trust Center** `trust.ts`, **Parameter allowlist** `qloo/allowlist.ts`,
**identity overlay** `packs/overlay.ts`.

Why seventeen agents rather than one loop: each refusal is testable, each authority is attributable,
and a judge can ask *which agent* produced a claim. A single autonomous planner could not answer that.

---

## 5. What the code enforces, not what the prompt asks

These are checks, not intentions:

- Every recommendation carries a stored Qloo result **or** a rule citation. One of the two, always
  (`auditItem`, checks 1 and 3).
- The LLM never ranks and never filters; nothing in the UI re-sorts Qloo's order.
- A named human approves; the system never acts on its own.
- Every result and every trace step is stamped with its data provenance — Live, Cached, or Replay
  (the offline sample data committed to this repo).
- Ambiguous or unresolvable seeds become their own trace step instead of a guess.
- Language is about audiences, never about an individual person.
- Rejections are shown with the failing rule and the value it read; nothing is silently dropped.

Nine rule kinds are implemented (`rule-checker.ts`): `numeric_max`, `numeric_min`, `band`,
`exclude_tags`, `require_tags`, `allow_list`, `deny_list`, `exclude_recent`, `require_present`.

---

## 6. Live Qloo, measured

From `docs/live-run-scorecard.md`, captured 2026-10-24 by driving the same browser surface a judge
uses. Machine-readable figures: `server/verification/live-scorecard.json`.

| | figure |
| --- | --- |
| Real Qloo reads that left the box | **37** (49 across every verification pass, all disclosed) |
| Served from the stored copy, 0 bytes | 24 |
| Logged calls total | 61 |
| Live latency (n=37) | min **363 ms** · p50 **950 ms** · p90 **3,662 ms** · max **8,439 ms** |
| Rooms run | 7 across 3 packs, every one badged LIVE |
| Items recommended | **66**, and **66/66** carry a Qloo rank and an explanation |
| Rule outcomes | 173 pass · 48 needs-data |
| Auditor rejections | 10 · flip points 9 · unsupported candidates 99 |
| Trace steps recorded | 537 |

**Two rooms returned zero items, and that is the correct answer.** `venues/venue_redroom` and
`restaurants/loc_westside` have catalogues keyed to entities with no approved offer on file. Qloo
returned rows; the engine refused to present them as offerable and rendered the empty state with the
reason. A demo that always shows six cards is a demo that is making them up.

---

## 7. Cost control and abuse control

Live calls are money and a shared team key, so they are metered in four buckets plus a hard ceiling:

| guard | value |
| --- | --- |
| Max Qloo calls per run | `QLOO_MAX_CALLS_PER_RUN=12` |
| Visitor, hour | 8 live runs |
| Visitor, day | 40 |
| Global, day | 400 |
| Monthly floor | 1,500 (one unit per live request) |
| Outbound throttle | `QLOO_THROTTLE_MS=250`, floored at 220 ms — about 4 calls/s |
| Retry | exponential backoff with jitter on 429/5xx, up to 3 |
| Duplicate calls | in-flight dedup + LRU memory cache + gitignored disk cache |
| HTTP | per-IP token-bucket rate limit, 64 kb request-body cap |

Counters live in the SQLite database, not in memory, so the day's spend survives a restart. The
**Budget** screen shows the server's own bucket readings; nothing there is estimated.

---

## 8. Provenance and the identity overlay

Nothing committed names a real company, artist, venue or dish, and no tracked line carries a Qloo
entity id. Qloo ids are 36-character UUIDs, so every entity in a tracked pack, fixture, test or
document is a symbolic name (`qloo:brand:cedar_row`), and an id that appeared inside a recorded
request parameter is written as a `qloo-entity-N` token.

Live mode reaches real entities through a **gitignored overlay**:
`server/.private-data/<pack>.overlay.json` (or `PACK_OVERLAY_B64` on a host that cannot take a file
upload) maps each fictional seed to the real name to ask Qloo for, and each offer row to its real
entity id. It is merged in memory at pack load (`packs/overlay.ts`), never mutated, never logged,
never returned. A checkout without it runs Replay and Cached exactly as published, and the two
live-drawing rooms report that they have no fixture instead of inventing one.

Committed artifacts (`eval`, `verify:sample`, `smoke:replay`, `gate:public`) set
`PACK_OVERLAY_DISABLE=true`, so a file generated on the custodian's machine is byte-identical in
shape to one generated from a fresh clone.

`QLOO_ENABLED=false` and `DEFAULT_MODE=replay` are the defaults in code, in `.env.example` and on the
public host — no visitor can spend the team key by accident. Turning live on is a deliberate,
reversible act by the key custodian. *(The host this document was written on currently has it on for
verification: `/api/health` reports `qloo_key: "set"`, `default_mode: "live"`, `force_live: true`.
The shipped default remains off.)*

---

## 9. Tamper evidence, stated honestly

The ledger is **hash-chained and tamper-evident, not tamper-proof.**

- What it proves: an entry was not edited in place. A change alters that entry's hash and breaks the
  `prev_hash` link below it, which `GET /api/ledger/verify` recomputes from the first entry.
- What it does **not** prove: that the file is the only version of itself. Without
  `LEDGER_HMAC_SECRET`, anyone holding the database can rewrite the whole chain consistently and it
  still verifies. `npm run ledger:anchor` prints the head hash to publish somewhere the writer does
  not control.

The current chain is 25 entries and is reported as `keyed: false` — the UI says that in the same
place it says the chain verifies. **Trust** demonstrates a detected edit on a copy of the file, so
the demonstration never touches real records. The same honesty applies to names: a hash binds a
name to the run that recorded it, not to Qloo's wording.

---

## 10. Security

- `QLOO_API_KEY` is read inside `rest-client.ts` and nowhere else. It is never in client code, API
  responses, the call log, tests, screenshots or git.
- `.env`, `.private-cache/`, `.private-data/` and captured live payloads are gitignored and untracked.
- `npm run gate:public` checks **committed content** (`git show HEAD:<path>`), not the working tree,
  for credential values, UUID entity ids, and every name in the private overlay — and prints only
  `file:line` on failure, so a leak cannot be echoed into CI output. It also checks the shipped
  defaults, the licence, the README disclosure date, and that a keyless Replay run still works.
- SOP text and user text are treated as data. The Auditor does not trust LLM output, so prompt
  injection cannot promote an item that has no Qloo result or rule behind it.
- `scripts/public-gate.ts` reported **PASS on 8 checks over 138 tracked files** at the commit this
  document describes.

---

## 11. The interface

17 screens in 4 groups. Nothing was added for colour's sake; each screen exists because a judge or an
operator needs to answer a question.

| group | screens |
| --- | --- |
| **Decide** | Plan · Evidence · Trace · Brief |
| **Question** | Why not? · What if? · Partners |
| **Prove it** | Ablation · Trust · Verify · Break it · Coverage · Ledger |
| **Operate** | Budget · Finals · Taste Lift · About |

Design decisions that carry weight:

- **Modes are visible everywhere.** A Live / Cached / Replay badge sits on every result and every
  trace step, so a stored answer can never be mistaken for a fresh one.
- **Derived numbers are labelled where they appear.** The fit score's caption says it was derived by
  Taste Brain from Qloo's order; Qloo's own rank is shown beside it.
- **Empty states explain.** A room with no approved offer says why rather than showing a blank card
  or a padded list.
- **The page band is a title and a screen picker.** Prose that a judge would not read twice lives in
  tooltips, not on the page.
- **Contrast was fixed, not assumed.** Micro-text that measured 2.5:1 on paper, an active segmented
  pill whose dark rule out-specified its own accent state, `--muted-foreground` left at its light
  value under the dark theme, and two medal gradients that ran pale under white text — all corrected.

---

## 12. Feature register — everything it does, and where you use it

Twenty-four shipped capabilities. Each row names the agent that owns it, the screen, the exact
endpoint, and the decision a team actually uses it for. Nothing in this table is planned; every
endpoint below answers on the running server.

| capability | who computes it | screen | endpoint | used for |
| --- | --- | --- | --- | --- |
| Run the agent, 6-stage grounded pipeline | Profiler · Explorer · Rule Checker · Strategist · Auditor | Plan | `POST /api/proposals` | a room's next assortment, menu or lineup |
| Pack + room + goal picker, goal templates | pack config | Plan | `GET /api/packs`, `/locations`, `/locations/:loc` | moving the same engine to a new vertical |
| Mode choice: live · cached · replay, stamped on every result | `qloo/adapter.ts` | Plan, Trace | `mode` on the run body | spending the key deliberately, or never |
| Per-item rule chips with the value the rule read | Rule Checker | Evidence | `GET /api/proposals/:id` | settling "can we actually carry this?" |
| Qloo rank shown as Qloo returned it | Taste Explorer | Evidence | `/api/proposals/:id` | proving nothing was re-sorted |
| Decision Trace, per-step mode and time | `trace/builder.ts` | Trace | `/api/proposals/:id/trace` | reconstructing a decision months later |
| `rerun_hash` — recompute and prove the same ranking | `trace/builder.ts` | Trace, Verify | `GET /api/proposals/:id/export`, `POST /api/verify` | answering "is this file the run you claim?" |
| Auditor rejections, with the failing rule and check 1/2/3 | Grounding Auditor | Evidence, Why-not | on the proposal payload | knowing what was refused and why |
| Flip points — the policy edit that would admit a blocked item | Flip Point engine | Plan, Evidence | on the proposal payload | a buyer changing a ceiling, not the data |
| Unsupported list — ranked by taste, no approved offer | Auditor + flip | Evidence | on the proposal payload | spotting a catalogue gap before a competitor does |
| Owner approval brief, one page a person signs | `agents/brief.ts` (V6) | Brief | `GET /api/proposals/:id/brief` | handing the decision to a human with receipts |
| Why-not — why X is absent from the list | `agents/whynot.ts` (F12) | Why not? | `POST /api/whynot` | the supplier's first question, answered from the stored run |
| What-if — move one number, see the diff | `agents/whatif.ts` (F13) | What if? | `POST /api/whatif` | a merchandiser testing a budget change, 0 Qloo calls |
| Co-promotion partners across entity types | `agents/partners.ts` (V5) | Partners | `POST /api/partners` | pairing a show with record shops and places |
| Ablation Lab — what each guardrail is worth | `agents/ablation.ts` (F11) | Ablation | `GET /api/proposals/:id/ablation` | proving the Auditor changes outcomes, deterministically |
| Break-it Challenge — six live attacks | `breakit/attacks.ts` (W6) | Break it | `GET /api/breakit`, `POST /api/breakit` | unsupported item · name injection · policy-text injection · ledger tamper · budget breach · unverified parameter |
| Trust Center — every promised guardrail as a passing or failing check | `agents/trust.ts` (F47) | Trust | `GET /api/trust` | showing an edit detected on an in-memory copy, never the real ledger |
| Coverage Board — what this key can and cannot do | `agents/coverage.ts` (F49) | Coverage | `GET /api/coverage` | stopping the demo overclaiming a capability |
| Human decision by name, into a hash-chained ledger | Approver (F7 + F15) | Ledger | `POST /api/proposals/:id/decision`, `GET /api/ledger`, `/api/ledger/verify` | accountability that survives the person who decided |
| Taste Lift — grounded agent vs plain LLM on a fixed request set | `eval/taste-lift.ts` | Taste Lift | `POST /api/eval/run`, `GET /api/eval/results` | measuring the grounding instead of asserting it |
| Quota Guardian — four buckets, per-run ceiling, degrade reasons | `agents/quota.ts` (F41) | Budget | `GET /api/health` | never exhausting a shared hackathon key |
| Finals Mode — rebuild a run from a snapshot, no network, no key | `pipeline.ts` (F48) | Finals | env `FINALS_OVERRIDE`, `GET /api/mode` | a stage demo that cannot fail on Wi-Fi |
| Run snapshots and the redacted Qloo call log | `qloo/rest-client.ts` | Trace, Budget, Coverage | `GET /api/snapshots`, `/api/qloo/log`, `/api/qloo/rest-log` | auditing spend; headers, keys and payloads are never logged |
| Packs, overlays, warm cache, public gate, ledger anchor | `packs/`, `scripts/` | About | `npm run warm-cache`, `gate:public`, `ledger:anchor` | shipping a new vertical as one JSON file, and publishing safely |

Three of these are worth reading twice, because they are the ones an agent product usually hides:
**What-if** and **Why-not** answer from the stored snapshot with zero model calls, so the diff is
exactly attributable to the one number you moved; the **Break-it** attacks run against the real
defences and report *"could not be run"* when the fixture does not exercise a path; and the
**Coverage Board** publishes the Qloo capabilities this key could not demonstrate.

---

## 13. Where it can be used

The engine is three things in a fixed order — a taste signal, a policy check, a named human — so it
transfers to any decision of the shape *"given this audience and these constraints, what should we
put in front of them?"* Shipped today: three packs. Everything below it is the same engine with one
config file added.

**Live in this build**

| pack | rooms | the decision it makes |
| --- | --- | --- |
| Retail and fashion (deep) | store_1 · store_2 · store_3 | which brands to add for a season, under budget, minimum-order and brand-safety rules |
| Restaurants and hospitality (thin) | westside and more | which dishes and promotions to add per neighbourhood, under margin, supplier and dietary rules |
| Venues, events and media (thin) | corner hall · alder room · redroom | which acts to book for a room, and which shops and places to co-promote with |

**One config file away** — each is a `server/src/packs/data/<vertical>.json` with its own locations,
goal templates, rules and SOP citations; no agent, graph or trace code changes:

- **Multi-site chains and franchise ops** — assortment and localisation per store, with the
  contract and capacity rules that stop a store buying what head office excluded.
- **Hotel and resort groups** — in-room, F&B and experience line-ups per property, by the taste of
  that property's guests rather than the brand average.
- **Retail media and sponsorship** — pairing a brand with the inventory whose audience actually
  overlaps, then rule-checking the exclusivity and category bans.
- **Festival, club and venue programming** — line-up construction, night-by-night, plus the
  co-promotion partners the Partners agent already produces for venues.
- **Radio, playlist and streaming curation** — audience-matched rotation with a documented
  brand-safety veto and a trace a programmer can defend.
- **Tourism boards and city cultural programmes** — what to promote to which visitor segment, at
  aggregate audience level only.
- **Marketplace and grocery curation** — assortment and on-shelf rotation under margin,
  minimum-order and prohibited-attribute rules.
- **Agency pitch and account work** — the same run becomes a client-facing artefact: a brief a human
  signs, with the evidence attached and the refusals visible.
- **Menu engineering and CPG line extension** — a candidate list scored against real audience taste
  instead of a category manager's memory.

**Multiple people, one run — what the multi-agent design is actually for**

A single run is not read by one person. The roster exists because a **buyer** asks *why isn't this on
the list*, a **category lead** asks *what if the ceiling were 40 instead of 30*, a **marketing
manager** asks *who can we promote this with*, a **GM** asks *what would it take to say yes to this
act*, and a **compliance or brand-safety reviewer** asks *what refused, and can I prove it later*.
Each of those is a different agent on the same stored run, with the same trace, the same rule values
and the same ledger — not five fresh answers that disagree.

**Deployment shapes it runs in**

- a laptop or a fresh clone with **no credential at all** — Replay on committed sample data;
- a **hosted demo** with live off (`QLOO_ENABLED=false`) so a visitor cannot spend the team key;
- a **planned live take** by the key custodian, metered by the four quota buckets;
- **stage/Finals mode**, rebuilt from a snapshot with no network and no key;
- **CI**, where the same tests and `gate:public` run on every push.

**Out of scope, on purpose** — the engine is decision support for a named human. It is not medical,
financial or legal advice; the senior-care scenario is deliberately not in the shipped demo; it never
profiles an individual, only aggregate audiences; and it makes no claim about revenue or performance,
because nothing in this build measures them.

---

## 14. Data store

SQLite via `node:sqlite` (`server/src/graph/store.ts`) — a generic `nodes(kind,id,data)` +
`edges(src,rel,dst,data)` graph, licence-safe for a public open-source release, with no external
database to stand up and the whole demo runnable offline. Node kinds: `Tenant, Pack, Location,
Audience, QlooEntity, QlooTag, Offer, Rule, SOPDocument, Proposal, Decision, Person`. Relations:
`HAS_AUDIENCE, AFFINITY, DESCRIBED_BY, MATCHES, DEFINED_IN, CONSTRAINS, SUPPORTED_BY,
CHECKED_AGAINST, RESULTS_FROM, APPROVED_BY`.

The `Decision Trace` (`trace/builder.ts`) is ordered steps with `type, label, source, mode, result,
at`. `rerun_hash` is a sha256 over the decision-relevant steps, so an exported proposal can be
re-run and the ranking proven to reproduce — covered by a test.

Adding a vertical is one JSON file in `server/src/packs/data/` — locations, goal templates, rules
with their SOP source, a candidate catalog. No agent, graph or trace code changes.

---

## 15. Verification

```bash
cd server
npm test                 # 140 tests, 7 files
npm run typecheck
npm run gate:public      # the publish checklist, against committed content
npm run eval             # Taste Lift fixed request set -> src/eval/results.json
npm run verify:sample
npm run smoke:replay
npm run qloo:smoke       # real REST, credential required
node --test              # via npm test; CI runs the same path
cd ../client && npm run lint && npm run build   # tsc -b + vite build
```

What the 140 tests cover: Grounding Auditor veto behaviour (§11 of the PRD), rule-kind semantics,
REST client contracts (throttle, backoff, timeouts, error shapes, credential never leaked), the
pipeline's hard scenario, trace `rerun_hash` reproducibility, ledger verification, quota buckets,
overlay merging, and pack data integrity. `.github/workflows/ci.yml` runs the same gates.

Checked for this submission: TypeScript clean, ESLint clean, client build clean, **140/140 server
tests**, `client/dist` deployed to `server/public`, app serving on `:4000`, a real end-to-end run
returning 25 items with all API calls 200, **17/17 screens rendering with 0 console errors**, and
`/api/health` carrying no key material.

---

## 16. Limitations, in our own words

- Qloo returns **aggregate audience affinities**. Nothing here is evidence about a specific person.
- Recommendations are **decision support**, not a claim of revenue, savings or performance. No
  business outcome is measured or asserted.
- Live mode needs the key, `QLOO_ENABLED=true` **and** the private overlay; without the overlay the
  fictional seeds in the committed packs resolve to nothing real.
- **Taste Lift's plain-LLM arm only runs with an LLM key.** On a host without one, the panel says the
  arm did not run and publishes no lift figure. A fabricated comparison would be worse than none.
- Two rooms legitimately return zero live items; the empty state is the product's answer.
- The ledger is tamper-evident, not tamper-proof, and unkeyed entries are labelled as such.
- Qloo `/v2/insights` carries no score field, so ranking is positional and the numeric fit shown is
  our derivation, labelled at every occurrence.
- Multi-tenancy, billing, SSO and production cloud isolation are out of scope for a hackathon build.
- The senior-care scenario is deliberately not in the shipped demo; the engine is not medical,
  financial or legal advice.

---

## 17. Self-assessment against the four criteria

Equally weighted, per the [hackathon rules](https://qloo.devpost.com/rules).

| criterion | evidence |
| --- | --- |
| **Technological implementation** | 17 cooperating agents in a six-stage fixed pipeline over the real REST API; 5 Qloo workflows; 24 shipped capabilities on 30 HTTP routes; throttle, backoff, dedup, two-layer cache and a 4-bucket quota; hash-chained ledger; `rerun_hash` reproducibility; 140 tests; a public gate that inspects committed content |
| **Design** | one authority per visual element; mode badges on every result; derived figures labelled where they appear; empty states that explain; tooltips instead of wall text; contrast corrected to AA |
| **Potential impact** | any organisation serving many audiences needs its rules and its taste signal to meet in one auditable record; 3 verticals prove the pack is config, and a fourth is one JSON file |
| **Quality of the idea** | the interesting part is what the agent is *not* allowed to do — no ranking, no filtering, no approval, no unstated number. The refusal cases (zero-item rooms, unsupported flip points, no fabricated lift) are the strongest evidence that the boundary is real |

---

## 18. What we would build next

A second key custodian and a written hand-off; overlay materialisation with an expiry so a stale real
identity cannot silently serve a decision; publishing the ledger head hash into the repository so the
chain is externally anchored rather than self-reported; per-room call budgets surfaced before a run
rather than after; and a scored comparison harness that can run both Taste Lift arms on any host.

---

## 19. Repository

```text
taste-brain/
  README.md  FINAL.md  LICENSE  server/.env.example
  server/  src/{config,types,graph,qloo,packs,agents,trace,eval,http,index}.ts
           scripts/  tests/  verification/  public/  (gitignored .env, .private-cache, .private-data)
  client/  src/{App.tsx,index.css,lib,components,ui,screens}
  docs/    architecture.md  limits.md  demo-script.md
           devpost-description.md  live-run-scorecard.md
  .github/workflows/ci.yml
```

Run it with no credential at all: `cd server && npm install && cp .env.example .env && npm run dev`,
then `cd client && npm install && npm run dev` and open `http://localhost:3000`. Replay works offline.
The production surface is the built client served by the API on `:4000`.

Licence **MIT**. See `README.md` for the full data-and-provenance disclosure,
`docs/limits.md` for the honesty rules, `docs/architecture.md` for the contracts, and
`docs/live-run-scorecard.md` for every measured figure quoted above.
