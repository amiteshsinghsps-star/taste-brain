/**
 * Neutronz tenant graph schema for FalkorDB.
 *
 * Node labels and relationship types are allow-lists: any value coming from LLM
 * extraction (untrusted input) is validated against these before it is ever
 * written to Cypher. This is the injection/abuse guard for FR-2 and §12.2.
 */

export const NODE_LABELS = [
  'Person',
  'Team',
  'Agent',
  'Project',
  'System',
  'Document',
  'Chunk',
  'Message',
  'Ticket',
  'Policy',
  'Rule',
  'Decision',
  'Task',
  'Episode',
  'Fact',
  'Procedure',
  'ConversationNode',
  'Turn',
  'WatchlistEntry',
  'Customer',
  'Shipment',
  'Invoice',
  'Booking',
  'Simulation',
  'LedgerEntry',
  'HealthFinding',
  'EvalRun',
  'Feedback',
  'SavedQuery',
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];

// 'Conversation' is a reserved word in some Redis contexts; we label chat nodes
// ConversationNode and expose them via the same API shape.
export const RELATIONSHIP_TYPES = [
  'MEMBER_OF',
  'OWNS',
  'AUTHORED',
  'PART_OF',
  'MENTIONS',
  'DERIVED_FROM',
  'IMPLEMENTS',
  'GOVERNS',
  'REQUIRES',
  'VALIDATES',
  'APPROVES',
  'SUPERSEDES',
  'DECIDED',
  'ABOUT',
  'PERFORMED',
  'HANDED_OFF_TO',
  'TRIGGERED',
  'REMEMBERS',
  'HAS_TURN',
  'KNOWS_ABOUT',
  'FLAGGED_BY',
  'FOR',
  'ON',
  'AFFECTS',
  'NEXT',
  'RECORDED_AS',
  'STALE_BECAUSE',
  'MERGED_INTO',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function isNodeLabel(label: string): boolean {
  return (NODE_LABELS as readonly string[]).includes(label);
}

export function isRelationshipType(rel: string): boolean {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(rel);
}

/** Stable merge key for entities inside a tenant graph: type + normalized name. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SCHEMA_CONSTRAINTS: Array<{ type: 'unique' | 'mandatory'; label: NodeLabel; prop: string }> = [
  { type: 'unique', label: 'Person', prop: 'id' },
  { type: 'unique', label: 'Team', prop: 'id' },
  { type: 'unique', label: 'Agent', prop: 'id' },
  { type: 'unique', label: 'Document', prop: 'id' },
  { type: 'unique', label: 'Chunk', prop: 'id' },
  { type: 'unique', label: 'Policy', prop: 'id' },
  { type: 'unique', label: 'Rule', prop: 'id' },
  { type: 'unique', label: 'Decision', prop: 'id' },
  { type: 'unique', label: 'Task', prop: 'id' },
  { type: 'unique', label: 'Fact', prop: 'id' },
  { type: 'unique', label: 'Episode', prop: 'id' },
  { type: 'unique', label: 'Procedure', prop: 'id' },
  { type: 'unique', label: 'WatchlistEntry', prop: 'id' },
  { type: 'unique', label: 'Customer', prop: 'id' },
  { type: 'unique', label: 'Shipment', prop: 'id' },
  { type: 'unique', label: 'Invoice', prop: 'id' },
  { type: 'unique', label: 'System', prop: 'id' },
  { type: 'unique', label: 'Project', prop: 'id' },
];

export async function ensureGraphSchema(graph: {
  constraintCreate: (
    constraintType: 'unique' | 'mandatory' | 'exists',
    entityId: 'NODE' | 'RELATIONSHIP',
    label: string,
    ...properties: string[]
  ) => Promise<void>;
  createNodeRangeIndex: (label: string, ...properties: string[]) => Promise<unknown>;
  createNodeFulltextIndex: (label: string, ...properties: string[]) => Promise<unknown>;
  createNodeVectorIndex: (
    label: string,
    dim?: number,
    similarityFunction?: string,
    ...properties: string[]
  ) => Promise<unknown>;
}, embeddingsDim: number): Promise<void> {
  for (const c of SCHEMA_CONSTRAINTS) {
    try {
      await graph.constraintCreate(c.type, 'NODE', c.label, c.prop);
    } catch (err: any) {
      // Constraint may already exist or FalkorDB without constraint support.
      if (!/already|exists/i.test(String(err?.message || '') + String(err?.error?.message || ''))) {
        console.warn(`constraint notice (${c.label}.${c.prop}):`, err?.message || err);
      }
    }
  }

  // Range indexes used by hot queries (§9.4) — id indexes also back the
  // unique constraints below (FalkorDB requires a supporting exact-match index).
  const rangeIdx: Array<[NodeLabel, string[]]> = [
    ['Person', ['id']],
    ['Person', ['email']],
    ['Policy', ['id']],
    ['Policy', ['status']],
    ['Policy', ['category']],
    ['Rule', ['id']],
    ['Rule', ['actionType']],
    ['Rule', ['status']],
    ['Document', ['id']],
    ['Document', ['hash']],
    ['Chunk', ['id']],
    ['Chunk', ['documentId']],
    ['Task', ['id']],
    ['System', ['id']],
    ['Team', ['id']],
    ['Project', ['id']],
    ['Customer', ['id']],
    ['WatchlistEntry', ['id']],
    ['Shipment', ['id']],
    ['Invoice', ['id']],
    ['Decision', ['id']],
    ['Fact', ['id']],
    ['Episode', ['id']],
    ['Procedure', ['id']],
    ['Agent', ['id']],
    ['Fact', ['scope']],
    ['Episode', ['scope']],
    ['Booking', ['bookingNumber']],
    ['LedgerEntry', ['seq']],
    ['Simulation', ['status']],
    ['Feedback', ['id']],
    ['Feedback', ['verdict']],
    ['SavedQuery', ['id']],
    ['SavedQuery', ['createdAt']],
    ['WatchlistEntry', ['name']],
    ['Decision', ['at']],
  ];
  for (const [label, props] of rangeIdx) {
    try {
      await graph.createNodeRangeIndex(label, ...props);
    } catch (err: any) {
      if (!/already/i.test(String(err?.message || '') + String(err?.error?.message || ''))) {
        console.warn(`range index notice (${label}):`, err?.message || err);
      }
    }
  }

  // Full-text retrieval inside the graph (keyword fallback within FalkorDB)
  try {
    await graph.createNodeFulltextIndex('Chunk', 'text');
  } catch (err: any) {
    if (!/already/i.test(String(err?.message || '') + String(err?.error?.message || ''))) {
      console.warn('fulltext index notice (Chunk):', err?.message || err);
    }
  }

  // Vector index on Chunk.embedding — dimension must match the embedding model
  try {
    await graph.createNodeVectorIndex('Chunk', embeddingsDim, 'COSINE', 'embedding');
  } catch (err: any) {
    if (!/already|created|success/i.test(String(err?.message || '') + String(err?.error?.message || ''))) {
      console.warn('vector index notice (Chunk):', err?.message || err);
    }
  }
}
