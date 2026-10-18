import { isFalkorReachable, deleteTenantGraph } from '../graph/graph.client';
import { NorthwindSeeder } from '../seed/northwind.seed';
import { SeedV3 } from '../seed/seed-v3';

/**
 * CLI demo seeder — `npm run seed:demo [-- --tenant <id>] [-- --keep]`.
 * Default tenant: demo-northwind. Wipes the tenant graph first unless --keep
 * so re-running is idempotent.
 */

async function main() {
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf('--tenant');
  const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : 'demo-northwind';
  const keep = args.includes('--keep');

  if (!(await isFalkorReachable())) {
    console.error('FalkorDB is not reachable — start it with `docker compose up -d` at the repo root.');
    process.exit(1);
  }
  if (!keep) {
    await deleteTenantGraph(tenantId).catch(() => {});
  }
  const r1 = await NorthwindSeeder.seed(tenantId);
  const r2 = await SeedV3.seed(tenantId);
  console.log(`Seeded tenant "${tenantId}":`, { ...r1.counts, ...r2.counts });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
