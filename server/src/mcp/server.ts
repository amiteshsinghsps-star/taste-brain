import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GraphToolsService } from '../services/brain/tools.service';
import { PrecedentService } from '../services/brain/precedent.service';

/**
 * Neutronz MCP server (FR-25) — the same Company Brain tools from the REST API
 * exposed over Model Context Protocol so external MCP clients (Claude Desktop,
 * any stdio MCP client) can call them against a demo tenant.
 *
 * Run:  npx ts-node src/mcp/server.ts --tenant <userId>
 * (tenant is a server-side id; client-supplied values are only mapped to the
 *  server-derived graph name, never used raw in Cypher.)
 */

const argv = process.argv.slice(2);
const tenantIdx = argv.indexOf('--tenant');
const tenantFallbackIdx = process.env.NEUTRONZ_TENANT_ID ? -2 : 0;
const tenantId = tenantIdx >= 0 ? argv[tenantIdx + 1] : process.env.NEUTRONZ_TENANT_ID || '';

String(tenantFallbackIdx);

const server = new McpServer(
  { name: 'neutronz-company-brain', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } }
);

function requireTenant(): string {
  if (!tenantId) {
    throw new Error('Missing tenant id. Start with --tenant <userId> or NEUTRONZ_TENANT_ID env.');
  }
  return tenantId;
}

function wrap(name: string, fn: () => Promise<any>) {
  return fn()
    .then((r: any) => ({ content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }] }))
    .catch((err: any) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err?.message || err), tool: name }, null, 2) }],
      isError: true,
    } as any));
}

// SDK's generic typing requires excessive recursion with these zod shapes;
// runtime behavior is unaffected, so tool registration is cast to any.
const mcpServer: any = server;

mcpServer.registerTool('find_owner', {
  title: 'Find Owner',
  description: 'Find who owns / is responsible for a policy, system or document in the company graph.',
  inputSchema: { entity: z.string().describe('Entity or policy name snippet, e.g. "Denied-Party"') },
}, async ({ entity }: any) => wrap('find_owner', async () => {
  requireTenant();
  return GraphToolsService.findOwner(tenantId, entity);
}));

mcpServer.registerTool('get_policy_for', {
  title: 'Get Policy For',
  description: 'Which policies and executable rules govern a system or booking context.',
  inputSchema: { context: z.string().describe('System or context, e.g. "Customs", "freight booking"') },
}, async ({ context }: any) => wrap('get_policy_for', async () => {
  requireTenant();
  return GraphToolsService.getPolicyFor(tenantId, context);
}));

mcpServer.registerTool('impact_of_change', {
  title: 'Impact of Change',
  description: 'What breaks / needs re-review if a policy changes: governed systems, rules, agents, tasks.',
  inputSchema: { policyId: z.string().describe('Graph policy node id') },
}, async ({ policyId }: any) => wrap('impact_of_change', async () => {
  requireTenant();
  return GraphToolsService.impactOfChange(tenantId, policyId);
}));

mcpServer.registerTool('who_knows_most', {
  title: 'Who Knows Most',
  description: 'Ranked people with the most evidence of expertise on a topic/system.',
  inputSchema: { topic: z.string().describe('Topic, system or policy name, e.g. "customs"') },
}, async ({ topic }: any) => wrap('who_knows_most', async () => {
  requireTenant();
  return GraphToolsService.whoKnowsMost(tenantId, topic);
}));

mcpServer.registerTool('shortest_path', {
  title: 'Shortest Path',
  description: 'Shortest relationship path between two entities (Cypher shortestPath).',
  inputSchema: {
    from: z.string().describe('Source entity name snippet'),
    to: z.string().describe('Target entity name snippet'),
  },
}, async ({ from, to }: any) => wrap('shortest_path', async () => {
  requireTenant();
  return GraphToolsService.shortestPath(tenantId, from, to);
}));

mcpServer.registerTool('central_entities', {
  title: 'Central Entities',
  description: 'Most-connected (degree centrality) systems, policies and people — "critical nodes".',
  inputSchema: { labels: z.array(z.string()).optional().describe('Optional node labels to restrict to') },
}, async ({ labels }: any) => wrap('central_entities', async () => {
  requireTenant();
  return GraphToolsService.centralEntities(tenantId, labels);
}));

mcpServer.registerTool('recent_decisions', {
  title: 'Recent Decisions',
  description: 'Recent decisions about an entity with who made them and their source documents.',
  inputSchema: { entity: z.string().describe('Entity snippet to search decisions about, e.g. "BK-1042"') },
}, async ({ entity }: any) => wrap('recent_decisions', async () => {
  requireTenant();
  return GraphToolsService.recentDecisions(tenantId, entity);
}));

mcpServer.registerTool('similar_decisions', {
  title: 'Similar Decisions',
  description: 'Precedent: the last decisions in this tenant graph that match the given terms, with who decided them. Read-only.',
  inputSchema: {
    terms: z.array(z.string()).describe('Terms describing the pending action, e.g. ["BK-1042","denied"]'),
    limit: z.number().int().min(1).max(10).optional().describe('How many precedents to return (default 3)'),
  },
}, async ({ terms, limit }: any) => wrap('similar_decisions', async () => {
  requireTenant();
  return { tool: 'similar_decisions', precedents: await PrecedentService.similar(tenantId, terms.map(String), limit ?? 3) };
}));

mcpServer.registerTool('absence_check', {
  title: 'Absence Check',
  description:
    'Prove what the graph does NOT know: how many nodes matched a name and how many edges of the given type exist (0 edges = a documented gap). Read-only.',
  inputSchema: {
    relationship: z.string().describe('Relationship type from the schema allow-list, e.g. "OWNS"'),
    fromLabel: z.string().describe('Start node label, e.g. "Person"'),
    term: z.string().describe('Name snippet to search for'),
  },
}, async ({ relationship, fromLabel, term }: any) => wrap('absence_check', async () => {
  requireTenant();
  return { tool: 'absence_check', absence: await PrecedentService.absence(tenantId, { relationship, fromLabel, term }) };
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp] Neutronz Company Brain MCP server ready${tenantId ? ` (tenant=${tenantId})` : ' (NO TENANT configured — pass --tenant <userId> or NEUTRONZ_TENANT_ID)'}`);
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
