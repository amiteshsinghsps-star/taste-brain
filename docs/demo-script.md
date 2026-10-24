# Demo script (3 minutes) and judge path

Every figure below was read off this build in **Replay** mode on the machine that
records the demo — not from memory. Names are the synthetic pack fixtures; the
mode badge on screen says `REPLAY`, and it must stay visible in the shot.

## Live walk-through

1. **Retail → Store 3 - East Austin, TX → "Add 4 brands for spring"** → **Run the agent**.
2. Show the ranked list. Point at a brand's rule chips (all green) and at its
   derived fit — the page states the fit is computed from Qloo's returned rank,
   not a number Qloo returns. Qloo's own figures (popularity, followers) sit next to it.
3. Point at the **red rejection**: *Riverstone Co.* — Qloo's **rank 1** for this
   audience, popularity 0.490 — filtered by `budget_cap` (unit_cost 46 > the
   ceiling 40). This is the whole thesis: taste and policy, together.
4. Point at the amber **unsupported** item: *Unknown Indie Label* — Qloo ranks it
   for this audience, but there is no approved offer or entered term to rule-check,
   so it is surfaced, not approved.
5. Open **Trace** — walk one path: SOP rule → Qloo evidence → offer → proposal,
   each with a **mode badge**. Export JSON.
6. Open **Why not?** for the refusal in the engine's own words, then **What if?** —
   raise the unit-cost ceiling and watch *Riverstone Co.* become admissible at 46
   and still fail at 45. One threshold, one measurable flip, no re-ranking.
7. Open **Brief** → **Write the brief** → the one-page owner summary generated from
   the run: the ask, the mode, what was approved, what the rules refused, what
   terms are still missing. Download the `.txt`.
8. Open **Taste Lift** → **Run the fixed request set** → show grounded (Arm B)
   numbers; note the honest "Arm A did not run without an LLM key" line.
9. Open **Coverage** — the Qloo capability board: which endpoints and parameters
   were probed, what the decision gate measured, and the field notes on method.
   Per-call provenance (workflow, entity/tag choice, cache hit, mode) is on the
   **Trace** and **Evidence** screens, not on a separate call log.
10. Switch to **Venues** → run `venue_redroom` → *DJ Marlow* is shown (Qloo rank 1);
    *Vex* is refused on `guarantee_ceiling` (9,500 > the ceiling 8,000) and
    *Paper Lanterns* on `no_repeat` because the operator put it in the window.
    Same engine, new pack.
11. **Approve** the retail proposal → status flips to approved and a Decision is
    recorded in the ledger.

## Prove it on screen (the two screens judges ask about)

- **Verify** (W1) — press **Verify this run**. Five recomputations from the
  exported evidence only: the hash chain, every shown entity id present in stored
  results, order is Qloo's returned order, each rule verdict re-evaluates under the
  pinned rule set, and the mode badge matches the steps. The page prints what the
  report does *not* prove and the CLI command that reproduces it.
- **Break it** (W6) — press **Run all six**. Unsupported item, entity-name
  injection, policy-text injection, ledger tampering, budget breach and an
  unverified parameter, each against the real defence. The panel states the
  sandbox honestly: nothing written to the ledger, the stored chain still verifies,
  and the network-call delta is zero.

## If you run it Live

Install the harness (`npm i -g @qloo/qloo-harness`, Node 22.19.0+), `qloo setup --qloo`
with your own credential, set `QLOO_ENABLED=true` and `DEFAULT_MODE=live` in
`server/.env`, restart, then click **Run Live (harness)**. Results re-badge from
Replay → Live. Confirm the real workflow names/inputs against `qloo --help` on your
machine before demoing. Live reads spend the shared quota — 12 Qloo calls per run,
400 per day — so rehearse in Replay and switch only for the take you keep.

## Judge path (read-only)

- This top of README is the 60-second try-it.
- Gallery screenshots to capture: the ranked retail proposal with the Riverstone
  rejection, the trace timeline with mode badges, the Verify report's five checks,
  the Break-it scoreboard at 6 of 6, the Taste Lift table, the Coverage board and
  the Venues pack switch. No credential or personal data in any asset.
- Seventeen screens: Plan, Evidence, Trace, Brief, Why not?, What if?, Partners,
  Ablation, Trust, Verify, Break it, Coverage, Ledger, Budget, Finals, Taste Lift, About.

## Optional 2-minute video

Problem (15s) → live flow: pick, rank, trace (50s) → proof: Verify + Break-it +
auditor rejection (40s) → platform: pack switch (10s) → close with URL + limits (5s).
