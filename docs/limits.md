# Limits and responsible use

## What the result does and does not establish

- Qloo returns **aggregate audience-level affinities**. Nothing here is evidence about a specific person's identity, preferences or future behavior.
- Recommendations are **decision support for a human approver**, not guarantees of revenue, savings or any business outcome. No business results are claimed or measured.
- This build ships in **Replay mode with synthetic sample fixtures**. They are labelled `mode:"replay"` everywhere and are never presented as live output. Live is switched off on the public host (`QLOO_ENABLED=false`) so a visitor cannot spend the team key; the key custodian turns it on for a planned take and turns it off again.
- No committed file names a real company, artist, venue or dish, and none carries a Qloo entity id. Real identities exist only in the gitignored pack overlay on the custodian's machine and in the gitignored `.private-cache/`, so a named entity in this repository is always an invented one.
- The senior-care / care scenario is out of the shipped demo; the engine is not medical, financial or legal advice.

## Honesty rules we hold to (PRD principles)

1. A Qloo result or a Rule behind every displayed recommendation, or it is labelled unsupported.
2. The LLM writes explanations only; it never decides the ranking.
3. A person approves; the system never acts on its own.
4. Every result shows where it came from (Live, Cached, Replay).
5. Audience-level language only; never claims about an individual.

## Security and privacy

- The Qloo credential is used **server-side only** via the harness. It is never in the repo, browser code, the call log, screenshots or recordings.
- All sample data is fictional. No personal data is collected or sent to Qloo; only entity/tag ids and a location signal are.
- Prompt-injection hygiene: SOP text and user text are treated as data, and the Auditor does not trust LLM output.
- Public-demo controls: per-IP rate limit, payload cap, caching, and Cached/Replay modes to conserve quota. Ask the organizers on Discord whether a public demo on your credential is acceptable and what the quota/rate limit is.
