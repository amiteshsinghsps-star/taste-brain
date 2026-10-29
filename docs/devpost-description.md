# Devpost submission text (draft)

**Title:** Taste Brain: agents that decide with taste and prove why

**Tagline:** Rules from the business, taste from Qloo, a trace for every decision.

**Demo:** `<your hosted URL>` · **Source repo:** `<your repo URL>` — put both at the very top of the
Devpost field, then this text.

The demo host runs **live**: a click makes real reads against
`https://hackathon.api.qloo.com` (`QLOO_ENABLED=true`, `DEFAULT_MODE=live`, `QLOO_FORCE_LIVE=true`, so
nothing is served from the stored answer), and every result carries a Live / Cached / Sample badge.
A fresh clone runs credential-free in Replay, because the committed defaults are
`QLOO_ENABLED=false` / `DEFAULT_MODE=replay`.

**Taste Lift status, stated plainly.** The panel is built to run the same fixed request set through
the grounded agent (Arm B) and a plain rules-only LLM (Arm A), arm for arm. **On the submitted build
Arm A did not run — there is no LLM key on the host.** Arm B's grounding, rule-compliance and
specificity are published from real live runs; no lift number is claimed in either direction. With a
key, the same button produces the comparison.

**Problem statement.** Organizations that serve many audiences choose what to offer using spreadsheets and instinct. Local taste is invisible, rules are scattered across SOPs and people's heads, and AI suggestions cannot be audited.

**What it does.** Taste Brain lets agents propose what to offer at each location. They resolve the location's audience through Qloo, take the candidates in the order Qloo returned them, check each against the organization's own rules, and show a full Decision Trace. A Grounding Auditor blocks anything that cannot be traced to Qloo or a rule. A Taste Lift panel runs the same fixed request set through the grounded agent, and through a plain LLM when an LLM key is present on the host (see **Taste Lift status** above — it was not, on the submitted build). One engine adapts to retail, restaurants and venues through config-only Vertical Packs.

**How it uses Qloo (workflows and why).**
- `describe_audience` — builds each location's audience taste portrait from entity seeds via `/v2/tags` and `/v2/insights` (`server/src/agents/pipeline.ts`).
- `recommend` — returns candidate entities via `/v2/insights`. That endpoint carries no score field, so the ranking is Qloo's own result order (`qloo_rank`), never a number and never the LLM; the fit figure the UI shows is derived from that rank by this app (`server/src/qloo/adapter.ts`, `pipeline.ts`).
- `find_tags` / `rank_shortlist` — style→tag resolution via `/v2/tags` and ranking a company-approved shortlist (adapter surface).
- Transport: Direct REST client (`server/src/qloo/rest-client.ts`) with `X-Api-Key`, 250ms rate throttle queue, exponential backoff on 429/5xx, and in-flight deduplication. Live/Cached/Replay modes with a badge on every result.
Redacted request→result: see the README walkthrough — a Replay run of the committed sample retail pack, where the fixture brand Riverstone Co. (Qloo rank 1) fails `budget_cap` and two more are vetoed by the Auditor.

**Vertical packs.** Retail (the deep pack: three stores, 11–18 catalog rows each), restaurants, venues — config only (`server/src/packs/data/*.json`). The live decision gate was measured on venues: 20 distinct artists per city in Chicago, Austin and Nashville, all above the 10-entity bar, with popularity banding and explainability present (`server/verification/gate-report.json`).

**What we built.** Direct Qloo REST client, vertical packs, taste-driven agents, the Grounding Auditor, Decision Trace, Taste Lift evaluation, offline Replay fixtures, cache warmer, and interactive React UI.

**Setup from a clean environment.** `cd server && npm i && cp .env.example .env && npm run dev`, `cd client && npm i && npm run dev`, open `http://localhost:3000`, pick Store 1 and run the agent. Runs offline in Replay mode with no credential — the committed default is `QLOO_ENABLED=false` so a clone cannot spend the key. The hosted demo switches live on deliberately, with `QLOO_FORCE_LIVE=true`. For Live: `QLOO_API_KEY` in `server/.env`, `QLOO_ENABLED=true`/`DEFAULT_MODE=live`, and the gitignored identity overlay in `server/.private-data/` that maps the fictional seeds to the real entities.

**Try it.** [demo URL] · [repo URL] · MIT license · 60-second path in the README.

**Known limitations.** Qloo gives aggregate affinities, not facts about individuals. Sample data is invented and labelled, and every screen states its mode; no committed file names a real company, artist or venue or carries a Qloo entity id. Taste Lift publishes only Arm B when no LLM key is set — no lift figure is fabricated. The decision ledger is hash-chained and **tamper-evident, not tamper-proof**: recomputing it proves no entry was edited afterwards, and the Verify screen re-derives the chosen acts, ranks, names and rule verdicts from hash-protected records, but it cannot prove the file is the only version of itself — that needs a key only the host holds (`LEDGER_HMAC_SECRET`) or a head hash published somewhere the writer doesn't control. It also never proves Qloo's own data is correct, nor that a name is Qloo's wording rather than this app's label for a Qloo entity id. Results are decision support, not guarantees of business outcomes, and not medical/financial/legal advice.

## Kit checklist (SUBMISSION.md)
- [x] Short problem statement
- [x] Qloo workflow/MCP tools used and why
- [x] Redacted request→result explanation incl. entity and tag choices
- [x] Demo/screenshots with no credential or personal data
- [x] Clean-environment setup steps
- [x] Known limitations, incl. what the result does not establish

## Before submitting (Open Questions)
- [ ] Ask organizers on Discord: is a public demo on your credential OK, and what is the quota/rate limit?
- [ ] Confirm real harness workflow names/inputs with `qloo --help`.
- [ ] Confirm Qloo returns rich brand results (else switch the deep pack to Venues).
- [ ] Re-read the Official Rules on the Rules tab and confirm eligibility and the Representative.
