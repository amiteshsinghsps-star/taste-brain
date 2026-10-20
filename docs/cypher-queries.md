# Cypher queries

Every distinct Cypher statement in `server/src/`, grouped by subsystem. Query
text is copied verbatim from source, including `$params` placeholders and the
`${...}` template holes that the code itself interpolates. Call sites are
`path/to/file.ts:functionName` with real line numbers.

Count: **144 numbered entries across 26 groups** (A–U, plus the Track 04 groups
Z, AA, AB, AC, AD; group P contains no Cypher, and entry L6 quotes a statement
the code no longer runs). Three entries (M3, S3, T7) are byte-identical
duplicates of an earlier entry, so 140 live distinct query texts. Counts are
reproducible with `grep -c '^### [A-Z][A-Z0-9]* —' docs/cypher-queries.md`.

Groups Z–AD are appended after the analysis sections V–Y rather than slotted in
alphabetically, so every cross-reference to V/W/X/Y written earlier in this file
and in the tests keeps pointing at the same letter.

Conventions used below:

- "Why Cypher and not SQL" is answered per statement; where a whole group
  shares one reason it is stated at the group head and individual entries say
  "as above".
- All statements are executed through `runQuery(graph, cypher, params)`
  (`server/src/graph/graph.queries.ts:13-20`), which forwards params to
  `graph.query(cypher, { params })`. Two exceptions: group T (tests) calls
  `graph.query(...)` directly, and `status.service.ts:46` calls
  `client.selectGraph(graphName).query(STATS_QUERY)` with no params argument.

---

## A. Parameterised helper library — `server/src/graph/graph.queries.ts`

These four writers are the only generic mutation paths in the codebase. Labels
and relationship types are interpolated by the template holes shown, and are the
responsibility of the caller to have validated against
`NODE_LABELS` / `RELATIONSHIP_TYPES` (`server/src/graph/graph.schema.ts:9-37,43-72`).

### A1 — idempotent node upsert (`graph.queries.ts:48`, `mergeNode`)

```cypher
MERGE (n:${label} {id: $id}) SET ${setClause || 'n.id = $id'} RETURN n
```

`setClause` is built at line 42 as `n.<k> = $set_<k>` joined by `, `, where each
key is sanitised with `k.replace(/[^a-zA-Z0-9_]/g, '_')` (line 40) and every
value is a bound parameter (`params['set_' + key]`, lines 43-45).
Why: `MERGE` on a stable `id` gives idempotent writes inside one tenant graph;
SQL would need a per-label table and `ON CONFLICT`, which is exactly the
`Entity` table this design replaced.

### A2 — idempotent edge upsert (`graph.queries.ts:76`, `mergeRelation`)

```cypher
MATCH (a:${fromLabel} {id: $fromId}), (b:${toLabel} {id: $toId}) MERGE (a)-[r:${relType}]->(b)${setClause}
```

`setClause` here is a space-separated series of `SET r.<k> = $set_<k>` clauses
(line 68), again with sanitised keys and bound values (lines 70-73).
Why: re-creating an edge with the same endpoints and type must not duplicate it;
`MERGE` on a relationship is the graph-native equivalent of a junction-table
unique constraint.

### A3 — vector property write (`graph.queries.ts:92`, `setVectorProp`)

```cypher
MATCH (n:${label} {id: $id}) SET n.${prop} = vecf32($v)
```

Why: FalkorDB only indexes a float array into the vector index when it is
written through `vecf32()`; the comment at lines 82-83 records that plain array
parameters are not indexed. There is no SQL analogue.

### A4 — node counts per label (`graph.queries.ts:101`, `getGraphStats`)

```cypher
MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY c DESC
```

### A5 — edge counts per type (`graph.queries.ts:102`, `getGraphStats`)

```cypher
MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS c ORDER BY c DESC
```

A4/A5 together back `GET /api/brain/graph`'s `stats` field
(`server/src/controllers/graph.controller.ts:31`). Note `labels(n)[0]` counts a
multi-labelled node once, under its first label only.
Why: the aggregation is over a schema-free label/type space; SQL would require
one `GROUP BY` per table plus `UNION`.

### A6 — wipe tenant graph contents (`graph.queries.ts:116`, `clearTenantGraph`)

```cypher
MATCH (n) DETACH DELETE n
```

`DETACH DELETE` removes nodes together with all incident edges. Not called from
any route handler; graph deletion is done at the graph level via
`deleteTenantGraph()` (`server/src/graph/graph.client.ts:105-113`).

### A7 — entity linking: name/alias phrase match (`graph.queries.ts:168-173`, `findEntityNodesByName`)

```cypher
MATCH (n) WHERE (${predicates})
 WITH n, ${HAY_EXPR('coalesce(n.name, n.title, n.ruleName, n.policyName)')} AS hay
 WHERE ${conditions.join(' OR ')}
 RETURN n.id AS id, labels(n)[0] AS label,
        coalesce(n.name, n.title, n.ruleName, n.policyName, n.id) AS name
 LIMIT 25
```

Generated pieces: `predicates` = `n:<Label>` joined by ` OR ` (line 158) from a
caller-supplied label list; `HAY_EXPR` (lines 150-151) expands to a nest of
`toLower(replace(replace(...)))` that flattens `- _ . , ( ) / : '` into spaces;
`conditions` is one `hay CONTAINS $p<i> OR toLower(coalesce(n.searchKey, '')) CONTAINS $p<i>`
per candidate phrase (lines 162-165), with the phrases bound as `$p0…$pN`
(line 163). Phrases come from `entityPhrases()` (lines 131-143), which builds
1..3-word n-grams from the question after stopword removal
(`LINK_STOPWORDS`, lines 119-124).
Retrieval calls it with a fixed allow-listed label set
(`server/src/services/brain/retrieval.service.ts:57`):
`['Policy','System','Project','Person','Team','Customer']`.
Why: entity linking is a scan over heterogeneous node types with a fuzzy
normalised-name predicate; in SQL this is a cross-table `LIKE` fan-out.

---

## B. Ingestion, versioning and staleness — `server/src/services/brain/graph.service.ts`

### B1 — content-hash dedupe (`graph.service.ts:51`, `TenantGraphService.ingestDocument`)

```cypher
MATCH (d:Document) WHERE d.hash = $hash RETURN d.id AS id
```

Uses the `Document(hash)` range index (`server/src/graph/graph.schema.ts:153`).
Returns early with `chunks: -1` when the identical bytes are already present
(lines 52-54) — FR-6 idempotency.

### B2 — find current version of a title (`graph.service.ts:59`, `ingestDocument`)

```cypher
MATCH (d:Document {title: $title}) WHERE d.status = 'ACTIVE' OR NOT exists(d.status) RETURN d.id AS id ORDER BY d.createdAt DESC LIMIT 1
```

`NOT exists(...)` handles nodes written before the `status` property existed.

### B3 — mark old version superseded (`graph.service.ts:97`, `ingestDocument`)

```cypher
MATCH (o:Document {id: $old}) SET o.validTo = $now, o.status = 'SUPERSEDED'
```

Paired with the `SUPERSEDES` edge written at line 94 via `mergeRelation`.

### B4 — next version number (`graph.service.ts:108`, `TenantGraphService.maxDocumentVersion`)

```cypher
MATCH (d:Document {title: $title}) RETURN max(d.version) AS v
```

### B5 — dependents become STALE (`graph.service.ts:116-117`, `TenantGraphService.flagDependentsStale`)

```cypher
MATCH (c:Chunk {documentId: $oldDocumentId})<-[:DERIVED_FROM]-(r:Rule)
 SET r.status = 'STALE', r.staleReason = 'Source document changed'
```

### B6 — policies of those rules await review (`graph.service.ts:122-123`, `flagDependentsStale`)

```cypher
MATCH (c:Chunk {documentId: $oldDocumentId})<-[:DERIVED_FROM]-(r:Rule)-[:IMPLEMENTS]->(p:Policy)
 SET p.status = 'REVIEW_PENDING'
```

B5/B6 are the reason Cypher is required: the unit of work is a two- and
three-hop traversal from a changed document to the rules and policies that cite
it. In SQL that is two joins across provenance rows whose "edges" live in three
different tables (and, for the pre-graph version, did not exist at all). The
reverse `<-[:DERIVED_FROM]-` arrow direction matters: extraction also writes
`Chunk → Rule` (see E-note).

### B7 — delete chunks of a document (`graph.service.ts:131`, `TenantGraphService.removeDocument`)

```cypher
MATCH (c:Chunk {documentId: $documentId}) DETACH DELETE c
```

### B8 — delete the document node (`graph.service.ts:132`, `removeDocument`)

```cypher
MATCH (d:Document {id: $documentId}) DETACH DELETE d
```

`removeDocument` is defined but not wired to any route
(`server/src/routes/brain.routes.ts` has no delete-document endpoint).

---

## C. Knowledge-graph explorer — `server/src/services/brain/graph.service.ts`

### C1 — variable-length expansion from a focus node (`graph.service.ts:148-151`, `TenantGraphService.getGraphData`)

```cypher
MATCH (f) WHERE f.id = $focus
 MATCH path = (f)-[*1..${depth}]-(n)
 WHERE 1 = 1 ${nodeFilter}
 RETURN DISTINCT n LIMIT 400
```

`depth` is clamped to 1..4 before interpolation
(`Math.min(Math.max(opts.depth || 2, 1), 4)`, line 143), so the hole can only
expand to `[*1..1]`…`[*1..4]`. `nodeFilter` is either empty or
`AND labels(n)[0] IN $keepLabels` (line 145), with `keepLabels` filtered through
`isNodeLabel` (line 144) and bound as a parameter (line 152). Undirected
`-[*1..]-` deliberately walks both provenance directions.
Why: bounded-depth neighbourhood traversal is the canonical graph operation and
has no bounded-SQL equivalent without recursive CTEs per edge type.

### C2 — induced subgraph edges (`graph.service.ts:157-158`, `getGraphData`)

```cypher
MATCH (a)-[r]->(b) WHERE a.id IN $nodeIds AND b.id IN $nodeIds
 RETURN a.id AS source, b.id AS target, type(r) AS relationType
```

`nodeIds` is assembled in JS from C1's rows plus the focus id (line 154).

### C3 — focus node itself (`graph.service.ts:161`, `getGraphData`)

```cypher
MATCH (f) WHERE f.id = $focus RETURN f LIMIT 1
```

Appended after C1 because C1 only returns nodes at distance ≥ 1.

### C4 — unfiltered node page (`graph.service.ts:167`, `getGraphData`)

```cypher
MATCH (n) WHERE 1 = 1 ${nodeFilter} RETURN n LIMIT 500
```

### C5 — unfiltered edge page (`graph.service.ts:170`, `getGraphData`)

```cypher
MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, type(r) AS relationType LIMIT 2000
```

C4/C5 are the whole-graph view for the explorer UI; both are over-fetching
patterns (see §Y item 3).

### C6 — single node load (`graph.service.ts:204`, `TenantGraphService.getNodeDetail`)

```cypher
MATCH (n {id: $nodeId}) RETURN n LIMIT 1
```

No label constraint — any node with that id, which is why `nodeProps` +
`inferLabel` are used downstream.

### C7 — neighbours with direction (`graph.service.ts:208-212`, `getNodeDetail`)

```cypher
MATCH (n {id: $nodeId})-[r]-(m)
 RETURN m.id AS id, labels(m)[0] AS label,
        coalesce(m.name, m.title, m.summary, m.statement, m.ruleName, m.id) AS name,
        type(r) AS relationType, (startNode(r).id = n.id) AS outgoing
 LIMIT 50
```

`startNode(r).id = n.id` computes edge direction for the UI.

### C8 — provenance chain (`graph.service.ts:218-219`, `getNodeDetail`)

```cypher
MATCH (n {id: $nodeId})-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
 RETURN c.id AS chunkId, c.text AS chunkText, d.id AS documentId, d.title AS documentTitle, d.sourceUrl AS sourceUrl LIMIT 10
```

### C9 — superseded titles (`graph.service.ts:224-225`, `getNodeDetail`)

```cypher
MATCH (d:Document {id: $nodeId})-[:SUPERSEDES*0..1]->(old:Document)
 RETURN d.title, old.title AS supersededTitle LIMIT 5
```

`*0..1` makes the hop optional-in-place so the current version still returns.

---

## D. Retrieval (Ask the Brain) — `server/src/services/brain/retrieval.service.ts`

Pipeline order is entity link (A7) → vector seed → keyword fallback → currency
filter → graph expansion → citation load → governance hops.

### D1 — vector seed, top 8 (`retrieval.service.ts:70-72`, `RetrievalService.query`)

```cypher
CALL db.idx.vector.queryNodes('Chunk', 'embedding', 8, vecf32($embedding))
 YIELD node, score
 RETURN node.id AS chunkId, node.text AS text, node.documentId AS documentId, score
```

The index name is the literal `'Chunk'`/`'embedding'` pair created at
`server/src/graph/graph.schema.ts:196`. `$embedding` is the query embedding
(`embedText`, `server/src/services/brain/embeddings.service.ts:53-56`).

### D2 — keyword fallback inside FalkorDB (`retrieval.service.ts:86-89`, `query`)

```cypher
MATCH (c:Chunk) WHERE ${orClauses || 'false'}
 MATCH (d:Document {id: c.documentId})
 WHERE d.status <> 'SUPERSEDED'
 RETURN c.id AS chunkId, c.text AS text, d.id AS documentId ITERATE 20 LIMIT 10
```

`orClauses` is generated at line 82 as `c.text CONTAINS $t0 OR … OR c.text CONTAINS $tN`,
one token-bound parameter each (line 90); `'false'` is used when there are no
tokens. `ITERATE 20 LIMIT 10` is a FalkorDB dialect clause (iterate-then-limit).
This runs when the vector query threw or returned nothing (line 80).
Note: despite the code comment "Full-text fallback INSIDE FalkorDB", this is a
`CONTAINS` scan, not a call to the `Chunk(text)` full-text index — see §V.

### D3 — keyword fallback, simpler dialect (`retrieval.service.ts:102-103`, `query`)

```cypher
MATCH (c:Chunk) WHERE c.text CONTAINS $t0 MATCH (d:Document {id: c.documentId}) WHERE d.status <> 'SUPERSEDED'
 RETURN c.id AS chunkId, c.text AS text, d.id AS documentId LIMIT 10
```

Reached only if D2 throws (catch at line 99) — comment: "simpler syntax for
older engines". Byte-identical in effect to S3.

### D4 — currency filter on seed documents (`retrieval.service.ts:119`, `query`)

```cypher
MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.status AS status
```

Superseded chunks are dropped from the seed set when any active alternative
exists (lines 122-126), and the dropped titles are appended to the answer as
temporal context (lines 257-259).

### D5 — multi-hop expansion around seed chunks (`retrieval.service.ts:138-142`, `query`)

```cypher
MATCH (c:Chunk) WHERE c.id IN $seedIds
 MATCH (c)-[:PART_OF]->(d:Document)
 OPTIONAL MATCH (c)-[:MENTIONS]->(m)
 OPTIONAL MATCH (m)-[r2:OWNS|GOVERNS|REQUIRES|VALIDATES|IMPLEMENTS|DERIVED_FROM|APPROVES]->(t)
 RETURN c, d, m, r2, t LIMIT 40
```

`$seedIds` falls back to `['__none__']` when empty (line 143) so the query never
degenerates into a full scan. The relationship-type union
`OWNS|GOVERNS|…` is a hard-coded allow-listed set, not user input. Whole nodes
(`c`, `m`, `t`) are returned rather than projections because the trace builder
needs `labels()` from the node object (lines 161, 165).
Why: three variable-shape hops from evidence to governed artefacts — the core
"graph matters" step, and the step the RAG baseline in group K omits by design.

### D6 — citation metadata (`retrieval.service.ts:174`, `query`)

```cypher
MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.sourceUrl AS sourceUrl, d.status AS status, d.validFrom AS validFrom
```

`validFrom` also feeds `freshness.newestSource` (line 281).

### D7 — ownership/governance hops for linked entities (`retrieval.service.ts:193-200`, `query`)

```cypher
MATCH (e) WHERE e.id IN $ids
 OPTIONAL MATCH (who)-[:OWNS]->(e)
 OPTIONAL MATCH (e)-[g:GOVERNS|VALIDATES|REQUIRES]->(s)
 OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(e)
 RETURN e.id AS entityId, e.name AS name, labels(e)[0] AS label,
        who.id AS ownerId, who.name AS ownerName,
        s.id AS systemId, s.name AS governedSystem, type(g) AS relation,
        r.id AS ruleId, r.ruleName AS ruleName
```

Fan-out per linked entity, returned as one flat row per combination; the trace
builder de-dups (lines 204-218). This is the query that produces the
`Person → OWNS → Policy → GOVERNS → System` and `Rule → IMPLEMENTS → Policy`
hops the Decision Trace shows.

---

## E. Extraction — `server/src/services/brain/extraction.service.ts`

### E1 — entity resolution on searchKey (`extraction.service.ts:217`, `ExtractionService.writeExtractionToGraph`)

```cypher
MATCH (n:${e.type}) WHERE n.searchKey IN [$key, $name] RETURN n.id AS id LIMIT 1
```

`${e.type}` is interpolated **after** `isNodeLabel(type)` rejected anything else
(lines 157-158 in `validateExtraction`); `$key` is `<Label>:<normalizeName(name)>`
and `$name` the bare normalised name (lines 214, 218). Resolution is tenant-local
because the query runs on `forTenant(tenantId)`'s graph.

### E2 — graph document for a SQL id (`extraction.service.ts:298`, `ExtractionService.ensureDocumentInGraph`)

```cypher
MATCH (d:Document) WHERE d.sqlId = $sqlDocId RETURN d.id AS id
```

### E3 — graph chunk for a SQL id (`extraction.service.ts:325`, `ExtractionService.ensureChunkInGraph`)

```cypher
MATCH (c:Chunk) WHERE c.sqlId = $chunkId RETURN c.id AS id
```

Note (schema coupling, not a query): E1's counterpart write emits **two**
`DERIVED_FROM` edges per rule — `Rule → Chunk` (line 277) and `Chunk → Rule`
(line 279) — which is why both B5 and F5 use the reverse arrow while C8/D5 use
the forward one.

---

## F. Freshness and impact analysis — `server/src/services/brain/freshness.service.ts`

### F1 — policy anchor (`freshness.service.ts:16`, `FreshnessService.impactOfChange`)

```cypher
MATCH (p:Policy {id: $policyId}) RETURN p LIMIT 1
```

Existence gate: returns `null` from the service if absent (line 17).

### F2 — governed/validated/required artefacts (`freshness.service.ts:21`, `impactOfChange`)

```cypher
MATCH (p:Policy {id: $policyId})-[:GOVERNS|VALIDATES|REQUIRES]->(t) RETURN t, labels(t)[0] AS label LIMIT 25
```

### F3 — rules implementing the policy (`freshness.service.ts:26-28`, `impactOfChange`)

```cypher
MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $policyId})
 RETURN r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.status AS status, r.version AS version
 LIMIT 25
```

### F4 — rules sharing the policy's source chunk (`freshness.service.ts:33-35`, `impactOfChange`)

```cypher
MATCH (p:Policy {id: $policyId})-[:DERIVED_FROM]->(c:Chunk)<-[:DERIVED_FROM]-(r:Rule)
 RETURN DISTINCT r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.status AS status, r.version AS version
 LIMIT 25
```

Alternating hop directions through one shared `Chunk` — the "changed evidence
affects all rules derived from it" query.

### F5 — agents whose tasks triggered those rules (`freshness.service.ts:40-41`, `impactOfChange`)

```cypher
MATCH (a:Agent)-[:PERFORMED]->(:Task)-[:TRIGGERED]->(r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $policyId})
 RETURN DISTINCT a.id AS id, a.name AS name, a.type AS type LIMIT 25
```

Four fixed-length hops with an anonymous intermediate node
(`(:Task)`); in SQL this is a four-way self-join chain.

### F6 — agents directly governed by the policy (`freshness.service.ts:46`, `impactOfChange`)

```cypher
MATCH (p:Policy {id: $policyId})-[:GOVERNS]->(a:Agent) RETURN a.id AS id, a.name AS name, a.type AS type LIMIT 25
```

### F7 — owners (`freshness.service.ts:51-52`, `impactOfChange`)

```cypher
MATCH (who)-[:OWNS]->(p:Policy {id: $policyId})
 RETURN who.id AS id, who.name AS name, labels(who)[0] AS type LIMIT 10
```

### F8 — recent decisions about the policy (`freshness.service.ts:57`, `impactOfChange`)

```cypher
MATCH (d:Decision)-[:ABOUT]->(p:Policy {id: $policyId}) RETURN d.id AS id, d.summary AS summary, d.outcome, d.at ORDER BY d.at DESC LIMIT 10
```

F3+F4 and F5+F6 are merged and de-duplicated in JS by `byId` (lines 61-65).

### F9 — "Needs review" queue (`freshness.service.ts:85-89`, `FreshnessService.staleQueue`)

```cypher
MATCH (r:Rule) WHERE r.status = 'STALE' OR r.status = 'REVIEW_PENDING'
 OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
 RETURN r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.version AS version, r.staleReason AS reason,
        d.id AS sourceDocumentId, d.title AS sourceDocumentTitle,
        c.id AS sourceChunkId LIMIT 50
```

`OPTIONAL MATCH` so a rule with no provenance still appears (with empty source
columns) — the same idiom J1/J2 use for negative checks.

### F10 — policies awaiting review via supersession chains (`freshness.service.ts:94-97`, `staleQueue`)

```cypher
MATCH (newDoc:Document)-[:SUPERSEDES]->(oldDoc:Document)
 MATCH (oldDoc)<-[:PART_OF]-(c:Chunk)<-[:DERIVED_FROM]-(r:Rule)-[:IMPLEMENTS]->(p:Policy)
 WHERE r.status <> 'REVIEWED'
 RETURN DISTINCT p.id AS id, p.name AS name, 'source document superseded' AS reason LIMIT 25
```

Five hops across two arrow directions: doc version → chunk → rule → policy.

### F11 — revalidate a rule (`freshness.service.ts:112`, `FreshnessService.revalidateItem`)

```cypher
MATCH (r:Rule {id: $itemId}) SET r.status = 'ACTIVE', r.version = coalesce(r.version, 1) + 1 RETURN r.id AS id
```

### F12 — revalidate a policy (`freshness.service.ts:118`, `revalidateItem`)

```cypher
MATCH (p:Policy {id: $itemId}) SET p.status = 'ACTIVE' RETURN p.id AS id
```

F11 is tried first; F12 runs only when F11 matched nothing (lines 115-121) —
two-statement type dispatch rather than a label test.

### F13 — policy history over supersession chains (`freshness.service.ts:132-134`, `FreshnessService.policyHistory`)

```cypher
MATCH (p:Policy {id: $policyId})
 OPTIONAL MATCH path = (p)-[:SUPERSEDES*0..3]->(old)
 RETURN path, p.name AS currentName LIMIT 10
```

`RETURN path` (whole variable-length path) is returned raw to the caller;
`policyHistory` returns the rows unmodified (line 137). Not called by any
current route (`server/src/routes/brain.routes.ts` exposes `/brain/stale` and
`/brain/stale/:id/revalidate`, but no policy-history endpoint).

---

## G. Hash-chained decision ledger — `server/src/services/brain/ledger.service.ts`

### G1 — head of chain (`ledger.service.ts:76`, `LedgerService.append`)

```cypher
MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.hash AS hash ORDER BY toInteger(e.seq) DESC LIMIT 1
```

`toInteger` is needed because `seq` is stored as a string
(`ledger.service.ts:96`). The append is serialised per tenant by an in-process
mutex (`withTenantLock`, lines 57-67) rather than by the graph.

### G2 — append entry and link the chain (`ledger.service.ts:91-94`, `append`)

```cypher
CREATE (e:LedgerEntry {id: $id, seq: $seq, at: $at, actor: $actor, kind: $kind, subjectId: $subjectId, traceId: $traceId, payloadHash: $payloadHash, prevHash: $prevHash, hash: $hash})
 WITH e
 OPTIONAL MATCH (prev:LedgerEntry {seq: $prevSeq})
 FOREACH (p IN CASE WHEN prev IS NULL THEN [] ELSE [p] END | CREATE (e)-[:NEXT]->(p))
 RETURN e.id AS id
```

`CREATE` (not `MERGE`) — ledger entries are append-only by construction.
The `FOREACH (x IN CASE WHEN x IS NULL THEN [] ELSE [x] END | …)` idiom is the
Cypher way to make a write conditional on an `OPTIONAL MATCH` result; it is used
in G2 and in H4.

### G3 — link subject to its entry (`ledger.service.ts:104`, `append`)

```cypher
MATCH (s {id: $subjectId}) MATCH (e:LedgerEntry {id: $entryId}) MERGE (s)-[:RECORDED_AS]->(e)
```

Label-free first match (any node type may be the subject); wrapped in a
try/catch because the subject may not exist yet (lines 100-109).

### G4 — read the whole chain for verification (`ledger.service.ts:120`, `LedgerService.verify`)

```cypher
MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.at AS at, e.actor AS actor, e.kind AS kind, e.subjectId AS subjectId, e.traceId AS traceId, e.payloadHash AS payloadHash, e.prevHash AS prevHash, e.hash AS hash ORDER BY toInteger(e.seq)
```

Verification itself is JS (`sha256` over canonical JSON, lines 44-54 and
123-139); the query only needs an ordered full read. There is no Cypher hash
function available, so this is the deliberate split.

### G5 — list newest entries (`ledger.service.ts:148`, `LedgerService.list`)

```cypher
MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.at AS at, e.actor AS actor, e.kind AS kind, e.subjectId AS subjectId, e.traceId AS traceId, e.payloadHash AS payloadHash, e.prevHash AS prevHash, e.hash AS hash ORDER BY toInteger(e.seq) DESC LIMIT $limit
```

`LIMIT $limit` — a parameterised limit, bound from the controller-capped value
(`Math.min(Number(req.query.limit || 50), 200)`,
`server/src/controllers/brain.controller.ts:328`).

---

## H. Policy Time Machine (simulation) — `server/src/services/brain/simulation.service.ts`

### H1 — bookings in the replay window (`simulation.service.ts:63-66`, `SimulationService.simulate`)

```cypher
MATCH (b:Booking) WHERE b.atMs >= $fromTs AND b.atMs <= $toTs
 OPTIONAL MATCH (b)-[:FOR]->(c:Customer)
 RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input, b.recordedVerdict AS recordedVerdict, c.name AS customer
 ORDER BY b.atMs
```

`fromTs`/`toTs` are bound as strings (line 67) and compared against the string
`atMs` property; lexicographic order of equal-length epoch-ms strings matches
numeric order, which is what `ORDER BY b.atMs` relies on. Default window is the
last 30 days (lines 58-59). The replay itself is a pure JS evaluation
(`rule-engine.service.ts:182-188`), not Cypher.

### H2 — load a simulation (`simulation.service.ts:145`, `SimulationService.apply`)

```cypher
MATCH (s:Simulation {id: $id}) RETURN s
```

### H3 — find the approver person (`simulation.service.ts:202`, `apply`)

```cypher
MATCH (p:Person) WHERE toLower(p.name) CONTAINS toLower($approver) RETURN p.id AS id LIMIT 1
```

`$approver` comes from the request body (`brain.controller.ts:248-250`,
defaulting to the caller's email) — bound, never interpolated.

### H4 — version the rule, keep history (`simulation.service.ts:178-187`, `apply`)

```cypher
MATCH (old:Rule {id: $oldId}) SET old.status = 'SUPERSEDED', old.validTo = $now
 WITH old
 MATCH (newR:Rule {id: $newId})
 MERGE (newR)-[:SUPERSEDES]->(old)
 WITH newR, old
 OPTIONAL MATCH (old)-[:IMPLEMENTS]->(p:Policy)
 FOREACH (pol IN CASE WHEN p IS NULL THEN [] ELSE [pol] END | MERGE (newR)-[:IMPLEMENTS]->(pol))
 WITH newR, old
 OPTIONAL MATCH (old)-[:DERIVED_FROM]->(c:Chunk)
 FOREACH (ch IN CASE WHEN c IS NULL THEN [] ELSE [ch] END | MERGE (newR)-[:DERIVED_FROM]->(ch))
```

One statement that supersedes the old version, creates the new
`SUPERSEDES`/`IMPLEMENTS`/`DERIVED_FROM` edges, and re-attaches provenance
fan-out. The `MERGE (newR)…` at line 180 is safe only because the new `Rule`
node was created immediately before (lines 165-175).
Why: this is a multi-edge rewrite over a version chain — the closest SQL
equivalent is a hand-written trigger that would no longer be the graph's own
shape.

### H5 — decision derived from the simulation (`simulation.service.ts:209`, `apply`)

```cypher
MATCH (d:Decision {id: $did}), (s:Simulation {id: $sid}) MERGE (d)-[:DERIVED_FROM]->(s)
```

### H6 — mark simulation applied (`simulation.service.ts:211`, `apply`)

```cypher
MATCH (s:Simulation {id: $id}) SET s.status = 'APPLIED'
```

### H7 — discard a proposed simulation (`simulation.service.ts:229`, `SimulationService.discard`)

```cypher
MATCH (s:Simulation {id: $id}) WHERE s.status = 'PROPOSED' SET s.status = 'DISCARDED' RETURN s.id AS id
```

Status-guarded write: the `WHERE` makes Discard a no-op for anything already
applied, and the returned row count is the success signal (line 232).

### H8 — simulation detail (`simulation.service.ts:239-242`, `SimulationService.get`)

```cypher
MATCH (s:Simulation {id: $id})
 OPTIONAL MATCH (s)-[:ON]->(r:Rule)
 OPTIONAL MATCH (s)-[:AFFECTS]->(b:Booking)
 RETURN s, r.id AS ruleId, r.ruleName AS ruleName, collect(DISTINCT b.id) AS affectedBookings
```

`collect(DISTINCT …)` collapses the `AFFECTS` fan-out into one row.

---

## I. Why-Not explanations — `server/src/services/brain/whynot.service.ts`

### I1 — load the booking under explanation (`whynot.service.ts:29-31`, `WhyNotService.whyNot`)

```cypher
MATCH (b:Booking) WHERE b.bookingNumber = $bn OR b.id = $bn
 OPTIONAL MATCH (b)-[:FOR]->(c:Customer)
 RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input, b.recordedVerdict AS recordedVerdict, c.name AS customer
```

`$bn` accepts either form (controller passes the raw `booking` query/body value,
`brain.controller.ts:296`). Everything after this — rules, facts, verdict,
margins — comes from the pure engine (`rule-engine.service.ts:182-188`), so the
graph supplies exactly one stored snapshot.

---

## J. Knowledge Health report — `server/src/services/brain/health.service.ts`

All four findings queries use the same negative-presence idiom:
`OPTIONAL MATCH` … `WITH …, count(x) AS n WHERE n = 0` (or `<= 1`). SQL needs an
anti-join per pair; here it is one traversal pattern.

### J1 — orphan active policies (`health.service.ts:34-37`, `HealthService.report`)

```cypher
MATCH (p:Policy {status: 'ACTIVE'})
 OPTIONAL MATCH (o:Person)-[:OWNS]->(p)
 WITH p, count(o) AS owners WHERE owners = 0
 RETURN p.id AS id, p.name AS name
```

### J2 — rules with no provenance (`health.service.ts:47-51`, `report`)

```cypher
MATCH (r:Rule)
 WHERE r.status = 'ACTIVE' OR r.status = 'STALE'
 OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)
 WITH r, count(c) AS chunks WHERE chunks = 0
 RETURN r.id AS id, r.ruleName AS name
```

### J3 — stale rules (`health.service.ts:59`, `report`)

```cypher
MATCH (r:Rule {status: 'STALE'}) RETURN r.id AS id, r.ruleName AS name
```

### J4 — bus factor ≤ 1 (`health.service.ts:67-70`, `report`)

```cypher
MATCH (s:System)
 OPTIONAL MATCH (p:Person)-[k:KNOWS_ABOUT]->(s)
 WITH s, count(p) AS people WHERE people <= 1
 RETURN s.id AS id, s.name AS name, people
```

The `KNOWS_ABOUT.weight` property is matched but unused here (`[k:]` is bound
for the J-independent expertise ranking L5).

### J5 — documents not refreshed in 90 days (`health.service.ts:80`, `report`)

```cypher
MATCH (d:Document {status: 'ACTIVE'}) WHERE d.validFrom < $cutoff RETURN d.id AS id, d.title AS name
```

`$cutoff` is an ISO-8601 string computed at line 29; comparison works because
`validFrom` is stored as ISO-8601, so lexicographic order equals chronological
order.

The snapshot write is not a raw query — it goes through `mergeNode` (A1) with
label `HealthFinding` (`health.service.ts:93-97`).

---

## K. Graph-vs-RAG evaluation baseline — `server/src/services/brain/eval.service.ts`

### K1 — baseline vector top-5, no graph expansion (`eval.service.ts:70-71`, `baselineRag`)

```cypher
CALL db.idx.vector.queryNodes('Chunk', 'embedding', 5, vecf32($embedding)) YIELD node, score
 RETURN node.id AS chunkId, node.text AS text, node.documentId AS documentId, score
```

Deliberately identical to D1 except `5` instead of `8`, and with none of the
entity-linking / expansion / currency steps — that is the control arm.

### K2 — baseline keyword fallback (`eval.service.ts:81`, `baselineRag`)

```cypher
MATCH (c:Chunk) WHERE ${clauses || 'false'} RETURN c.id AS chunkId, c.text AS text, c.documentId AS documentId LIMIT 5
```

`clauses` from line 78 (`c.text CONTAINS $t<i>` joined by ` OR `), params bound
at line 82. No `Document` join, so the baseline can cite a superseded chunk —
which is what the `currency` score dimension penalises (line 55).

### K3 — baseline document titles (`eval.service.ts:89`, `baselineRag`)

```cypher
MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.status AS status
```

Same shape as D4, without `sourceUrl`/`validFrom`.

---

## L. Tools registry (agent tools / MCP) — `server/src/services/brain/tools.service.ts`

### L1 — `find_owner` (`tools.service.ts:22-25`, `GraphToolsService.findOwner`)

```cypher
MATCH (o:Person)-[:OWNS]->(p) WHERE p.name CONTAINS $entity OR p.policyName CONTAINS $entity
 OPTIONAL MATCH (p)-[:GOVERNS]->(s)
 OPTIONAL MATCH (p)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
 RETURN o, p, collect(DISTINCT s) AS governed, collect(DISTINCT c.id) AS chunks, collect(DISTINCT d.title) AS documents LIMIT 10
```

`collect(DISTINCT …)` collapses the governed/provenance fan-out; whole nodes
`o`, `p` are returned for the trace. When L1 returns no rows, `findOwner`
follows up with U2 (`tools.service.ts:39`) and returns the count sentence as
`answer`, so the caller gets "0 OWNS edges exist" instead of an empty array.

### L2 — `get_policy_for`, primary (`tools.service.ts:47-53`, `GraphToolsService.getPolicyFor`)

```cypher
MATCH (p:Policy)-[:GOVERNS|VALIDATES|REQUIRES]->(s) WHERE s.name CONTAINS $context OR p.category = $cat
 OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(p)
 WHERE p.status = 'ACTIVE'
 RETURN p.id AS policyId, p.name AS policyName, r.id AS ruleId, r.ruleName AS ruleName, s.name AS system
 LIMIT 15
```

`$cat` is `normalizeName(context).toUpperCase()` (line 53) — the normalised,
punctuation-stripped context is also tried as a category code.

### L3 — `get_policy_for`, narrower fallback (`tools.service.ts:57-65`, `getPolicyFor`)

```cypher
MATCH (p:Policy)-[:GOVERNS]->(s) WHERE s.name CONTAINS $context
 OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(p)
 WHERE p.status = 'ACTIVE'
 RETURN p.id AS policyId, p.name AS policyName, r.id AS ruleId, r.ruleName AS ruleName, s.name AS system
 LIMIT 15
```

Runs only if L2 rejects (`.catch(...)`, lines 55-65), comment: "smaller engines:
no OR in WHERE after RETURN path with UNION-less OPTIONAL". The result also
carries the U2 absence proof when nothing matched
(`tools.service.ts:79-80`, `relationship: 'GOVERNS'`, `fromLabel: 'Policy'`).

### L4 — `impact_of_change` id resolution (`tools.service.ts:87`, `GraphToolsService.impactOfChange`)

```cypher
MATCH (r:Rule {id: $id})-[:IMPLEMENTS]->(p:Policy) RETURN p.id AS id LIMIT 1
```

Lets a caller pass a Rule id where a Policy id is expected; the heavy traversal
is then delegated to `FreshnessService.impactOfChange` (F1–F8).

### L5 — `who_knows_most`, weighted expertise with UNION (`tools.service.ts:105-116`, `GraphToolsService.whoKnowsMost`)

```cypher
MATCH (p:Person)-[k:KNOWS_ABOUT]->(x)
 WHERE toLower(x.name) CONTAINS $topic
 RETURN p.name AS person, p.id AS personId, count(x) AS evidence, sum(coalesce(k.weight, 1)) AS weight
 UNION
 MATCH (p2:Person)-[:AUTHORED|DECIDED]->(d)
 WHERE toLower(d.title) CONTAINS $topic
 RETURN p2.name AS person, p2.id AS personId, count(d) AS evidence, count(d) AS weight
 LIMIT 25
```

Two evidence sources combined by `UNION`; `sum(coalesce(k.weight, 1))` uses the
`weight` edge property seeded at `seed/northwind.seed.ts:317-319`. Rows for the
same person can still appear twice (one per branch) and are summed in JS
(lines 116-126). Note the second branch reads `d.title` for `DECIDED` targets
too, but `Decision` nodes have `summary`, not `title`
(`northwind.seed.ts:357-363`), so decision-based expertise contributes nothing
in practice.

### L6 — `shortest_path` (`tools.service.ts:147-164`, `GraphToolsService.shortestPath`)

No query text of its own: it delegates to `InsightsService.connectionPath`
(`tools.service.ts:148` → Z1/Z2 + A7), which is the directed, twice-tried form
FalkorDB actually accepts. The statement it reports in its trace is
`MATCH (a),(b) WITH a, b, shortestPath((a)-[*..5]->(b)) AS p — directed only,
both orientations tried` (`tools.service.ts:161`).

This replaced a query that **errored on every call**:

```cypher
MATCH (a), (b) WHERE a.name CONTAINS $from AND b.name CONTAINS $to
 MATCH path = shortestPath((a)-[*..5]-(b))
 RETURN path LIMIT 1
```

`shortestPath()` in the `MATCH` pattern position and with the undirected
`-[*..5]-` form are both rejected by FalkorDB, so the MCP/REST `shortest_path`
tool returned an error envelope for any pair of names. It is listed here because
the fix was measured, not guessed: the constraints are recorded in
`graph-data-model.md` §7 and asserted by
`server/tests/insights-v4.test.ts:57` ("shortest_path tool answers instead of
erroring"). FalkorDB's built-in `shortestPath()` is still what is used — not an
external algorithm library (see §W).

### L7 — `central_entities`, degree centrality (`tools.service.ts:177-184`, `GraphToolsService.centralEntities`)

```cypher
MATCH (n) WHERE (${labelList})
 OPTIONAL MATCH (n)-[r]-()
 RETURN n.id AS id, n.name AS name, labels(n)[0] AS label, count(r) AS degree
 ORDER BY degree DESC LIMIT 10
```

`labelList` is `allowed.map((l) => \`n:${l}\`).join(' OR ')` (line 175), where
`allowed = labels.filter(isNodeLabel)` and any label that is not in
`NODE_LABELS` makes the call throw before the query is built (lines 171-174;
asserted by T23 — see §X-3). The result object carries the honesty note
"Degree centrality (Cypher); FalkorDB algo library not assumed." (line 185).
Z2's degree count is the same idea applied to exactly two endpoints instead of
the whole label set.

### L8 — `recent_decisions` (`tools.service.ts:194-201`, `GraphToolsService.recentDecisions`)

```cypher
MATCH (d:Decision) WHERE toLower(d.summary) CONTAINS $entity
 OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
 OPTIONAL MATCH (d)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(doc:Document)
 RETURN d.id AS decisionId, d.summary AS summary, d.at AS at,
        who.name AS person, collect(DISTINCT doc.title) AS sourceDocuments
 ORDER BY d.at DESC LIMIT 10
```

---

## M. Deterministic rule engine reads — `server/src/services/brain/rule-engine.service.ts`

### M1 — load active rules with provenance (`rule-engine.service.ts:76-83`, `loadRulesFromGraph`)

```cypher
MATCH (r:Rule {status: 'ACTIVE'})
 OPTIONAL MATCH (r)-[:IMPLEMENTS]->(p:Policy)
 OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)
 RETURN r.id AS id, r.ruleName AS ruleName, r.actionType AS actionType,
        r.parametersJSON AS parametersJSON, r.severity AS severity,
        r.version AS version, r.status AS status, r.isExecutable AS isExecutable,
        p.id AS policyId, p.name AS policyName,
        collect(DISTINCT c.id) AS chunkIds
```

No `LIMIT`. `parametersJSON` is parsed in JS (lines 86-90). This is the single
source of rule truth for `evaluateBooking`, the Time Machine, Why-Not,
`GET /api/brain/rules` (`brain.controller.ts:280-287`) and `seed-v3`.
Why: rules, their parameters, their policy and their evidence chunks are one
traversal away in the graph; the engine would otherwise need to reassemble them
from several SQL tables and could not prove which chunk justified which rule.

### M2 — load watchlist facts (`rule-engine.service.ts:111`, `loadFactsFromGraph`)

```cypher
MATCH (w:WatchlistEntry) RETURN w.name AS name, w.list AS list
```

Facts are loaded *outside* the pure `evaluate()` function and injected as an
argument, which is what keeps replay deterministic
(`rule-engine.service.ts:108-113`, `:178-188`).

### M3 — `executeSkill` watchlist read (`skills.service.ts:177`, `SkillsService.executeSkill`)

```cypher
MATCH (w:WatchlistEntry) RETURN w.name AS name, w.list AS list
```

Identical text to M2, in the legacy SQL-backed skill path. Any graph failure is
caught and execution continues with an empty list (lines 183-185) — this is the
one read path that degrades rather than returning `GRAPH_UNAVAILABLE`.

---

## N. Agent memory — `server/src/services/memory/memory.service.ts`

### N1 — recall across memory types, scope-filtered (`memory.service.ts:107-112`, `MemoryService.recall`)

```cypher
MATCH (m) WHERE (m:Episode OR m:Fact OR m:Procedure)
   AND m.scope IN $scopes
   AND (${clauses || 'true'})
 RETURN m.id AS id, labels(m)[0] AS kind,
        coalesce(m.summary, m.statement, m.name) AS text, m.at AS at, m.confidence AS confidence
 LIMIT $limit
```

`clauses` (lines 100-103) is up to six
`(m.summary CONTAINS $t<i> OR m.statement CONTAINS $t<i>)` terms joined by
` OR `; the token params are merged into the param object at line 116.
`$scopes` is `['tenant', 'agent:<id>', …]` per `scopeFor()` (lines 24-26) and
`recall()`'s own construction (line 99). `$limit` is bound, not interpolated.
Why: one heterogeneous union over three labels with a shared scoping rule —
`coalesce` over differently-named content properties in a single pass.

### N2 — replay a conversation (`memory.service.ts:141-143`, `MemoryService.getConversation`)

```cypher
MATCH (cn:ConversationNode {id: $conversationId})-[:HAS_TURN]->(t:Turn)
 RETURN t.role AS role, t.text AS text, t.at AS at
 ORDER BY t.at LIMIT $limit
```

Session restore (FR-22): turn order is recovered from the `at` timestamp
property, not from an edge position.

### N3 — memory counts by label (`memory.service.ts:154-155`, `MemoryService.memoryStats`)

```cypher
MATCH (m) WHERE m:Episode OR m:Fact OR m:Procedure OR m:ConversationNode
 RETURN labels(m)[0] AS label, count(m) AS c
```

Writes for the same subsystem (Episode/Fact/Procedure/ConversationNode/Turn)
all go through A1/A2, not raw Cypher
(`memory.service.ts:33,41,44,48,52,64,72,75,84,91,126,127,133`).

---

## O. Agent workflows — `server/src/services/agent/agent-workflows.service.ts`

### O1 — resolve the booking's customer (`agent-workflows.service.ts:93-94`, `AgentWorkflowsService.executeFreightWorkflow`)

```cypher
MATCH (c:Customer) WHERE toLower($party) CONTAINS toLower(c.name) RETURN c.id AS id LIMIT 1
```

Note the inversion: the **parameter** is the haystack and the stored `name` is
the needle, so a `"<shipper> <consignee>"` string is tested for containing each
customer name (line 94). Result gates the `Booking → FOR → Customer` edge
(lines 96-98).

### O2 — resolve which watchlist entries matched (`agent-workflows.service.ts:120-121`, `executeFreightWorkflow`)

```cypher
MATCH (w:WatchlistEntry) WHERE toLower($shipper) CONTAINS toLower(w.name) OR toLower($consignee) CONTAINS toLower(w.name) RETURN w.id AS id
```

Same inversion as O1, mirroring the engine's own match rule
(`rule-engine.service.ts:135`). Only reached when the verdict is `FLAGGED`
(line 116); each hit becomes `Booking → FLAGGED_BY → WatchlistEntry` (line 124).

The rest of this service's graph writes use A1/A2 (Booking, Task, Decision,
`PERFORMED`/`TRIGGERED`/`HANDED_OFF_TO`/`ABOUT`), plus `LedgerService` and
`MemoryService`. It contains no other raw Cypher.

---

## P. Control plane and email desk — `server/src/services/control/*`

**No Cypher.** `ControlPlaneService` (`control-plane.service.ts`) and
`EmailDeskService` (`email-desk.service.ts`) are pure Prisma/Postgres. The only
graph involvement is indirect: `EmailDeskService.triageEmail` calls
`RetrievalService.query` (`email-desk.service.ts:26`), which runs group D; and
`access_grants` is enforced in SQL only, never as a graph filter (see
`docs/graph-data-model.md` §7.1).

---

## Q. Demo seed writers

`NorthwindSeeder.seed` (`server/src/seed/northwind.seed.ts:30-414`) and
`SeedV3.seed` (`server/src/seed/seed-v3.ts:91-243`) contain **no raw Cypher**
except one statement; everything else is `mergeNode`/`mergeRelation`/
`setVectorProp` (A1–A3) with the node/edge shapes catalogued in
`docs/graph-data-model.md` §2–§3.

### Q1 — backdate a document to plant a health finding (`seed/seed-v3.ts:227`, `SeedV3.seed`)

```cypher
MATCH (d:Document {id: 'doc_seed_decision_memo_hs_code_data_quality_initiative'}) SET d.validFrom = $old
```

The node id is a hard-coded literal (not user input); only `$old` is a parameter.
Together with the orphan policy (`seed-v3.ts:199-208`) and the STALE legacy rule
(`seed-v3.ts:210-223`) this is what makes `GET /api/brain/health` demonstrate
findings out of the box, asserted by T21 (`server/tests/graph-v3.test.ts:192-206`).

---

## R. Status / proof endpoint — `server/src/services/brain/status.service.ts`

### R1 — graph statistics procedure (`status.service.ts:18`, `statsForGraph`)

```cypher
CALL db.meta.stats() YIELD labels, relTypes RETURN labels AS labels, relTypes AS relTypes
```

Executed via `client.selectGraph(graphName).query(STATS_QUERY)` (line 46),
bypassing `runQuery`. Used by `GET /api/status/graph`
(`server/src/routes/status.routes.ts:23-30`) and by the public aggregate
`GET /api/status` (lines 13-16), which iterates up to 100 graphs from
`client.list()` and sums label/relType counts (`platformStatus`, lines 65-112).
The header comment (lines 4-9) states the intent: node and edge counts come from
the live graph so a stale Postgres cache cannot fake them.

---

## S. Eval/debug script — `server/src/eval/debug-retrieval.ts`

Ad-hoc diagnostics run against `demo-northwind`; not reachable from the API.

### S1 — vector top-8 probe (`debug-retrieval.ts:14-15`, `main`)

```cypher
CALL db.idx.vector.queryNodes('Chunk', 'embedding', 8, vecf32($e)) YIELD node, score
 RETURN node.id AS id, node.text AS text, score
```

Same procedure as D1/K1, different projection (no `documentId`).

### S2 — chunk count (`debug-retrieval.ts:24`, `main`)

```cypher
MATCH (c:Chunk) RETURN count(c) AS c
```

### S3 — keyword fallback probe (`debug-retrieval.ts:33`, `main`)

```cypher
MATCH (c:Chunk) WHERE c.text CONTAINS $t0 MATCH (d:Document {id: c.documentId}) WHERE d.status <> 'SUPERSEDED' RETURN c.id AS chunkId, c.text AS text, d.id AS documentId LIMIT 10
```

Single-line copy of D3.

### S4 — index introspection (`debug-retrieval.ts:43`, `main`)

```cypher
CALL db.indexes() YIELD label, properties, types RETURN label, properties, types
```

The only place the code lists its own indexes; used to confirm the vector and
full-text indexes actually exist after `ensureGraphSchema`.

---

## T. Test-only Cypher — `server/tests/`

These are legitimate Cypher in the repo, but they are fixtures/assertions, not
product queries.

### T1 — read ledger sequence (`graph-v3.test.ts:50`, T16)

```cypher
MATCH (e:LedgerEntry) RETURN e.seq AS seq ORDER BY toInteger(e.seq)
```

### T2 — tamper one ledger entry (`graph-v3.test.ts:52`, T16)

```cypher
MATCH (e:LedgerEntry {seq: $seq}) SET e.kind = 'SILENTLY_REWRITTEN'
```

The test asserts `LedgerService.verify` then reports `brokenAt` at exactly that
`seq` (lines 54-56) — tamper-evidence, not tamper-proofing.

### T3 — superseded rule state (`graph-v3.test.ts:122`, T17/T18)

```cypher
MATCH (r:Rule {id: $id}) RETURN r.status AS status, r.validTo AS validTo
```

### T4 — assert the SUPERSEDES edge exists (`graph-v3.test.ts:126-129`, T17/T18)

```cypher
MATCH (n:Rule {id: $newId})-[:SUPERSEDES]->(o:Rule {id: $oldId}) RETURN n.id AS id
```

### T5 — newest passing bookings (`graph-v3.test.ts:145-147`, T19)

```cypher
MATCH (b:Booking) WHERE b.recordedVerdict = 'PASSED' RETURN b.bookingNumber AS bookingNumber ORDER BY toInteger(b.atMs) DESC LIMIT 5
```

Note `toInteger(b.atMs)` here versus bare `b.atMs` in H1 — the test casts, the
product code relies on string order.

### T6 — tenant B fixture (`neutronz.test.ts:91-93`, T1, via `graph.query`)

```cypher
MERGE (p:Person {id: $id}) SET p.name = $name, p.searchKey = $key
```

### T7 — cypher-injection probe (`neutronz.test.ts:105-107`, T7, via `graph.query`)

```cypher
MERGE (p:Person {id: $id}) SET p.name = $name
```

The payload is the *value*: ``' } ) MATCH (n) DETACH DELETE n //``
(`neutronz.test.ts:104`). It is stored literally and the test then asserts
tenant A's graph still has >30 nodes (lines 109-110). Same statement text as
T6 with one fewer parameter.

Note: T6/T7 are skipped when FalkorDB is unreachable (`describe.skipIf(!falkorUp)`,
lines 83 and 19-21) and are marked as such rather than faked.

---

## U. Precedent recall and absence proofs — `server/src/services/brain/precedent.service.ts`

Both statements are executed through `runQuery`; U1 is fully parameterised, U2
interpolates two identifiers after validating them against the schema allow-list.

### U1 — similar past decisions, scored by shared terms (`precedent.service.ts:33-50`, `PrecedentService.similar`)

```cypher
MATCH (d:Decision)
OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
OPTIONAL MATCH (d)-[:ABOUT]->(t:Task)
WITH d, who, collect(DISTINCT t) AS tasks
WITH d, who,
     reduce(score = 0, term IN $terms |
       score +
       CASE WHEN toLower(coalesce(d.summary, '')) CONTAINS toLower(term) THEN 2 ELSE 0 END +
       CASE WHEN any(task IN tasks WHERE toLower(coalesce(task.summary, '')) CONTAINS toLower(term)
                                             OR toLower(coalesce(task.kind, '')) CONTAINS toLower(term)) THEN 1 ELSE 0 END
     ) AS score
WHERE score > 0 AND d.summary IS NOT NULL
RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at,
       who.name AS decidedBy, score
ORDER BY score DESC, at DESC
LIMIT $limit
```

Why Cypher: a decision is precedent *because of who made it and what it was
about*, which are `DECIDED` and `ABOUT` edges — a similarity search over chunk
text cannot return either. The `OPTIONAL MATCH`es keep decisions that have no
person edge (seed data) instead of dropping them. `$terms` and `$limit` are
bound; the `reduce`/`any` list predicates are FalkorDB Cypher, verified working
(`server/tests/graph-v3.test.ts:223`, T22).

Callers: the freight workflow (`server/src/services/agent/agent-workflows.service.ts`,
terms = booking ref, shipper, consignee, destination, fired rule names) feeds the
**Precedents in this graph** column of the approval card, and the read-only MCP /
`POST /api/brain/tools` tool `similar_decisions`
(`server/src/controllers/graph.controller.ts`, `server/src/mcp/server.ts`).

### U2 — negative trace: matched nodes vs edges that actually exist (`precedent.service.ts:52-59`, `PrecedentService.absence`)

```cypher
MATCH (n)
WHERE toLower(coalesce(n.name, '')) CONTAINS toLower($term)
   OR toLower(coalesce(n.policyName, '')) CONTAINS toLower($term)
   OR toLower(coalesce(n.title, '')) CONTAINS toLower($term)
OPTIONAL MATCH (source:$fromLabel)-[r:$relationship]->(n)
RETURN count(DISTINCT n) AS candidateNodes, count(r) AS edgesFound
```

`$term` is bound. `$fromLabel` and `$relationship` are **identifiers**, which
Cypher cannot parameterise, so they are substituted by `.replace()` at
`precedent.service.ts:94` after `isRelationshipType` / `isNodeLabel` checks
(lines 91-93) throw for anything outside `RELATIONSHIP_TYPES` / `NODE_LABELS`
(`server/src/graph/graph.schema.ts`). T23's second case asserts that a
relationship of `OWNS; DROP` and a label of `Person) WHERE 1=1 RETURN n //` are
rejected before a query is built.

The result is turned into a sentence (`precedent.service.ts:105-108`): with
`edgesFound === 0` the answer is *"N node(s) matched the name, 0 OWNS edges
exist. The graph does not record this relationship."* — the absence is the
finding rather than an empty array. `GraphToolsService.findOwner` and
`getPolicyFor` attach it as `absence` and use the sentence as the fallback
answer.

Note: U2 scans every node (`MATCH (n)`) with a `CONTAINS` predicate — no label
filter and no index, so it is O(nodes) per call. Acceptable at demo scale;
see §Y item 6.

---

## V. Introspection procedures actually used

| Procedure | Where | Purpose |
|---|---|---|
| `CALL db.meta.stats() YIELD labels, relTypes` | `server/src/services/brain/status.service.ts:18` (`STATS_QUERY`, executed at `:46`) | Live node/edge totals per graph for `GET /api/status` and `GET /api/status/graph` |
| `CALL db.indexes() YIELD label, properties, types` | `server/src/eval/debug-retrieval.ts:43` (`main`) | Debug check that the vector/full-text indexes exist |
| `CALL db.idx.vector.queryNodes('Chunk', 'embedding', k, vecf32($v)) YIELD node, score` | `server/src/services/brain/retrieval.service.ts:70` (k=8); `server/src/services/brain/eval.service.ts:70` (k=5); `server/src/eval/debug-retrieval.ts:14` (k=8) | Vector ANN retrieval |
| Schema procedures via the client library, not Cypher: `constraintCreate`, `createNodeRangeIndex`, `createNodeFulltextIndex`, `createNodeVectorIndex` | `server/src/graph/graph.schema.ts:114-202` | Index/constraint creation in `ensureGraphSchema` |

**`db.labels()` and `db.relationshipTypes()` are not called from `server/src/`.**
Label and relationship-type inventories in application code come instead from
`MATCH (n) RETURN labels(n)[0], count(n)` / `MATCH ()-[r]->() RETURN type(r),
count(r)` (`server/src/graph/graph.queries.ts:101-102`, A4/A5), from
`MATCH ()-[r]->() RETURN type(r)` style traversals, and from `db.meta.stats()`
(R1). The same is true of `db.schema.*` and `db.idx.fulltext.queryNodes`, which
appear nowhere in the repo.

For completeness: the falkordb npm package does run those procedures, but only
internally and never from this repo's code. `Graph#setMetadata`
(`server/node_modules/falkordb/dist/src/graph.js:76-88`) issues
`CALL db.labels()`, `CALL db.relationshipTypes()` and `CALL db.propertyKeys()`
as read-only queries to decode ids in result sets, and the app never invokes
them through `runQuery` / `graph.query`. A judge grepping `server/src` for
`db.labels()` will find nothing; the calls are visible only in
`node_modules`, e.g. with `GRAPH.PROFILE`/`SLOWLOG`.

## W. Graph algorithms — what is genuinely present

| Capability | Implementation | Status |
|---|---|---|
| Shortest path | `WITH a, b, shortestPath((a)-[*..${depth}]->(b)) AS p` — `server/src/services/brain/insights.service.ts:142-155` (`directedShortest`), called forward then reversed from `connectionPath` (lines 194-195); `tools.service.ts:147-164` delegates to it | Built-in Cypher path function, no external algo library. FalkorDB accepts it **only** in WITH/RETURN and **only** directed, which is why `direction` is part of the answer (Z1) |
| Centrality | Degree counting `OPTIONAL MATCH (n)-[r]-() … count(r) AS degree ORDER BY degree DESC` — `tools.service.ts:179-182` | Degree centrality only, explicitly labelled as such (`tools.service.ts:185`) |
| Endpoint degree, undirected | `OPTIONAL MATCH (a)-[r1]-() WITH count(r1) …` — `insights.service.ts:239-242` | Used to turn "no path" into a proved absence (Z2) |
| Typed neighbourhood | `MATCH (n {id: $nodeId})-[r]-(m) RETURN type(r), (startNode(r).id = n.id) AS outgoing` — `insights.service.ts:560-563` | Direction computed in Cypher because the pattern itself is undirected (Z14) |
| Relationship-type disjunction | `[r2:OWNS\|GOVERNS\|REQUIRES\|VALIDATES\|IMPLEMENTS\|DERIVED_FROM\|APPROVES]` (`retrieval.service.ts:141`), `[g:GOVERNS\|VALIDATES\|REQUIRES]` (`retrieval.service.ts:195`, `freshness.service.ts:21`, `tools.service.ts:49`), `[:GOVERNS\|VALIDATES\|REQUIRES]` (`insights.service.ts:569`), `[:AUTHORED\|DECIDED]` (`tools.service.ts:111`) | Type-filtered traversals, all literal in source |
| Variable-length provenance | `-[:SUPERSEDES*0..3]->` (`freshness.service.ts:133`), `-[:SUPERSEDES*0..1]->` (`graph.service.ts:224`) | Path patterns |
| Bounded multi-hop expansion | `MATCH path = (f)-[*1..${depth}]-(n)`, depth clamped 1..4 — `server/src/services/brain/graph.service.ts:149` | Fixed-depth traversal, undirected (works: this is not `shortestPath`) |
| Weighted centrality / PageRank | `sum(coalesce(k.weight, 1))` over `KNOWS_ABOUT` — `tools.service.ts:109` | Hand-rolled weighted edge count, not an algorithm library |
| `algo.pageRank` | — | **not implemented** |
| `algo.wcc` (weakly connected components) | — | **not implemented** |
| `algo.labelPropagation` | — | **not implemented** |
| `algo.bfs` | — | **not implemented** |

The comment at `tools.service.ts:10-15` states the reason: FalkorDB images vary
in bundled algorithm libraries, so centrality is done with Cypher degree counts
and paths with `shortestPath()`, and this is disclosed in the tool descriptions.
`src/eval/` and `src/test-core-a.ts` contain no algorithm calls either. Track 04
added no dependency on an algorithm library either: the path finder (Z1), the
endpoint degrees (Z2), the version-chain walks (Z4–Z6) and the handoff board
(Z10–Z12) are all plain Cypher patterns, and the "connected?" answer is
explicitly directed-only rather than quietly computing an undirected closure in
JavaScript and presenting it as a graph algorithm.

## X. Parameterisation and injection safety

**X-1 — values are always bound.** Every user- or LLM-supplied value reaches
Cypher as a `$name` parameter through `runQuery(graph, cypher, params)`
(`server/src/graph/graph.queries.ts:13-20` → `graph.query(cypher, { params })`,
line 18). Examples of untrusted values that stay parameterised: question text
(A7 `$p<i>`, D1 `$embedding`), policy/entity/context/topic strings
(L1–L8), booking numbers (I1, H1), approver name (H3), memory query tokens
(N1 `$t<i>`), ledger payload-derived strings (G2/G3), skill ids (F11/F12),
`LIMIT $limit` (G5, N1, N2, U1), upload content hash (B1), precedent term
arrays (U1 `$terms`, list comprehensions only) and the search term of the
absence query (U2 `$term`).

Track 04 extends the same rule to its own inputs: endpoint names are resolved to
ids by A7 and then bound as `$fromId`/`$toId` (Z1, Z2), a timeline subject is
bound as `$needle` in three statements (Z7–Z9), a rule id/name as `$ruleId` /
`$ruleName` (Z3–Z6, Z13–Z21 also bind `$nodeId`), client-submitted chunk ids as
`$chunkId` (AA1, after `cleanIds` caps count and length), watchlist names as
`$name` (AB3) and the digest window only ever reaches Cypher as the *derived*
`$cutoff` string (Z26). List sizes are never interpolated either: AA2/AC1 bound
their `LIMIT` as `$cap` from a JS `Math.min(Math.max(…))` clamp over the service
default (the curation controllers do not read a client `?limit` at all —
`feedback.service.ts:90`, `saved-query.service.ts:22`), and the fixed caps in
Z10–Z21 are literals in the query text. No Track 04 handler builds a query string
out of request text.

**X-2 — structural tokens are interpolated, and are the guarded surface.** The
template holes below each have a documented guard:

| Hole | Source | Guard |
|---|---|---|
| `${label}` in A1/A3 | `mergeNode` / `setVectorProp` callers | Callers pass literals (seeds, services) or `isNodeLabel`-validated extraction types (`server/src/services/brain/extraction.service.ts:158`) |
| `${fromLabel}`/`${toLabel}`/`${relType}` in A2 | `mergeRelation` callers | `isRelationshipType(rel.type)` before write (`extraction.service.ts:173,256`); labels come from the validated entity set |
| `${e.type}` in E1 | `writeExtractionToGraph` | Same `validateExtraction` gate (`extraction.service.ts:143-196`) |
| `${depth}` in C1 | `?depth=` query param | Numeric clamp `Math.min(Math.max(depth\|\|2,1),4)` (`server/src/services/brain/graph.service.ts:143`) |
| `${depth}` in Z1 | `?hops=` query param (`insights.controller.ts:31`) / fixed `5` (tool, MCP) | `clampInt(maxHops, 1, 6, 5)` — `Number()` + `Number.isFinite` gate, `Math.round`, then `Math.min(Math.max(…))` (`insights.service.ts:131-135`, applied at 166); a non-numeric value yields the literal fallback `5`, so the hole can only ever contain `1`…`6`. The same helper clamps `?days` before it is turned into Z26's `$cutoff` (line 682) and the service default behind Z7–Z9's `$cap` (line 368 — the HTTP timeline endpoint passes no limit, so it is always 40) |
| `${predicates}` in A7, `${labelList}` in L7, `${nodeFilter}` in C1/C4 | label lists | A7's caller passes a hard-coded list (`retrieval.service.ts:57`) — the Track 04 caller passes `[...NODE_LABELS]` (`insights.service.ts:165`), which is the allow-list itself; C1/C4 filter with `isNodeLabel` (`graph.service.ts:144,163`); L7 now does too (`tools.service.ts:171-175`) |
| `$fromLabel` / `$relationship` in U2 | call sites inside this repo (`findOwner`, `getPolicyFor`, the `absence_check` tool args) | `isRelationshipType` + `isNodeLabel` checked before `.replace()` (`precedent.service.ts:91-94`); rejected inputs throw and are asserted by T23 |
| generated `CONTAINS $t<i>` clause series in D2/D3/K2/N1 | token arrays | Only the *count* of clauses is generated; each token is a bound `$t<i>` parameter (`retrieval.service.ts:82,90`; `eval.service.ts:78-82`; `memory.service.ts:100-103,116`) |
| relationship-type alternation `(p:Policy)-[:GOVERNS\|VALIDATES\|REQUIRES]->` in Z15 | source text | Literal in the query string; no request value participates |

Property-name holes in A1/A2 (`n.${k}` / `r.${k}`) are sanitised to
`[a-zA-Z0-9_]` before interpolation (`graph.queries.ts:40,44,68,72`).

**X-3 — the identifier holes are closed, and tested.** `GraphToolsService.centralEntities`
(`server/src/services/brain/tools.service.ts:171-175`) previously joined the
caller's `labels` array into `WHERE (n:X OR n:Y)` without filtering; it now
runs every entry through `isNodeLabel` and throws listing the offenders.
`PrecedentService.absence` validates both identifiers before substituting them.
Both refusals are asserted by T23's second case
(`server/tests/graph-v3.test.ts:273`, "refuses relationship types outside the
schema allow-list"), which sends `{relationship:'OWNS; DROP'}` and
`{labels:['Person) WHERE 1=1 RETURN n //']}` and expects a rejected promise.
Remaining identifier interpolation therefore only ever receives
allow-listed tokens, and tenant isolation is unaffected either way because the
graph handle comes from `forTenant(req.user.userId)`, never from the request.

**X-4 — tests.** `server/tests/neutronz.test.ts:26-51` covers the allow-list
validation gate without FalkorDB: `validateExtraction` drops the non-allow-listed
`MOUNTAIN` label, the non-allow-listed `TRAVELS_TO` relation, relations whose
endpoints were not declared entities, and a rule whose `actionType` fails
`/^[A-Z0-9_]{1,40}$/` (`extraction.service.ts:185`). T7 (`neutronz.test.ts:103-110`)
is the complementary probe: a
``' } ) MATCH (n) DETACH DELETE n //`` payload written as a *parameter value*
is stored literally and destroys nothing.

**X-5 — read-only MCP surface.** The MCP server exposes exactly nine tools, all
of them readers: `find_owner`, `get_policy_for`, `impact_of_change`,
`who_knows_most`, `shortest_path`, `central_entities`, `recent_decisions`,
`similar_decisions`, `absence_check` (`server/src/mcp/server.ts:49-136`). No
writer, no `SimulationService.apply`, no `deleteTenantGraph`, no raw-Cypher
escape hatch — U2's identifiers are chosen server-side and the tenant is pinned
at process start (lines 16-33). The REST equivalents live in
`POST /api/brain/tools` (`server/src/routes/brain.routes.ts:49`,
`server/src/controllers/graph.controller.ts` `callTool` switch, cases at lines
211-242), the same nine readers via a `switch`, which rejects unknown tool names.

Track 04 does not widen that surface. Of the sixteen new endpoints, the six
`InsightsService` reads plus the export are `GET`s (`brain.routes.ts:67-73`), and
the writes — `POST /brain/feedback` (AA), `POST`/`DELETE /brain/saved-queries`
(AC) and `POST`/`DELETE /watchlist` (AB5–AB7) — are REST-only, each behind
`router.use(authenticateToken)` (line 12). The two the UI calls most
(`POST /brain/feedback` and `POST /watchlist`) additionally carry
`apiRateLimiter` (lines 77, 84); the saved-query writes and the two deletes do
not, which is a known gap rather than a claim of full coverage. No Track 04
handler is registered as an MCP tool, so an agent connected over MCP can read
the screening list it is about to be judged by but cannot edit it.

## Y. Over-fetching and post-filtering

Places where the query deliberately pulls more than it needs, then filters in
TypeScript. Noted because it affects how a reviewer reads latency and result
counts.

1. **Vector search has no property filter.** D1/K1/S1 ask the ANN index for a
   flat top-k over *all* `Chunk` nodes
   (`CALL db.idx.vector.queryNodes('Chunk','embedding',8,vecf32($embedding))`)
   with no `WHERE` on `documentId` or version. Supersession is then removed in a
   **second** query and a JS filter: D4 re-reads `d.status` for the retrieved
   documents and `seedChunks = active` drops superseded chunks only if some
   active chunk survives (`server/src/services/brain/retrieval.service.ts:114-127`).
   Reason: the vector index procedure yields `node, score` only, so freshness is
   a post-filter. Consequence: when every top-8 chunk is superseded, the
   superseded set is kept (line 125) — the currency guarantee is best-effort,
   which is exactly what the eval `currency` metric measures with a 0 score
   (`server/src/services/brain/eval.service.ts:55`).

2. **D2/D3/K2/S3 `CONTAINS` scans over the whole `Chunk` label.**
   `MATCH (c:Chunk) WHERE c.text CONTAINS $t0 OR …` cannot use the
   `Chunk(text)` full-text index created at `graph.schema.ts:187`; no query in
   the codebase calls a full-text search procedure. The keyword paths are
   therefore substring scans capped by `LIMIT 10` / `ITERATE 20 LIMIT 10` /
   `LIMIT 5`.

3. **Explorer pages the whole graph.** C4 (`RETURN n LIMIT 500`) and C5
   (`LIMIT 2000`) fetch everything, then de-duplicate and derive display labels
   in JS (`server/src/services/brain/graph.service.ts:173-198`, `inferLabel` at
   272-298). The focus variant C1/C2 additionally re-queries the edge set for the
   id list it just computed (line 154 → 157).

4. **Whole-node returns.** D5 (`RETURN c, d, m, r2, t`), L1
   (`RETURN o, p, collect(…)`), F2 (`RETURN t, labels(t)[0]`), C6/C7 return
   node objects so the caller can read `labels()`; `nodeProps` flattens them and
   unused properties travel with the response.

5. **Fan-out rows summed in JS.** D7 and F1…F8 return one row per combination
   and rely on JS de-dup (`freshness.service.ts:61-65` `byId`;
   `retrieval.service.ts:204-218`; `tools.service.ts:117-126` for L5's `UNION`
   branches). `LIMIT 25`/`LIMIT 40`/`LIMIT 15` caps are the guard.

6. **Unbounded reads that are fine only because the label is small.**
   M1 (`loadRulesFromGraph`) has no `LIMIT`; M2/M3 read every `WatchlistEntry`;
   G4 reads the entire ledger chain on every `verify()` call
   (`server/src/services/brain/ledger.service.ts:116-141`), so ledger
   verification is O(entries) in both query and hashing.

7. **String-typed numerics force casts or rely on lexicographic order.**
   `ORDER BY toInteger(e.seq)` (G1, G4, G5) versus `ORDER BY b.atMs` (H1) versus
   `ORDER BY toInteger(b.atMs)` (T5), and `d.validFrom < $cutoff` (J5) as a
   string comparison.

8. **New in Track 04.** Z18 is an N+1: `explainNode` runs one `IMPLEMENTS` query
   per governing policy found in Z15 (loop at
   `insights.service.ts:588-596`), bounded by Z15's `LIMIT 15`. AB2 (Z-group
   `watchlist.service.ts:73`) reads every `Booking` node with its `input` JSON
   and does the substring screening in TypeScript, because the screening rule is
   the same JS predicate the pure engine uses
   (`rule-engine.service.ts`, `shipper/consignee/notifyParty` containment) — a
   `CONTAINS` in Cypher would have been a second, diverging implementation of
   that rule. AD1/AD2 (`export.service.ts:37-45`) page the whole graph at
   `LIMIT 5000` / `LIMIT 20000` and then re-filter edges in JS to drop any whose
   endpoint fell outside the node page (`export.service.ts:81-84`). Z26 compares
   `d.at >= $cutoff` as strings (ISO-8601, so lexicographic order is date order).

## Z. Graph insights (Track 04) — `server/src/services/brain/insights.service.ts`

Six read-only views behind `GET /api/brain/path`, `/brain/rules/:id/versions`,
`/brain/timeline`, `/brain/handoffs`, `/brain/explain/:id` and
`/brain/freshness-digest`. SQL cannot answer any of them in one statement: each
one is a typed multi-hop traversal over labels Postgres has no columns for.
Endpoint resolution in Z-group feature 1 reuses A7
(`findEntityNodesByName`, `graph.queries.ts:168-173`) and
`rankLinkedNodes` (`graph.queries.ts:179-188`), so no new text-matching query is
introduced.

### Z1 — directed `shortestPath` between two resolved node ids (`insights.service.ts:145-152`, `directedShortest`)

```cypher
MATCH (a {id: $fromId}), (b {id: $toId})
 WITH a, b, shortestPath((a)-[*..${depth}]->(b)) AS p
 WHERE p IS NOT NULL
 RETURN [x IN nodes(p) | coalesce(x.id, '')] AS ids,
        [x IN nodes(p) | labels(x)[0]] AS labels,
        [x IN nodes(p) | coalesce(x.name, x.title, x.ruleName, x.policyName, x.summary, x.statement, x.id, '')] AS names,
        [r IN relationships(p) | type(r)] AS rels
 LIMIT 1
```

Two hard FalkorDB constraints, both measured rather than assumed:
`shortestPath()` is only accepted as a WITH/RETURN expression (it fails in
`MATCH`'s pattern position) and it only traverses in one direction. Hence
`WITH … shortestPath((a)-…->(b))` and the caller running it twice —
`connectionPath` tries forward then reverse
(`insights.service.ts:194-195`) and reports which orientation worked, reversing
the chain for display when the answer only exists the other way
(`insights.service.ts:207-218`). The absence branch (no path either way) still
returns both endpoint degrees from Z2, so "not connected" is a proved statement,
not an empty 200. `${depth}` is the only hole; it is clamped to an integer 1..6
by `clampInt(maxHops, 1, 6, 5)` (`insights.service.ts:131-135`, applied at 166).

### Z2 — incident-edge counts for both endpoints (`insights.service.ts:239-242`, `endpointDegrees`)

```cypher
MATCH (a {id: $fromId}) OPTIONAL MATCH (a)-[r1]-()
 WITH count(r1) AS fromDeg
 MATCH (b {id: $toId}) OPTIONAL MATCH (b)-[r2]-()
 RETURN fromDeg, count(r2) AS toDeg
```

Two separate `WITH` stages instead of one pattern that mixes `a` and `b`:
FalkorDB's implicit grouping does not reliably carry an aggregate across a later
`MATCH` in the same scope. `OPTIONAL MATCH` + `count()` makes a 0-degree node
return `0` rather than no row. Note this count is *undirected* (`[r1]-()`) even
though Z1 is directed — that asymmetry is deliberate: the degrees answer "does
this node exist and have neighbours", the path answer does not.

### Z3 — rule head, by id (`insights.service.ts:255`, `ruleVersionDiff`)

```cypher
MATCH (r:Rule {id: $ruleId}) RETURN r LIMIT 1
```

Used only to read `ruleName` (and to return `null` → HTTP 404 for an unknown id).
`RETURN r` hands back the whole node; `nodeProps` (`graph.queries.ts`) flattens
it.

### Z4 — every version of one rule name with its supersession edges (`insights.service.ts:261-265`)

```cypher
MATCH (r:Rule) WHERE r.ruleName = $ruleName
 OPTIONAL MATCH (r)-[:SUPERSEDES]->(old:Rule)
 WITH r, collect(old.id) AS supersedes
 RETURN r.id AS id, r.version AS version, r.status AS status,
        r.parametersJSON AS params, r.validTo AS validTo, supersedes
```

The `WITH r, collect(old.id)` step is the explicit-grouping form required by the
note on Z2. `parametersJSON` is the string the diff is computed from in
TypeScript (`JSON.parse` with a `{}` fallback, `insights.service.ts:285-290`) —
Cypher has no JSON-diff primitive, and `Rule.parametersJSON` is stored as a
string (`graph-data-model.md` §2). Chronology is taken from the `SUPERSEDES`
edges, not from `version`: the demo seed writes the same number on both nodes, so
sorting by `version` alone could present the raised limit (`5000 → 10000`) as a
lowering. `insights.service.ts:316-322` sorts by
`version | supersedes-something | id`, which puts the superseding node last, and
`server/tests/insights-v4.test.ts:68-98` asserts that for every
`(new)-[:SUPERSEDES]->(old)` edge the old node sorts before the new one.

### Z5 — simulations that targeted this rule (`insights.service.ts:271-272`)

```cypher
MATCH (s:Simulation)-[:ON]->(r:Rule) WHERE r.ruleName = $ruleName
 RETURN s.id AS id, r.id AS ruleId, s.at AS at, s.status AS status, s.candidateParams AS candidateParams
```

`ON` is the Time Machine edge (H1/H4 family). Joining on `ruleName` rather than
id is what lets a v1 and its `_v2` successor both surface their originating
simulation; the JS then matches `sim.ruleId === version.id`
(`insights.service.ts:291`).

### Z6 — supersession edges touching any version of the name (`insights.service.ts:278-279`)

```cypher
MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule) WHERE n.ruleName = $ruleName OR o.ruleName = $ruleName
 RETURN n.id AS fromId, o.id AS toId
```

Read in both directions because the version that *was* superseded also carries
the name; the edge list is what the UI renders as the version chain instead of
inferring order from the `version` string.

### Z7 — decisions naming or ABOUT the subject (`insights.service.ts:373-380`, `decisionTimeline`)

```cypher
MATCH (d:Decision)
 OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
 OPTIONAL MATCH (d)-[:ABOUT]->(subj)
 WITH d, who, [x IN collect(subj) | coalesce(x.name, x.summary, x.kind, x.id, '')] AS subjects
 WHERE toLower(coalesce(d.summary, '')) CONTAINS $needle OR any(s IN subjects WHERE toLower(s) CONTAINS $needle)
 RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at, d.demoSeed AS demoSeed,
        who.name AS actor, subjects AS subjects
 LIMIT $cap
```

The `ABOUT` target is deliberately unlabelled (`(subj)`): a decision can be
about a `Policy`, a `Task` or anything else (§3 of the data model), so the label
would have to be an allow-listed identifier in the query text. Collecting the
subjects into a list comprehension and filtering with `any(… CONTAINS $needle)`
keeps the user term bound. `${cap}` is not interpolated — `LIMIT $cap`, clamped
1..200 by `clampInt(limit, 1, 200, 40)` (`insights.service.ts:368`).

### Z8 — rule versions that changed under the subject (`insights.service.ts:386-391`)

```cypher
MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule)
 WHERE toLower(coalesce(n.ruleName, '')) CONTAINS $needle OR toLower(coalesce(o.ruleName, '')) CONTAINS $needle
 OPTIONAL MATCH (sim:Simulation)-[:ON]->(n)
 RETURN n.id AS newId, o.id AS oldId, n.ruleName AS ruleName, n.version AS version, o.version AS oldVersion,
        o.validTo AS validTo, sim.id AS simId, sim.at AS at, sim.status AS simStatus
 LIMIT $cap
```

### Z9 — ledger entries whose subject id contains the term (`insights.service.ts:397-400`)

```cypher
MATCH (l:LedgerEntry)
 WHERE toLower(coalesce(l.subjectId, '')) CONTAINS $needle OR toLower(coalesce(l.kind, '')) CONTAINS $needle
 RETURN l.seq AS seq, l.at AS at, l.actor AS actor, l.kind AS kind, l.subjectId AS subjectId
 ORDER BY toInteger(l.seq) DESC LIMIT $cap
```

Only `seq/at/actor/kind/subjectId/payloadHash/prevHash/hash` exist on
`LedgerEntry` — there is no payload text in the graph (G2), so the timeline row
says `ledger seq <n>` and points the reader at the hash, which is honest about
what the ledger stores. `toInteger(l.seq)` because `seq` is written as a string
(`ledger.service.ts:89-97`).

The three row sets are concatenated into one `TimelineEvent[]` and sorted in
TypeScript by `at` descending (`insights.service.ts:404-437`) — Cypher could not
union three different shapes with one ordering key without a `UNION` of
pre-shaped subqueries, and the event `kind` labels are UI text.

### Z10 — per-agent task and memory counts (`insights.service.ts:462-467`, `handoffBoard`)

```cypher
MATCH (a:Agent)
 OPTIONAL MATCH (a)-[:PERFORMED]->(t:Task)
 OPTIONAL MATCH (a)-[:REMEMBERS]->(m)
 RETURN a.id AS id, a.name AS name, a.type AS type,
        count(DISTINCT t) AS tasks, count(DISTINCT m) AS memories
 ORDER BY tasks DESC LIMIT 40
```

Two `OPTIONAL MATCH`es fan out into a cross product per agent, so both counts
use `count(DISTINCT …)` — without `DISTINCT` an agent with 3 tasks and 4
memories would report 12/12.

### Z11 — task handoffs with source agent and triggering rule (`insights.service.ts:473-481`)

```cypher
MATCH (t:Task)-[:HANDED_OFF_TO]->(a:Agent)
 OPTIONAL MATCH (src:Agent)-[:PERFORMED]->(t)
 OPTIONAL MATCH (t)-[:TRIGGERED]->(r:Rule)
 RETURN t.id AS taskId, coalesce(t.summary, t.kind, t.id) AS title, t.status AS status,
        t.createdAt AS at, coalesce(t.demoSeed, 'false') AS demoSeed,
        src.id AS fromId, src.name AS fromName,
        a.id AS toId, a.name AS toName, a.type AS toType,
        r.ruleName AS ruleName, r.version AS ruleVersion
 LIMIT 100
```

The `fromAgent` is not stored on the edge — it is derived by walking
`PERFORMED` backwards, which is why `fromId` can be `null` for a task no agent
performed. No parameter here: this board is whole-graph, tenant isolation comes
from the graph name.

### Z12 — direct agent-to-agent handoff edges (`insights.service.ts:487-488`)

```cypher
MATCH (x:Agent)-[:HANDED_OFF_TO]->(y:Agent)
 RETURN x.id AS fromId, x.name AS fromName, y.id AS toId, y.name AS toName, y.type AS toType
 LIMIT 100
```

`HANDED_OFF_TO` is written in both shapes: `Task → Agent` by the workflow
handoff (`agent-workflows.service.ts:281`) and `Agent → Agent` by the demo seed
(`northwind.seed.ts:386`). Z11 and Z12 are reported as separate row kinds
(`directAgentToAgent: false/true`, `insights.service.ts:493-524`) rather than
blended, so a seeded edge cannot look like a live one.

### Z13 — node head for the drill-down (`insights.service.ts:552`, `explainNode`)

```cypher
MATCH (n {id: $nodeId}) RETURN n, labels(n)[0] AS label LIMIT 1
```

Unlabelled match on `id` because "explain this node" accepts any label; ids are
unique per label by constraint (§5 of the data model), so this can return more
than one node in principle and `LIMIT 1` picks one deterministically only within
the store's order. Known limitation, stated here rather than hidden — in practice
the ids the UI offers are prefixed (`pol_`, `rule_`, `chunk_`, `doc_`).

### Z14 — typed neighbourhood with direction (`insights.service.ts:560-563`)

```cypher
MATCH (n {id: $nodeId})-[r]-(m)
 RETURN type(r) AS relation, (startNode(r).id = n.id) AS outgoing, m.id AS id, labels(m)[0] AS label,
        coalesce(m.name, m.title, m.ruleName, m.policyName, m.summary, m.statement, m.id) AS name
 ORDER BY relation LIMIT 80
```

Direction is computed in Cypher (`startNode(r).id = n.id`) because the pattern is
undirected on purpose: an explanation that only showed outgoing edges would hide
the `MENTIONS`/`DERIVED_FROM` evidence pointing *in*.

### Z15 — policies governing this node (`insights.service.ts:569-571`)

```cypher
MATCH (p:Policy)-[:GOVERNS|VALIDATES|REQUIRES]->(n {id: $nodeId})
 RETURN DISTINCT p.id AS policyId, p.name AS policyName, p.status AS status
 LIMIT 15
```

A relationship-type disjunction in the query text — the three types are literal
tokens in the source, not caller input. `RETURN DISTINCT` (not
`collect(DISTINCT)`) because only the policy identity is wanted.

### Z16 — rules implementing this node when the node *is* the policy (`insights.service.ts:576-577`)

```cypher
MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $nodeId})
 RETURN r.id AS id, r.ruleName AS ruleName, r.version AS version, r.status AS status LIMIT 25
```

### Z17 — the human who owns this node (`insights.service.ts:582`)

```cypher
MATCH (o:Person)-[:OWNS]->(n {id: $nodeId}) RETURN o.id AS id, o.name AS name LIMIT 10
```

`OWNS` is written by the seeded SOP owners (`northwind.seed.ts:233`), extraction
(`extraction.service.ts:251-258`) and, new in Track 04, tenant watchlist entries
(Z-AB5).

### Z18 — implemented rules per governing policy (`insights.service.ts:591-592`)

```cypher
MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $pid})
 RETURN r.id AS id, r.ruleName AS ruleName, r.version AS version, r.status AS status LIMIT 15
```

One call per policy id from Z15 (see §Y-8). `$pid` is a graph id that came from
Z15's own result, never from the request.

### Z19 — document provenance of this node (`insights.service.ts:600-601`)

```cypher
MATCH (n {id: $nodeId})-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
 RETURN c.id AS chunkId, c.text AS text, d.id AS documentId, d.title AS documentTitle LIMIT 10
```

The same two-hop provenance shape as C8, from the node side instead of the
document side. This is the query that makes "explain" a citation: it returns the
chunk text, so the drill-down quotes the source rather than summarising it.

### Z20 — decisions mentioning this node (`insights.service.ts:607-613`)

```cypher
MATCH (d:Decision)
 OPTIONAL MATCH (d)-[:ABOUT]->(subj)
 WITH d, collect(subj) AS subjects
 WHERE toLower(coalesce(d.summary, '')) CONTAINS toLower($name) OR any(s IN subjects WHERE s IS NOT NULL AND s.id = $nodeId)
 OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
 RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at, who.name AS decidedBy
 ORDER BY d.at DESC LIMIT 15
```

Both a name-containment match (catches prose decisions that only *say* the
entity) and an exact `subjects.id = $nodeId` match (catches the structured edge).
`OPTIONAL MATCH` after the `WHERE` is fine here: it only decorates rows already
kept.

### Z21 — answer feedback on this node (`insights.service.ts:619-621`)

```cypher
MATCH (f:Feedback)-[:ABOUT]->(n {id: $nodeId})
 RETURN sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS up,
        sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS down
```

`sum(CASE …)` over `count()` so an all-downs node returns `up = 0` instead of a
missing key. This edge points at the *chunk* a rating was about
(`feedback.service.ts:81`), so for a `Chunk` node it is the same rows
`FeedbackService.dislikedSources` (AA5) feeds into the health report.

### Z22 — superseded document versions (`insights.service.ts:688-690`, `freshnessDigest`)

```cypher
MATCH (n:Document)-[:SUPERSEDES]->(o:Document)
 RETURN n.id AS newId, n.title AS title, o.id AS oldId, o.validTo AS supersededAt
 ORDER BY supersededAt DESC LIMIT 50
```

### Z23 — superseded rule versions with their simulation (`insights.service.ts:695-699`)

```cypher
MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule)
 OPTIONAL MATCH (sim:Simulation)-[:ON]->(n)
 RETURN n.id AS newId, n.ruleName AS title, n.version AS version, o.id AS oldId, o.version AS oldVersion,
        o.validTo AS supersededAt, sim.at AS at
 LIMIT 50
```

`o.version` is read specifically so the digest cannot invent a version bump: the
demo seed writes `version: 1` on both the ACTIVE and the SUPERSEDED node
(`northwind.seed.ts:286-296`), so `insights.service.ts:719-731` detects
`version === oldVersion` and drops the `v1 → v1` arrow, explaining that the two
nodes are distinguished by id. Time Machine applies do bump the number
(`simulation.service.ts:165-175`), so real changes still render as
`v1 → v2`. Same guard in the version-diff statement builder
(`insights.service.ts` `verLabel`).

### Z24 — STALE rules (`insights.service.ts:702`)

```cypher
MATCH (r:Rule {status: 'STALE'}) RETURN r.id AS id, r.ruleName AS title, r.staleReason AS reason LIMIT 50
```

Staleness is a property + status, not the allow-listed-but-unused
`STALE_BECAUSE` type (`graph-data-model.md` §3). Distinct from F9, which is the
paginated revalidation queue.

### Z25 — policies awaiting review (`insights.service.ts:705`)

```cypher
MATCH (p:Policy {status: 'REVIEW_PENDING'}) RETURN p.id AS id, p.name AS title, p.category AS category LIMIT 50
```

### Z26 — decisions inside the window (`insights.service.ts:708`)

```cypher
MATCH (d:Decision) WHERE d.at >= $cutoff RETURN count(d) AS c
```

`cutoff` is `Date.now() - days * 86400000` in ISO form
(`insights.service.ts:682-683`), `days` clamped 1..365 from the `?days`
query param (`insights.controller.ts:89`). String comparison on ISO-8601
timestamps — see §Y-7/§Y-8. Note the digest's window
only constrains this one count; the supersession rows
(Z22/Z23) have no date filter and are capped by `LIMIT 50`, so "what changed"
is "most recent 50 of each kind" rather than strictly "in the last 30 days".
The statement text says "in the last N day(s)" only for the decision count.

### Z27 — thumbs-down on cited sources (`insights.service.ts:709`)

```cypher
MATCH (f:Feedback {verdict: 'DOWN'}) RETURN count(f) AS c
```

Whole-graph count, no window: a complaint about a source stays a complaint.
Reported as `counts.citedThumbsDown`, which is why the key is not called
`downsInWindow`.

## AA. Answer feedback as graph data — `server/src/services/brain/feedback.service.ts`

Feature 5. A rating is a `Feedback` node with `ABOUT` edges to the exact
`Chunk` nodes the answer cited, so the deduction lands on the source that earned
it. Written through A1/A2 (`mergeNode`/`mergeRelation`), so the node and edge
upserts are A1/A2 rather than new statements here.

### AA1 — chunk existence gate (`feedback.service.ts:79`, `record`)

```cypher
MATCH (c:Chunk {id: $chunkId}) RETURN c.id AS id LIMIT 1
```

Every submitted chunk id is checked before an edge is written
(`feedback.service.ts:78-83`), so a client cannot attach `ABOUT` edges to arbitrary
ids or to another tenant's id — the id simply does not exist in this graph. Ids
are only ever parameter values, capped and length-bounded in JS
(`cleanIds`, `feedback.service.ts:40-43`: 25 ids, ≤200 chars each).

### AA2 — feedback list with linked chunks (`feedback.service.ts:93-98`, `list`)

```cypher
MATCH (f:Feedback)
 OPTIONAL MATCH (f)-[:ABOUT]->(c:Chunk)
 WITH f, collect(c.id) AS chunkIds
 RETURN f.id AS id, f.at AS at, f.verdict AS verdict, f.question AS question,
        f.comment AS comment, f.givenBy AS givenBy, chunkIds
 ORDER BY f.at DESC LIMIT $cap
```

`ORDER BY f.at DESC` is a plain string sort on an ISO timestamp written by this
service (`at: new Date().toISOString()`, line 61) — every `Feedback.at` is
machine-written, so unlike `Decision.at` (which the seeder backdates) it does not
need `toInteger`/`toFloat` help.

### AA3 — verdict totals (`feedback.service.ts:116-119`, `counts`)

```cypher
MATCH (f:Feedback)
 RETURN sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS up,
        sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS down,
        count(f) AS total
```

### AA4 — how many ratings reached a source (`feedback.service.ts:122`, `counts`)

```cypher
MATCH (f:Feedback)-[:ABOUT]->(c:Chunk) RETURN count(f) AS c
```

`linked` is deliberately smaller than `total` when a rating was recorded with no
matching chunk — that gap is the honest signal that the citation ids were stale.

### AA5 — sources with a downvote and no upvote (`feedback.service.ts:139-145`, `dislikedSources`)

```cypher
MATCH (f:Feedback)-[:ABOUT]->(c:Chunk)
 WITH c, sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS downs,
          sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS ups
 WHERE downs > 0 AND ups = 0
 OPTIONAL MATCH (c)-[:PART_OF]->(d:Document)
 RETURN c.id AS chunkId, d.title AS documentTitle, downs, ups, c.text AS text
 ORDER BY downs DESC LIMIT 25
```

This is the query that couples feature 5 to Knowledge Health:
`HealthService.report` imports it and pushes one `SOURCE_THUMBS_DOWN` finding per
row with `subjectId` = the chunk id
(`health.service.ts:87-99`, i.e. after J5 in §J). An upvote on the same chunk
flips `ups = 0` false and the finding disappears — asserted inside the test
"a thumbs-down on a cited chunk becomes a finding on that exact chunk"
(`server/tests/insights-v4.test.ts:175-204`, upvote case at 200-203). `text` is
truncated to 220 chars in JS
(`feedback.service.ts:153`), not in Cypher.

## AB. Tenant screening list — `server/src/services/brain/watchlist.service.ts`

Feature 6, and the only *write* path in Track 04 that changes a computation: the
denied-party rule already reads every `WatchlistEntry` node as engine facts
(M2), so adding a node changes the next verdict. `loadFactsFromGraph` itself is
unchanged.

### AB1 — list entries with provenance flags (`watchlist.service.ts:52-55`)

```cypher
MATCH (w:WatchlistEntry)
 RETURN w.id AS id, w.name AS name, w.list AS list, w.note AS note,
        w.addedBy AS addedBy, w.at AS at, coalesce(w.demoSeed, 'false') AS demoSeed
 ORDER BY at DESC, name ASC
```

No `LIMIT`: the list is the screening input and truncating it would silently
change what is screened. Whole-label read, same shape as M2/M3. `demoSeed` is
coalesced because the seeded entries set it explicitly
(`northwind.seed.ts:175-177`) while a hand-written node might not.

### AB2 — every stored booking, for the preview match (`watchlist.service.ts:73`, `previewScreening`)

```cypher
MATCH (b:Booking) RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input
```

`b.input` is the JSON string of the `BookingInput` recorded at screening time
(`seed-v3.ts:171-180`, `agent-workflows.service.ts:83-90`); the party fields are
inside it, so the match cannot be a property predicate in Cypher without
duplicating the engine's substring rule in query text. The JS re-implements the
*engine's* rule by calling the same three fields it reads
(`shipper`/`consignee`/`notifyParty`, `watchlist.service.ts:82-84`) and is capped
to 25 preview rows.

### AB3 — case-insensitive duplicate check (`watchlist.service.ts:107-109`, `add`)

```cypher
MATCH (w:WatchlistEntry) WHERE toLower(w.name) = toLower($name)
 RETURN w.id AS id, w.name AS name, w.list AS list, w.note AS note, w.addedBy AS addedBy, w.at AS at, coalesce(w.demoSeed, 'false') AS demoSeed
 LIMIT 1
```

`WatchlistEntry` has a unique constraint on `id` but none on `name`
(`graph.schema.ts:93-139,143-183`), so idempotency is this exact-match query
rather than a merge on name: the response carries `alreadyPresent: true` and no
second node is written.

### AB4 — find the Person matching the actor (`watchlist.service.ts:146`, `add`)

```cypher
MATCH (p:Person) WHERE toLower($actor) CONTAINS toLower(p.name) RETURN p.id AS id LIMIT 1
```

`actor` is `req.user`'s display text, which may be an email; containment of the
Person's name is the join. Deliberately not a `searchKey` equality — the person
the JWT names may have been seeded with a slightly different display name, and a
missing owner edge is cosmetic, not wrong.

### AB5 — attach the human owner (`watchlist.service.ts:150`, `add`)

```cypher
MATCH (p:Person {id: $pid}), (w:WatchlistEntry {id: $wid}) MERGE (p)-[:OWNS]->(w)
```

A raw `MERGE` on the relationship rather than A2's `mergeRelation`, because both
endpoints were just resolved by id and there is nothing to set on the edge.
`OWNS` here keeps a tenant entry reachable from the explorer instead of floating
as an orphan; it is the same relationship type the seeded SOP owners use (Z17).

### AB6 — read the demo flag before deleting (`watchlist.service.ts:166`, `remove`)

```cypher
MATCH (w:WatchlistEntry {id: $id}) RETURN coalesce(w.demoSeed, 'false') AS demoSeed LIMIT 1
```

Two-step on purpose: the row is read first so the API can distinguish "no such
entry" (404-shaped reason) from "seeded demo entry, refusing" (409). The refusal
is `watchlist.service.ts:170-172` and is asserted by
`server/tests/insights-v4.test.ts:246` ("seeded demo entries are refused, never
deleted") — the demo company's screening list cannot be
deleted out from under the demo story.

### AB7 — detach-delete the tenant entry (`watchlist.service.ts:173`)

```cypher
MATCH (w:WatchlistEntry {id: $id}) DETACH DELETE w
```

The only `DETACH DELETE` in Track 04; `DETACH` because AB5 may have added an
`OWNS` edge. Ids are bound, so this cannot fan out: the graph is the tenant's
own (`forTenant(tenantId)` from the JWT), and the same statement run against a
seeded id is unreachable because AB6 refused first.

## AC. Pinned brain queries — `server/src/services/brain/saved-query.service.ts`

Feature 7. Stored as `SavedQuery` nodes in the tenant graph, so isolation is the
graph's (`tenant_<userId>`), not an extra `WHERE` clause someone can forget.
`SavedQuery` has no edges by design — see `graph-data-model.md` §6.

### AC1 — list pins (`saved-query.service.ts:25-27`)

```cypher
MATCH (s:SavedQuery)
 RETURN s.id AS id, s.question AS question, s.snippet AS snippet, s.traceId AS traceId, s.createdAt AS createdAt
 ORDER BY s.createdAt DESC LIMIT $cap
```

### AC2 — duplicate question check (`saved-query.service.ts:48`, `save`)

```cypher
MATCH (s:SavedQuery {question: $question}) RETURN s.id AS id LIMIT 1
```

Exact equality on the cleaned question (no `toLower`), because "who owns X" and
"Who owns X?" are different strings a reader may genuinely want as two pins;
re-pinning the identical question returns the existing row instead of writing a
second node (`saved-query.service.ts:49-53`).

### AC3 — unpin (`saved-query.service.ts:70`, `remove`)

```cypher
MATCH (s:SavedQuery {id: $id}) DETACH DELETE s RETURN s.id AS id
```

`DETACH DELETE … RETURN` returns the deleted node's properties in FalkorDB, and
the code uses `rows.length` as the "was there something to delete" signal
(`saved-query.service.ts:71`) — a convenience that should not be read as
portable Cypher.

## AD. Whole-graph export — `server/src/services/brain/export.service.ts`

Feature 8. Two reads; every format is rendered from the same rows, so the JSON,
GraphML and CSV counts cannot disagree.

### AD1 — every node (`export.service.ts:37-41`, `NODE_SELECT`)

```cypher
MATCH (n)
 RETURN n.id AS id, labels(n)[0] AS label,
        coalesce(n.name, n.title, n.ruleName, n.policyName, n.summary, n.statement, n.bookingNumber, n.id, '') AS name,
        n.status AS status, coalesce(n.demoSeed, 'false') AS demoSeed
 LIMIT 5000
```

### AD2 — every directed edge (`export.service.ts:43-45`, `EDGE_SELECT`)

```cypher
MATCH (a)-[r]->(b)
 RETURN a.id AS source, b.id AS target, type(r) AS relationType
 LIMIT 20000
```

Both are property-projected (`n.id`, not `n`) for two reasons: the response size
and the privacy note in `README` — the export carries ids, display names, status
and the demo flag, not embeddings or chunk payloads. `Chunk.text` is therefore
*not* in the export even though chunks are; the JSON's `meta.note` says what
`demoSeed="true"` means (`export.service.ts:99-109`). Edges whose endpoint
missed the 5000-node page are dropped in JS
(`export.service.ts:81-84`) so a GraphML file is always internally consistent
(`yEd`/GraphML rejects an edge pointing at a missing node id).

Serialisation is not Cypher but is where the one real bug in this track was:
GraphML needs *two* different transforms — ids must be single XML tokens, text
must be escaped — and a single helper doing both silently mangled any name
containing `<`, `&` or a quote. Hence `xmlText()` and `xmlId()`
(`export.service.ts:47-61`), with the regression test that names a node
`A <b> & "c"` and asserts the entity-escaped form comes back
(`server/tests/insights-v4.test.ts`, export group).

---
