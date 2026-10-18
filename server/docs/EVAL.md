# Graph-first vs plain RAG — measured on 20 golden questions

Date: 2026-10-18T03:51:57.810Z · Runs per question: 3 (median) · LLM: none (cited-context fallback) · Commit: uncommitted

Same chunks, same model, same temperature (0). Baseline = top-5 similar chunks only. Neutronz = graph-first pipeline (entity linking → seeds → multi-hop expansion → currency filter).

| Metric | Plain RAG | Graph-first (Neutronz) |
|---|---|---|
| Entity recall | 55% | **70%** |
| Source recall | 65% | **90%** |
| Citation validity | 100% | **100%** |
| Currency (no superseded sources) | 95% | **100%** |

## By category

| Category | n | RAG entity | Graph entity | RAG source | Graph source | RAG currency | Graph currency |
|---|---|---|---|---|---|---|---|
| ownership | 5 | 80% | 100% | 80% | 100% | 100% | 100% |
| impact | 5 | 60% | 80% | 60% | 60% | 100% | 100% |
| temporal | 5 | 40% | 60% | 20% | 100% | 80% | 100% |
| provenance | 5 | 40% | 40% | 100% | 100% | 100% | 100% |

## Policy Time Machine check

Credit threshold 10,000 → 5,000 USD replayed over 30 stored bookings: **5 verdicts change**, replay fidelity 100%.

Reproduce: `cd server && npm run eval` (requires FalkorDB from `docker compose up -d`).
