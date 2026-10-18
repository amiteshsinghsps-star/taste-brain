# Cypher queries

Every distinct Cypher statement in `server/src/`, grouped by subsystem. Query
text is copied verbatim from source, including `$params` placeholders and the
`${...}` template holes that the code itself interpolates. Call sites are
`path/to/file.ts:functionName` with real line numbers.

Count: **100 numbered statements** across 21 groups (A–U; group P contains no
Cypher). Three entries (M3, S3, T7) are byte-identical duplicates of an earlier
entry, so 97 distinct query texts.

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

### L2 — `get_policy_for`, primary (`tools.service.ts:48-52`, `GraphToolsService.getPolicyFor`)

```cypher
MATCH (p:Policy)-[:GOVERNS|VALIDATES|REQUIRES]->(s) WHERE s.name CONTAINS $context OR p.category = $cat
 OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(p)
 WHERE p.status = 'ACTIVE'
 RETURN p.id AS policyId, p.name AS policyName, r.id AS ruleId, r.ruleName AS ruleName, s.name AS system
 LIMIT 15
```

`$cat` is `normalizeName(context).toUpperCase()` (line 53) — the normalised,
punctuation-stripped context is also tried as a category code.

### L3 — `get_policy_for`, narrower fallback (`tools.service.ts:58-62`, `getPolicyFor`)

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

### L4 — `impact_of_change` id resolution (`tools.service.ts:86`, `GraphToolsService.impactOfChange`)

```cypher
MATCH (r:Rule {id: $id})-[:IMPLEMENTS]->(p:Policy) RETURN p.id AS id LIMIT 1
```

Lets a caller pass a Rule id where a Policy id is expected; the heavy traversal
is then delegated to `FreshnessService.impactOfChange` (F1–F8).

### L5 — `who_knows_most`, weighted expertise with UNION (`tools.service.ts:106-113`, `GraphToolsService.whoKnowsMost`)

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

### L6 — `shortest_path` (`tools.service.ts:144-146`, `GraphToolsService.shortestPath`)

```cypher
MATCH (a), (b) WHERE a.name CONTAINS $from AND b.name CONTAINS $to
 MATCH path = shortestPath((a)-[*..5]-(b))
 RETURN path LIMIT 1
```

FalkorDB's built-in `shortestPath()` — not an external algorithm library (see §W).
`RETURN path` returns the whole path object to the caller verbatim.

### L7 — `central_entities`, degree centrality (`tools.service.ts:165-168`, `GraphToolsService.centralEntities`)

```cypher
MATCH (n) WHERE (${labelList})
 OPTIONAL MATCH (n)-[r]-()
 RETURN n.id AS id, n.name AS name, labels(n)[0] AS label, count(r) AS degree
 ORDER BY degree DESC LIMIT 10
```

`labelList` is `allowed.map((l) => \`n:${l}\`).join(' OR ')` (line 161), where
`allowed = labels.filter(isNodeLabel)` and any label that is not in
`NODE_LABELS` makes the call throw before the query is built (lines 157-160;
asserted by T23 — see §X-3). The result object carries the honesty note
"Degree centrality (Cypher); FalkorDB algo library not assumed." (line 171).

### L8 — `recent_decisions` (`tools.service.ts:182-187`, `GraphToolsService.recentDecisions`)

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
| Shortest path | `shortestPath((a)-[*..5]-(b))` — `server/src/services/brain/tools.service.ts:140` | Built-in Cypher path function, no external algo library |
| Centrality | Degree counting `OPTIONAL MATCH (n)-[r]-() … count(r) AS degree ORDER BY degree DESC` — `tools.service.ts:155-157` | Degree centrality only, explicitly labelled as such (`tools.service.ts:160`) |
| Bounded multi-hop expansion | `MATCH path = (f)-[*1..${depth}]-(n)`, depth clamped 1..4 — `server/src/services/brain/graph.service.ts:149` | Fixed-depth traversal |
| Variable-length provenance | `-[:SUPERSEDES*0..3]->` (`freshness.service.ts:133`), `-[:SUPERSEDES*0..1]->` (`graph.service.ts:224`) | Path patterns |
| Union of relation types | `[r2:OWNS\|GOVERNS\|REQUIRES\|VALIDATES\|IMPLEMENTS\|DERIVED_FROM\|APPROVES]` (`retrieval.service.ts:141`), `[g:GOVERNS\|VALIDATES\|REQUIRES]` (`retrieval.service.ts:195`, `freshness.service.ts:21`, `tools.service.ts:44`), `[:AUTHORED\|DECIDED]` (`tools.service.ts:105`) | Type-filtered traversals |
| Weighted centrality / PageRank | `sum(coalesce(k.weight, 1))` over `KNOWS_ABOUT` — `tools.service.ts:103` | Hand-rolled weighted edge count, not an algorithm library |
| `algo.pageRank` | — | **not implemented** |
| `algo.wcc` (weakly connected components) | — | **not implemented** |
| `algo.labelPropagation` | — | **not implemented** |
| `algo.bfs` | — | **not implemented** |

The comment at `tools.service.ts:10-15` states the reason: FalkorDB images vary
in bundled algorithm libraries, so centrality is done with Cypher degree counts
and paths with `shortestPath()`, and this is disclosed in the tool descriptions.
`src/eval/` and `src/test-core-a.ts` contain no algorithm calls either.

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

**X-2 — structural tokens are interpolated, and are the guarded surface.** The
template holes below each have a documented guard:

| Hole | Source | Guard |
|---|---|---|
| `${label}` in A1/A3 | `mergeNode` / `setVectorProp` callers | Callers pass literals (seeds, services) or `isNodeLabel`-validated extraction types (`server/src/services/brain/extraction.service.ts:158`) |
| `${fromLabel}`/`${toLabel}`/`${relType}` in A2 | `mergeRelation` callers | `isRelationshipType(rel.type)` before write (`extraction.service.ts:173,256`); labels come from the validated entity set |
| `${e.type}` in E1 | `writeExtractionToGraph` | Same `validateExtraction` gate (`extraction.service.ts:143-196`) |
| `${depth}` in C1 | `?depth=` query param | Numeric clamp `Math.min(Math.max(depth||2,1),4)` (`server/src/services/brain/graph.service.ts:143`) |
| `${predicates}` in A7, `${labelList}` in L7, `${nodeFilter}` in C1/C4 | label lists | A7's caller passes a hard-coded list (`retrieval.service.ts:57`); C1/C4 filter with `isNodeLabel` (`graph.service.ts:144,163`); L7 now does too (`tools.service.ts:157-160`) |
| `$fromLabel` / `$relationship` in U2 | call sites inside this repo (`findOwner`, `getPolicyFor`, the `absence_check` tool args) | `isRelationshipType` + `isNodeLabel` checked before `.replace()` (`precedent.service.ts:91-94`); rejected inputs throw and are asserted by T23 |
| generated `CONTAINS $t<i>` clause series in D2/D3/K2/N1 | token arrays | Only the *count* of clauses is generated; each token is a bound `$t<i>` parameter (`retrieval.service.ts:82,90`; `eval.service.ts:78-82`; `memory.service.ts:100-103,116`) |

Property-name holes in A1/A2 (`n.${k}` / `r.${k}`) are sanitised to
`[a-zA-Z0-9_]` before interpolation (`graph.queries.ts:40,44,68,72`).

**X-3 — the identifier holes are closed, and tested.** `GraphToolsService.centralEntities`
(`server/src/services/brain/tools.service.ts:157-161`) previously joined the
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
`POST /api/brain/tools` (`server/src/routes/brain.routes.ts:47`,
`server/src/controllers/graph.controller.ts:204-250`), the same nine readers via
a `switch`, which rejects unknown tool names.

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
   `retrieval.service.ts:204-218`; `tools.service.ts:111-121` for L5's `UNION`
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
