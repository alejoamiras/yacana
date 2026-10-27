import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pkg = resolve(import.meta.dir, '..');
const FLOW = 'apps/web-miner/src/fees/';

/** Every module id in every chunk the miner's build emits (the page's and the Worker's), from its module report. */
function chunkModules(env: Record<string, string>): string[] {
  const out = mkdtempSync(join(tmpdir(), 'yacana-fees-'));
  const report = join(out, 'report');
  try {
    execFileSync(
      'bunx',
      ['vite', 'build', '--outDir', join(out, 'dist'), '--emptyOutDir', '--logLevel', 'error'],
      {
        cwd: pkg,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, ...env, YACANA_ASSEMBLE: '1', YACANA_MODULE_REPORT: report },
      },
    );
    const graphs = readdirSync(report).filter((f) => f.endsWith('.chunks.json'));
    if (graphs.length === 0) throw new Error(`the build wrote no chunk report into ${report}`);
    return graphs.flatMap((f) =>
      (JSON.parse(readFileSync(join(report, f), 'utf8')) as { modules: string[] }[]).flatMap(
        (c) => c.modules,
      ),
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// Real builds: the flow must be absent from the bundle itself, not merely unreachable at runtime.
describe('the fee-funding flow ships in flagged builds and in no production one', () => {
  test('a flagged e2e build carries the flow', () => {
    expect(
      chunkModules({ YACANA_SITE_MODE: 'e2e', VITE_DEV_FUND_FEES: '1', VITE_RP_ID: 'localhost' }),
    ).toContain(`${FLOW}Slot.tsx`);
  }, 120_000);

  test('a production build with the flag in its environment carries no module of it', () => {
    const modules = chunkModules({ YACANA_SITE_MODE: 'production', VITE_DEV_FUND_FEES: '1' });
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.filter((m) => m.startsWith(FLOW))).toEqual([]);
  }, 120_000);
});
