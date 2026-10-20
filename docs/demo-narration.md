# Demo narration (spoken script)

This is the *voiceover* for the recording, mapped one-to-one to the scenes in
[`demo-script.md`](demo-script.md). It is written to be read aloud, plain and
unhyped. Every number below is measured and re-runnable (see the Claims audit at
the bottom of `demo-script.md`). If a live run shows a different graph total,
**say the number on screen**, not the one printed here.

Two hard rules while recording:

1. **No LLM key is set in this demo.** Say so out loud. The answers you see are
   *graph facts with citations* from the no-LLM fallback, not prose a model
   invented. That is the honest claim and it is the more impressive one.
2. **It is synthetic demo data.** The company (Northwind Logistics), people,
   bookings, watchlist and invoices are seeded, not real, and not a sanctions
   feed. Say it once, early.

Run `docker compose up -d --build` first, keep the **FalkorDB Browser** (`:3001`)
in a second window, and have `http://localhost:5000` open. Do not fake anything —
if a step errors, stop and re-record it; don't paper over it in the voiceover.

---

## Cold open — the graph is load-bearing (~35 s)

> Everything you're about to see runs on a FalkorDB knowledge graph. So let me
> start by proving it isn't decoration. *(Terminal: `cd server && npm run
> test:removal`.)* This runs the whole product with the graph switched **off** on
> a dead port. Ask-the-brain, the graph explorer, even the demo seed — they all
> come back **503 GRAPH_UNAVAILABLE**. There is no keyword-search or SQL fallback
> quietly faking an answer. *(point at `no silent fallback answer`)* And the
> moment the graph is back, the *same binary* answers again with a full trace.
> That failure is by design.

*(9/9 checks. If you skip this scene, cut straight to "I built the graph into the
product" — but it's the strongest honesty beat, keep it if time allows.)*

## Scene 1 — load a company (~40 s)

> This is a fresh sign-up. *(type email, password, click **Sign up**.)* No
> credentials are baked into the page — you make your own. Now **Load demo
> company**. This builds a **synthetic** freight-forwarding company called
> Northwind — people, teams, SOPs, policies, bookings, a demo watchlist — all
> labelled demo data, none of it real. *(Switch to FalkorDB Browser, run the
> count query.)* Look: this is not a table, it's a **graph** — over a hundred
> nodes and edges in *my tenant's own graph*. Each account gets its own isolated
> graph, and the graph name comes from the login token, never from anything I
> type. *(Open `/api/status` in a tab:)* and the status endpoint pulls live node
> and edge counts straight from `db.meta.stats()` — nothing cached.

## Scene 2 — ask the brain, read the trace (~55 s)

> Ask the brain: *"Which systems and agents does the credit approval policy
> govern?"* *(submit.)* Notice there's **no API key** in this build — so what you
> get isn't a model's guess. It's **cited graph facts** with a **Decision Trace**.
> *(click **Why?**.)* Expand it: each hop is a real graph edge — *Rule →
> implements → Policy*, *Person → owns → Policy*, *Policy → governs → System* —
> and every citation points at a source snippet. That's the whole thesis: the
> answer traces back through a path to the SOP, the decision, and the person.
>
> Now the honest negative. *(Tools → `find_owner` → entity "Quantum Widget
> Policy", a policy that doesn't exist.)* It doesn't hand me an empty list that
> looks like a bug. It says **"0 OWNS edges exist — the graph does not record
> this relationship."** An absence is reported as an absence. That's an
> *absence proof*, and it's the same as the tool path the agents use.

## Scene 3 — an agent acts on connected data (~55 s)

> Create a **Freight** agent, Copilot mode. Run a booking whose shipper is
> **Denied Trading LLC** — that name is on the seeded demo watchlist. *(run.)*
> The engine returns **FLAGGED**. Crucially: **the LLM never decides pass or
> fail.** A pure, deterministic rule engine does, so the same input always gives
> the same verdict — that's tested. And even though the right answer is "don't
> ship," Copilot still **stages** it for a human instead of silently acting.
> *(Open Task Approvals.)* The approval card has three columns: the engine's
> verdict with each rule's **numeric margin**, **precedents pulled out of the
> graph** — "REJECTED by Raj Mehta, FLAGGED by Tom Okafor, FROZEN by Maya Rao" —
> and the trace. Precedent isn't a guess; it names the human who decided before.
> Approve it, and *(terminal `GET /api/ledger/verify`)* the **hash-chained
> ledger** grows and still verifies.

## Scene 4 — HERO: Policy Time Machine (~70 s)

> This is the part I'm proudest of. Executable Skills — the credit rule, auto
> approve under **10,000**. Let me see what happens if I drop it to **5,000** —
> but **without touching production**. *(Simulate.)* It replays the change over
> the **31 stored booking verdicts**: **5 would flip**, and **replay fidelity is
> 100%** — meaning the *current* rule reproduces every historical verdict, which
> is exactly what makes the counterfactual trustworthy. Below that, the graph
> impact: which rules, owners, agents and customers move.
>
> First I hit **Discard** — *(rules unchanged, `maxCreditLimit` still 10,000)* —
> discard mutates **nothing**. Now **Apply**: it doesn't overwrite history, it
> **versions** the rule — a new `..._v2`, the old one stays `SUPERSEDED`, and one
> ledger entry appends. Nothing is destroyed. *(Back to why-not:)* and "why
> wasn't BK-1043 flagged?" answers with the **margin** — amount 10,000, threshold
> 10,000, **margin 0** — the nearest miss, right before it would change.

## Scene 5 — the graph tells you where it's rotting (~35 s)

> Freshness and health. **Knowledge Health** scores the graph — **67 out of a
> hundred** here, with six findings: an orphaned policy, a stale rule,
> bus-factor-one systems, a doc never re-refreshed. *(Needs Review:)* the stale
> rule *Legacy 4-digit HS Manifest Rule* — click **Impact** and it walks the
> graph to show every dependent policy, owner and prior decision. **Mark
> reviewed** and the queue drops. This is what "context" maintenance actually
> looks like — the graph tells you where it's out of date.

## Scene 6 — agent memory, scoped per tenant (~30 s)

> Agent Memory. I'll write an episode — "screened booking X, staged for a human,
> nothing shipped" — and it lands as an **Episode node inside *this tenant's*
> graph**. *(recall by keyword — it comes back.)* Now the isolation proof from
> the test suite: the **same query from a second tenant returns zero memories.**
> Memory here isn't a shared vector store every agent reads — it's typed and
> scoped, agent-private or tenant-shared, and it lives in the same graph.

## Scene 7 — the graph answers what a vector store can't (~50 s)

> Now the things an embedding index structurally cannot answer. **Graph
> Insights** — "how is *Maya Rao* connected to *Operations*?" — one hop, and it
> shows me the actual chain: person → member-of → team. Ask about two things that
> *aren't* linked and it doesn't hand me an empty list either: it says no path
> within five hops **in either direction**, and gives each endpoint's edge count,
> because there are some. One caveat I'll say plainly: FalkorDB's `shortestPath`
> is **directed**, so this is the real shape of the data, not a symmetric lookup.
>
> Version history: after that Apply, the credit rule has **three versions**, and
> this panel diffs the parameters for me — `maxCreditLimit 5000 → 10,000`, then
> `10,000 → 5,000` — each new one tied to the simulation that produced it.
> Nothing was deleted to make the change. *(If time is short, cut the versions,
> timeline and handoff board here and keep the next two.)*
>
> And this is the loop I like: I give Scene 2's answer a **thumbs down**. That
> rating isn't a counter in a table — it's a **`Feedback` node linked `ABOUT` the
> exact chunk the answer cited**. Refresh **Knowledge Health**: **67 dropped to
> 63**, with one finding naming that chunk. Thumbs it back up and the finding
> disappears. Humans curating the sources, in the graph.
>
> Last one, because it's a *write* that changes what the engine does: I add
> "Globex Restricted" to my own screening list, and it previews which stored
> bookings would match before I save it. Save → run that shipper through the
> Freight Desk → **FLAGGED**. Delete my entry → **PASSED** again. The seeded demo
> entries refuse deletion — I can't break the demo company's history. And every
> one of these screens is the same graph: I can export it as JSON, GraphML or CSV
> and the counts match what the explorer drew.

## Close (~25 s)

> To be clear about what's real: no LLM key, so every answer you saw was a
> **cited graph fact**, not generated prose; and it's all **synthetic demo
> data**, not a sanctions feed. And it's all re-runnable. *(Terminal: `npm run
> e2e:v3` → 42 passed, `npm run test:ci` → 35 passed, 0 failed, 0 skipped.)* The
> graph tests **refuse to skip** when FalkorDB is down, so a green run means the
> graph really served every one. That's Neutronz — a company brain where every
> answer traces back to the SOP, the decision, and the person behind it.

---

## Timings

- **Full:** Scenes cold-open→7→close ≈ **6–7 min**. If you must land ~3–4 min,
  keep Cold open (compress to 15 s), Scene 2 (trace + absence), **Scene 4 (Time
  Machine — the hero, never cut)**, two beats of Scene 7 (connection path + the
  👎→Knowledge-Health loop, and the watchlist flip if there is room), and the Close
  with the two test runs. Drop or merge Scenes 1/3/5/6 into quick cuts.
- Keep the Browser UI on screen for Scenes 1 and 4; keep the terminal in shot for
  the removal test (cold open) and the final test runs (close).
- If you cut the rest of Scene 7, the version-diff, timeline, handoff board,
  node-explain and digest are still **built, endpoint-tested and asserted in
  `server/tests/insights-v4.test.ts`** — say "in the repo, not in this video"
  rather than implying you showed them.

## Say-it-out-loud honesty list (check off in the recording)

- [ ] "No API key — these are cited graph facts, not LLM prose."
- [ ] "Synthetic demo company, not real data, not a sanctions feed."
- [ ] "The LLM never decides pass/fail — a deterministic rule engine does."
- [ ] "Stopping the graph makes it fail loudly — 503, no silent fallback."
- [ ] "Apply versions the rule; it never deletes history."
- [ ] "Each account gets its own isolated graph; a second tenant recalls zero."
- [ ] "The path finder is directed-only (`shortestPath` in FalkorDB), and the UI
  says which direction it found."
- [ ] "A 👍/👎 is a `Feedback` node about the cited chunk, not a counter table."
- [ ] "My own screening entry changes the next verdict; seeded demo entries
  refuse deletion."
- [ ] Commit history is **consolidated from a working copy on Oct 18** — do not
  narrate the commit list as if it were a build timeline.

## Do NOT say (would overclaim)

- Not "zero hallucinations" — we say *reduced*, synthesis can still misphrase.
- Not "immutable ledger" / "blockchain" / "SOC 2" / "AES-256" — the ledger is
  **tamper-evident**, not immutable; no compliance certification is claimed.
- Not "real-time Gmail/Slack sync" — live connectors are **off by default** behind
  a flag; the graph holds only synthetic seed + your uploads.
- Not "graph algorithms like PageRank" — there are none; centrality is degree
  counting in Cypher, paths use `shortestPath()`.
- Not "any-direction connectivity" — `shortestPath` here is directed; the digest
  counts are per-kind caps, not a full history scan.
- Not "the UI was click-tested by a human" — the panels are endpoint-verified over
  HTTP and the production build is clean; nobody clicked them in a browser before
  recording. Say what you are *doing* on screen, not what was tested.

## Caption / SRT note

Burn subtitles with `ffmpeg -vf subtitles=narration.srt`. Keep the measured
on-screen numbers (133 nodes / 150 edges freshly seeded, 31 verdicts / 5 change /
100% fidelity, 67 → 63 health on a thumbs-down, 42 e2e / 35 unit checks) in sync
with whatever the live run actually prints — if the graph total moved because you
seeded more tenants, narrate the on-screen number.
