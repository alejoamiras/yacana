// The fee flow touches Ethereum only to connect: the account and the chain. Once a sign-in opens a
// bridge session the flow runs on that session's config, whose transport is the page's RPC, so a
// read, a signature or a write would leave the page. The flow's own modules may therefore import from
// wagmi only what connecting takes, nothing from viem or wagmi's actions, and from the page's wallet
// and bridge modules only the named parts that connect or name a chain.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLOW = join(import.meta.dir, '../src/fees');
const ALLOWED: readonly { module: RegExp; names: ReadonlySet<string> }[] = [
  {
    module: /^wagmi$/,
    names: new Set([
      'Config',
      'createConfig',
      'createStorage',
      'custom',
      'injected',
      'useAccount',
      'useConnect',
      'useConnectors',
      'WagmiProvider',
    ]),
  },
  { module: /\/features\/dialogs\/Wallet$/, names: new Set(['ConnectWallet', 'WalletChip']) },
  { module: /\/bridge\/eth$/, names: new Set(['bridgeChain']) },
];
/** The modules a read could come through: wagmi, viem, and the page's own wallet and bridge modules. */
const WATCHED = /^(wagmi|viem|@wagmi\/)|\/features\/dialogs\/Wallet$|\/bridge\//;
const SPEC = /\.(vitest\.tsx|test\.ts)$/;

/** `<module>:<name>` for every named import or re-export, `<module>:*` for any other form that reaches a watched module. */
function watchedImports(source: string): string[] {
  const out: string[] = [];
  const named = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2/g;
  for (const [, names = '', , module = ''] of source.matchAll(named)) {
    if (!WATCHED.test(module)) continue;
    for (const name of names.split(',')) {
      const bare = name
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (bare) out.push(`${module}:${bare}`);
    }
  }
  // Default, namespace, side-effect, star re-export and dynamic forms name nothing to check: each is refused.
  const other =
    /(?:import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\w+)(?:\s*,\s*\{[^}]*\})?\s+from|import|export\s+\*(?:\s+as\s+\w+)?\s+from|import\s*\()\s*(['"])([^'"]+)\1/g;
  for (const [, , module = ''] of source.matchAll(other)) if (WATCHED.test(module)) out.push(`${module}:*`);
  return out;
}

const allowed = (entry: string): boolean => {
  const i = entry.lastIndexOf(':');
  const [module, name] = [entry.slice(0, i), entry.slice(i + 1)];
  return ALLOWED.some((a) => a.module.test(module) && a.names.has(name));
};

test('the fee flow imports only what connecting takes from the modules a read could come through', () => {
  const modules = readdirSync(FLOW, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.tsx?$/.test(f) && !SPEC.test(f),
  );
  expect(modules).toContain('wallet.tsx');
  const found = modules.flatMap((f) =>
    watchedImports(readFileSync(join(FLOW, f), 'utf8')).map((i) => `${f} ${i}`),
  );
  expect(found.some((i) => i.endsWith(' wagmi:useAccount'))).toBe(true);
  expect(found.filter((i) => !allowed(i.slice(i.indexOf(' ') + 1)))).toEqual([]);
});

test('every way of importing a read is seen', () => {
  const reads = [
    `import * as w from 'wagmi';`,
    `import wagmi from "wagmi";`,
    `const w = await import('wagmi');`,
    `import { getBalance } from "wagmi/actions";`,
    `export * from 'viem';`,
    `import { useYacaBalance } from '../../features/dialogs/Wallet';`,
    `import type { BridgeSession } from '../bridge/session';`,
    `import { type Config, useBalance } from 'wagmi';`,
  ];
  for (const source of reads)
    expect(
      watchedImports(source).filter((i) => !allowed(i)),
      source,
    ).not.toEqual([]);
  expect(watchedImports(`import { useAccount, type Config } from 'wagmi';`).every(allowed)).toBe(true);
});
