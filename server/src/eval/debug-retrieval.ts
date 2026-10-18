import { forTenant } from '../graph/graph.client';
import { runQuery } from '../graph/graph.queries';
import { embedTexts } from '../services/brain/embeddings.service';

async function main() {
  const g = await forTenant('demo-northwind');

  const { vectors, provider } = await embedTexts(['Who owns the denied-party screening policy?']);
  console.log('embedding provider:', provider, 'dim:', vectors[0].length);

  try {
    const rows = await runQuery(
      g,
      `CALL db.idx.vector.queryNodes('Chunk', 'embedding', 8, vecf32($e)) YIELD node, score
       RETURN node.id AS id, node.text AS text, score`,
      { e: vectors[0] as any }
    );
    console.log('vector hits:', rows.length, rows.slice(0, 3).map((r: any) => ({ id: r.id, score: r.score, text: String(r.text).slice(0, 60) })));
  } catch (err: any) {
    console.log('VECTOR QUERY FAILED:', err?.message || err);
  }

  try {
    const rows = await runQuery(g, `MATCH (c:Chunk) RETURN count(c) AS c`, {});
    console.log('chunk count:', rows);
  } catch (err: any) {
    console.log('count failed:', err?.message);
  }

  try {
    const rows = await runQuery(
      g,
      `MATCH (c:Chunk) WHERE c.text CONTAINS $t0 MATCH (d:Document {id: c.documentId}) WHERE d.status <> 'SUPERSEDED' RETURN c.id AS chunkId, c.text AS text, d.id AS documentId LIMIT 10`,
      { t0: 'denied' }
    );
    console.log('fulltext-simple hits:', rows.length);
  } catch (err: any) {
    console.log('fulltext failed:', err?.message);
  }

  // indexes
  try {
    const rows = await runQuery(g, `CALL db.indexes() YIELD label, properties, types RETURN label, properties, types`, {});
    console.log('indexes:', JSON.stringify(rows));
  } catch (err: any) {
    console.log('db.indexes failed:', err?.message);
  }
}
main().then(() => process.exit(0));
