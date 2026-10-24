# Demo script (3 minutes) and judge path

## Live walk-through

1. **Retail → Store 3 - East Austin → "Add 4 brands for spring"** → **Run the agent**.
2. Show the ranked list. Point at a brand's rule chips (all green) and its Qloo fit score.
3. Point at the **red rejection**: *Riverstone Co.* — the **highest Qloo affinity (0.91)** — filtered by `budget_cap` (unit_cost 46 > 40). This is the whole thesis: taste and policy, together.
4. Point at the amber **unsupported** item: *Unknown Indie Label* — strong Qloo signal, but no buying-policy offer, so it is surfaced, not approved.
5. Open **Trace** — walk one path: SOP rule → Qloo evidence → offer → proposal, each with a **mode badge**. Export JSON.
6. Open **Taste Lift** → **Run the fixed request set** → show grounded (Arm B) numbers; note the honest "Arm A did not run without an LLM key" line.
7. Open **Qloo log** — workflows, entity/tag choices, cache hits, mode.
8. Switch to **Venues** → run `venue_redroom` → show *Vex* (top fit) rejected on `booking_budget` and *The Hollow Set* on `capacity`. Same engine, new pack.
9. **Approve** the retail proposal → status flips to approved and a Decision is recorded.

## If you run it Live

Install the harness (`npm i -g @qloo/qloo-harness`, Node 22.19.0+), `qloo setup --qloo` with your own credential, set `QLOO_ENABLED=true` and `DEFAULT_MODE=live` in `server/.env`, restart, then click **Run Live (harness)**. Results re-badge from Replay → Live. Confirm the real workflow names/inputs against `qloo --help` on your machine before demoing.

## Judge path (read-only)

- This top of README is the 60-second try-it.
- Gallery screenshots to capture: ranked proposal with the Riverstone rejection, the trace timeline with mode badges, the Taste Lift table, the Qloo call log, and the Venues pack switch. No credential or personal data in any asset.

## Optional 2-minute video

Problem (15s) → live flow: pick, rank, trace (60s) → proof: Taste Lift + auditor rejection (30s) → platform: pack switch (10s) → close with URL + limits (5s).
