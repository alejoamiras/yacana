// The fee flow touches Ethereum only to connect: the account and the chain. Once a sign-in opens a
// bridge session the flow runs on that session's config, whose transport is the page's RPC, so a
// read, a signature or a write would leave the page; the flow's own modules may therefore import from
// wagmi only what connecting takes, and nothing from viem or wagmi's actions.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLOW = join(import.meta.dir, '../src/fees');
const CONNECTING = new Set([
  'Config',
  'createConfig',
  'createStorage',
  'custom',
  'injected',
  'useAccount',
  'useConnect',
  'useConnectors',
  'WagmiProvider',
]);
const SPEC = /\.(vitest\.tsx|test\.ts)$/;

/** Every name a module imports from a wagmi or viem entry point, as `<entry>:<name>`. */
function chainImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'((?:wagmi|viem|@wagmi\/[^']+)[^']*)'/g,
  ))
    for (const name of (m[1] ?? '').split(',')) {
      const bare = name
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (bare) out.push(`${m[2]}:${bare}`);
    }
  for (const m of source.matchAll(/(?:import\s*\(|from\s+)'((?:wagmi|viem|@wagmi\/)[^']*)'/g))
    if (m[1] !== 'wagmi') out.push(`${m[1]}:*`);
  return out;
}

test('the fee flow imports from wagmi only what connecting takes', () => {
  const modules = readdirSync(FLOW, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.tsx?$/.test(f) && !SPEC.test(f),
  );
  expect(modules).toContain('wallet.tsx');
  const found = modules.flatMap((f) =>
    chainImports(readFileSync(join(FLOW, f), 'utf8')).map((i) => `${f} ${i}`),
  );
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((i) => !CONNECTING.has(i.split(':')[1] ?? '') || !/ wagmi:/.test(i))).toEqual([]);
});
