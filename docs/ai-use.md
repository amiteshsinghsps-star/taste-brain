# AI use disclosure

Everything a judge needs to know about how this repo was built, so that "AI
assisted" is a stated fact rather than an inference.

## Tools used

| Stage | Tool | What it did | Human decision it did not make |
| :--- | :--- | :--- | :--- |
| Design | Claude (Anthropic) via the Qoder CLI | Drafted the graph schema, chose retrieval strategy, proposed the test plan | Which tracks to enter, which claims to drop from the README |
| Implementation | Qoder CLI agent (Claude) + manual edits | Wrote/refactored most of `server/src/services/brain/`, `client/src/pages/`, Cypher helpers, tests, docs, Docker/CI files | Whether a feature ships: each was verified against a running FalkorDB before being called "working" |
| Verification | `vitest`, the committed eval harness, `curl` against the live API | Measured every number quoted in this repo | Deciding that a low number (entity recall 70%, health 67/100) stays published instead of being tuned away |
| Diagrams / copy | AI-drafted, human-edited | README structure, this document | — |

## What AI did **not** do

- It did not decide any agent verdict. Screening/approval/rejection comes from the
  pure rule engine (`server/src/services/brain/rule-engine.service.ts`); the LLM
  only extracts candidates and drafts prose.
- It did not choose the demo data. Northwind Logistics is synthetic and seeded by
  `server/src/seed/*.ts`, labelled `demoSeed` in the graph.
- It did not write the eval scores. `npm run eval` computes them from
  `server/src/eval/golden.json` with deterministic string/chunk-id matching and
  the results are committed (`server/docs/EVAL.md`, `server/src/eval/results.json`).

## Known AI failure modes we hit and fixed

1. **Fabricated green.** The graph test suites used `describe.skipIf(!falkorUp)`
   with an async reachability check that resolved *after* collection, so CI
   reported "all passed" while running none of them. Fixed by resolving the flag
   at top level and adding `FALKORDB_REQUIRED=1` plus
   `scripts/check-no-skips.mjs`, which fails the build on any skipped test.
2. **Tampered lockfiles.** Brand-renaming done as a project-wide find/replace
   spliced text into base64 SRI digests in `client/package-lock.json`, so a clean
   clone failed with `EINTEGRITY`. Fixed by restoring the real digests from the
   npm registry and adding `scripts/check-lockfile.mjs` (digest length + base64 +
   embedded-word checks) to CI so it cannot come back.
3. **Overstated claims.** Early drafts said "immutable audit ledger", "100%
   accuracy", "SOC 2 style controls" and referenced graph algorithm procedures
   (`algo.pageRank`, `algo.wcc`) that the code never calls. All removed; each
   remaining claim points at a test, an endpoint or a script in
   [demo-script.md](demo-script.md).
4. **Wrong mechanism, right answer.** Retrieval scored well while actually
   degrading to Postgres text matching when the graph handle was missing. Now a
   missing graph raises `GRAPH_UNAVAILABLE` (verified by `npm run test:removal`).

## Statement

This project was built with an AI coding agent under human direction, and the
agent's output was verified by running it: tests, the eval harness, the black-box
e2e script and the removal test are all committed and re-runnable. Any claim in
this repository that is not backed by one of those, or by code a reviewer can
open, is a mistake — please report it.
