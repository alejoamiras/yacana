// The miner's first paint carries neither the stats pages nor their charts: they arrive when Stats is
// first opened. Reads the page build's chunk graph (`YACANA_MODULE_REPORT=<dir>` at build time), walks
// the entries' static imports, fails on any stats module among them, and prints what Stats costs.
// `bun apps/web-miner/scripts/check-chunks.ts <dir>`
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Chunk {
  file: string;
  entry: boolean;
  modules: string[];
  imports: string[];
  dynamicImports: string[];
  bytes: number;
}

/** Report ids are repo-relative: the workspace's sources, and the hoisted `node_modules`. */
const LAZY_ONLY = [/^packages\/stats-view\//, /^node_modules\/@observablehq\/plot\//];
const STATS_PAGE = 'apps/web-miner/src/routes/Stats.tsx';

const dir = process.argv[2];
if (!dir) throw new Error('usage: bun apps/web-miner/scripts/check-chunks.ts <module report dir>');
const graph = JSON.parse(readFileSync(resolve(dir, 'web-miner.chunks.json'), 'utf8')) as Chunk[];
const byFile = new Map(graph.map((c) => [c.file, c]));

/** `from` and every chunk its static imports load with it, transitively. */
function staticClosure(from: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) visit(next);
  };
  for (const file of from) visit(file);
  return seen;
}

const firstPaint = staticClosure(graph.filter((c) => c.entry).map((c) => c.file));
const leaked = [...firstPaint].flatMap((file) =>
  (byFile.get(file)?.modules ?? [])
    .filter((m) => LAZY_ONLY.some((re) => re.test(m)))
    .map((m) => `${file}: ${m}`),
);
if (leaked.length) {
  console.error(`the first paint carries what Stats loads lazily:\n${leaked.join('\n')}`);
  process.exit(1);
}

const page = graph.find((c) => c.modules.includes(STATS_PAGE));
if (!page) throw new Error(`no chunk carries ${STATS_PAGE}: is this report from the miner's page build?`);
const own = [...staticClosure([page.file])].filter((file) => !firstPaint.has(file));
const kB = (bytes: number) => (bytes / 1024).toFixed(1);
const total = own.reduce((sum, file) => sum + (byFile.get(file)?.bytes ?? 0), 0);
console.log(
  `first paint: ${firstPaint.size} chunks, no stats module · Stats on first opening: ${own.length} ` +
    `chunk(s), ${kB(total)} kB (${page.file} ${kB(page.bytes)} kB)`,
);
