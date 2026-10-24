// Copies non-TS runtime assets (pack configs + Qloo fixtures) from src/ to dist/.
// tsc compiles .ts but leaves .json out, and the server loads them via fs at runtime.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

for (const rel of ['packs/data', 'qloo/fixtures', 'eval']) {
  const from = join(src, rel);
  const to = join(dist, rel);
  if (!existsSync(from)) continue;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log('copied', rel, '->', 'dist/' + rel);
}
