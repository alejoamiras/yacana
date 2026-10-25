import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appRoleFrom,
  type DeploymentRecord,
  type ExampleClaim,
  loadSiteConfig,
  parseEnvFile,
  siteModeFrom,
  viteDefine,
} from './config.ts';

const siteEnv = parseEnvFile(readFileSync(resolve(import.meta.dir, '../../../deployments/site.env'), 'utf8'));
const deployment = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../../deployments/testnet.json'), 'utf8'),
) as DeploymentRecord;
const base = { siteEnv, deployment, sourceCommit: 'abc', bbVersion: '6.0.0' };

describe('site config', () => {
  test('production takes site.env and the record and ignores the process environment', () => {
    const c = loadSiteConfig({
      ...base,
      mode: 'production',
      env: {
        VITE_AZTEC_NODE_URL: 'http://localhost:1',
        VITE_E2E_QUERY_OVERRIDES: '1',
        VITE_PRESTO_E2E_PORT: '59833',
        VITE_E2E_PROVERLESS: '1',
      },
    });
    expect(c.nodeUrl).toBe(siteEnv.VITE_AZTEC_NODE_URL);
    expect(c.proverless).toBe(false);
    // A hostile e2e environment cannot hand production a plaintext Presto port.
    expect(c.prestoE2ePort).toBe('');
    expect(viteDefine(c)['import.meta.env.VITE_PRESTO_E2E_PORT']).toBe('""');
    expect(c.rpId).toBe('yacana.network');
    expect(c.previewHostSuffix).toBe('-yacana.alejo-amiras.workers.dev');
    expect(viteDefine(c)['import.meta.env.VITE_PREVIEW_HOST_SUFFIX']).toBe(
      '"-yacana.alejo-amiras.workers.dev"',
    );
    expect(c.miner).toBe(deployment.miner);
    expect(c.minerClassId).toBe(deployment.minerClassId);
    expect(c.queryOverrides).toBe(false);
    expect(c.launchMode).toBe(false);
    expect(c.explorerUrl).toBe('https://testnet.aztecscan.xyz');
    expect(viteDefine(c)['import.meta.env.VITE_E2E_QUERY_OVERRIDES']).toBe('""');
    expect(viteDefine(c)['import.meta.env.VITE_E2E_PROVERLESS']).toBe('""');
    expect(viteDefine(c)['import.meta.env.VITE_EXPLORER_URL']).toBe('"https://testnet.aztecscan.xyz"');
  });

  test('e2e lets the environment override every value, including the override flag', () => {
    const c = loadSiteConfig({
      ...base,
      mode: 'e2e',
      env: {
        VITE_AZTEC_NODE_URL: 'http://localhost:8080',
        VITE_ROLLUP_ADDRESS: '0x00000000000000000000000000000000000000aa',
        VITE_RP_ID: 'localhost',
        VITE_YACANA_MINER: '0x01',
        VITE_E2E_QUERY_OVERRIDES: '1',
        VITE_LAUNCH_MODE: '1',
        VITE_EXPLORER_URL: 'off',
        VITE_PRESTO_E2E_PORT: '24996',
        VITE_E2E_PROVERLESS: '1',
      },
    });
    // The proverless flag needs the exact mode `e2e`: a dev build with it set still proves.
    expect(loadSiteConfig({ ...base, mode: 'dev', env: { VITE_E2E_PROVERLESS: '1' } }).proverless).toBe(
      false,
    );
    expect(c.launchMode).toBe(true);
    expect(c.prestoE2ePort).toBe('24996');
    expect(viteDefine(c)['import.meta.env.VITE_PRESTO_E2E_PORT']).toBe('"24996"');
    expect(c.proverless).toBe(true);
    expect(viteDefine(c)['import.meta.env.VITE_E2E_PROVERLESS']).toBe('"1"');
    expect(c.explorerUrl).toBe('off');
    expect(c.nodeUrl).toBe('http://localhost:8080');
    expect(c.rollupAddress).toBe('0x00000000000000000000000000000000000000aa');
    expect(c.record.rollupAddress).toBe('0x00000000000000000000000000000000000000aa');
    expect(c.rpId).toBe('localhost');
    expect(c.miner).toBe('0x01');
    expect(c.token).toBe(deployment.token);
    expect(c.queryOverrides).toBe(true);
  });

  test("the example claim ships only when it is this deployment's and well formed", () => {
    const claim = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../../deployments/testnet.example-claim.json'), 'utf8'),
    ) as ExampleClaim;
    const c = loadSiteConfig({ ...base, mode: 'production', exampleClaim: claim });
    expect(JSON.parse(viteDefine(c)['import.meta.env.VITE_EXAMPLE_CLAIM'] as string)).toBe(
      JSON.stringify(claim),
    );
    expect(
      viteDefine(loadSiteConfig({ ...base, mode: 'production' }))['import.meta.env.VITE_EXAMPLE_CLAIM'],
    ).toBe('""');
    const foreign = { ...claim, miner: `0x${'2'.padStart(64, '0')}` };
    expect(() => loadSiteConfig({ ...base, mode: 'production', exampleClaim: foreign })).toThrow(
      /another deployment/,
    );
    for (const bad of [
      { claims: [1, 3] },
      { claims: [-1, 0] },
      { claims: [4, 5] },
      { claims: [0.5, 1.5] },
      { claims: ['1', '2'] },
      { block: -1 },
      { block: 7.5 },
      { txHash: '0x12' },
    ] as Partial<ExampleClaim>[])
      expect(() =>
        loadSiteConfig({ ...base, mode: 'production', exampleClaim: { ...claim, ...bad } }),
      ).toThrow(/malformed/);
    // An e2e build's identity overrides move the bar: the testnet claim is foreign to a throwaway deployment.
    expect(() =>
      loadSiteConfig({
        ...base,
        mode: 'e2e',
        exampleClaim: claim,
        env: { VITE_YACANA_MINER: `0x${'3'.padStart(64, '0')}` },
      }),
    ).toThrow(/another deployment/);
  });

  test('production refuses a placeholder RP ID, a local or plaintext node, and the e2e flag', () => {
    const attempt = (siteEnvPatch: Record<string, string>) => () =>
      loadSiteConfig({ ...base, mode: 'production', siteEnv: { ...siteEnv, ...siteEnvPatch } });
    expect(attempt({ VITE_RP_ID: 'localhost' })).toThrow(/not a production hostname/);
    expect(attempt({ VITE_RP_ID: 'yacana' })).toThrow(/not a production hostname/);
    expect(attempt({ VITE_AZTEC_NODE_URL: 'http://localhost:8080' })).toThrow(/not https/);
    expect(attempt({ VITE_AZTEC_NODE_URL: 'https://10.0.0.1' })).toThrow(/is local/);
    expect(attempt({ VITE_EXPLORER_URL: 'http://explorer.example' })).toThrow(/explorer .* not https/);
    expect(attempt({ VITE_EXPLORER_URL: 'off' })).not.toThrow();
  });

  test('the preview suffix: production takes the committed shape or none; other modes never have one', () => {
    const production = (VITE_PREVIEW_HOST_SUFFIX: string) =>
      loadSiteConfig({
        ...base,
        mode: 'production',
        siteEnv: { ...siteEnv, VITE_PREVIEW_HOST_SUFFIX },
        env: { VITE_PREVIEW_HOST_SUFFIX: '-yacana.attacker.workers.dev' },
      });
    expect(production('').previewHostSuffix).toBe('');
    expect(production('-yacana.alejo-amiras.workers.dev').previewHostSuffix).toBe(
      '-yacana.alejo-amiras.workers.dev',
    );
    for (const bad of [
      'yacana.alejo-amiras.workers.dev',
      '-yacana.alejo-amiras.pages.dev',
      '.workers.dev',
      '-a.b.c.workers.dev',
    ])
      expect(() => production(bad)).toThrow(/preview host suffix/);
    for (const mode of ['e2e', 'dev'] as const) {
      const c = loadSiteConfig({ ...base, mode, env: { VITE_PREVIEW_HOST_SUFFIX: '-yacana.x.workers.dev' } });
      expect(c.previewHostSuffix).toBe('');
      expect(viteDefine(c)['import.meta.env.VITE_PREVIEW_HOST_SUFFIX']).toBe('""');
    }
  });

  test('the Ethereum side: site.env in production, overridable elsewhere, refused when plaintext or local', () => {
    const c = loadSiteConfig({
      ...base,
      mode: 'production',
      env: { VITE_ETH_RPC_URL: 'http://localhost:8545' },
    });
    expect(c.ethRpcUrl).toBe(siteEnv.VITE_ETH_RPC_URL);
    expect(c.l1ExplorerUrl).toBe('https://sepolia.etherscan.io');
    expect(c.oldAppOrigin).toBe('https://v5.yacana.network');
    expect(c.role).toBe('apex');
    expect(viteDefine(c)['import.meta.env.VITE_APP_ROLE']).toBe('"apex"');
    expect(viteDefine(c)['import.meta.env.VITE_ETH_RPC_URL']).toBe(JSON.stringify(siteEnv.VITE_ETH_RPC_URL));
    const e2e = loadSiteConfig({
      ...base,
      mode: 'e2e',
      env: {
        VITE_ETH_RPC_URL: 'http://127.0.0.1:8545',
        VITE_L1_EXPLORER_URL: 'off',
        VITE_OLD_APP_ORIGIN: 'http://localhost:4173',
      },
    });
    expect(e2e.ethRpcUrl).toBe('http://127.0.0.1:8545');
    expect(e2e.l1ExplorerUrl).toBe('off');
    expect(e2e.oldAppOrigin).toBe('http://localhost:4173');
    const attempt = (patch: Record<string, string>) => () =>
      loadSiteConfig({ ...base, mode: 'production', siteEnv: { ...siteEnv, ...patch } });
    expect(attempt({ VITE_ETH_RPC_URL: 'http://rpc.example' })).toThrow(/Ethereum RPC .* not https/);
    expect(attempt({ VITE_ETH_RPC_URL: 'https://127.0.0.1:8545' })).toThrow(/Ethereum RPC .* is local/);
    expect(attempt({ VITE_L1_EXPLORER_URL: 'http://etherscan.example' })).toThrow(
      /Ethereum explorer .* not https/,
    );
    expect(attempt({ VITE_OLD_APP_ORIGIN: 'http://v5.yacana.network' })).toThrow(/old app origin/);
    expect(attempt({ VITE_OLD_APP_ORIGIN: 'https://localhost' })).toThrow(/old app origin/);
    expect(attempt({ VITE_OLD_APP_ORIGIN: 'https://yacana.network' })).toThrow(/is the apex itself/);
    expect(attempt({ VITE_ETH_RPC_URL: '' })).toThrow(/VITE_ETH_RPC_URL is required/);
  });

  test('the old role takes its own preview suffix; a role is one of two words', () => {
    const old = loadSiteConfig({ ...base, mode: 'production', role: 'old' });
    expect(old.role).toBe('old');
    expect(old.previewHostSuffix).toBe('-yacana-v5.alejo-amiras.workers.dev');
    expect(viteDefine(old)['import.meta.env.VITE_APP_ROLE']).toBe('"old"');
    expect(loadSiteConfig({ ...base, mode: 'production' }).previewHostSuffix).toBe(
      '-yacana.alejo-amiras.workers.dev',
    );
    expect(() =>
      loadSiteConfig({
        ...base,
        mode: 'production',
        role: 'old',
        siteEnv: { ...siteEnv, VITE_PREVIEW_HOST_SUFFIX_OLD: '-yacana-v5.other.pages.dev' },
      }),
    ).toThrow(/preview host suffix/);
    expect(appRoleFrom(undefined)).toBe('apex');
    expect(appRoleFrom('old')).toBe('old');
    expect(() => appRoleFrom('legacy')).toThrow(/YACANA_APP_ROLE=/);
  });

  test("a continuation's first epoch floors the apps' reads; a genesis starts at 0", () => {
    const genesis = loadSiteConfig({ ...base, mode: 'production' });
    expect(genesis.firstEpoch).toBe(0);
    expect(viteDefine(genesis)['import.meta.env.VITE_FIRST_EPOCH']).toBe('"0"');
    const continuation = {
      firstEpoch: '7',
      sourceSeed: '0x1',
      sourceTarget: '5',
      source: 'deployments/old.json',
    };
    const continued = loadSiteConfig({
      ...base,
      mode: 'production',
      deployment: { ...deployment, continuation },
    });
    expect(continued.firstEpoch).toBe(7);
    expect(viteDefine(continued)['import.meta.env.VITE_FIRST_EPOCH']).toBe('"7"');
    // An e2e build may hand its own; production takes the record's whatever the environment says.
    expect(loadSiteConfig({ ...base, mode: 'e2e', env: { VITE_FIRST_EPOCH: '3' } }).firstEpoch).toBe(3);
    expect(loadSiteConfig({ ...base, mode: 'production', env: { VITE_FIRST_EPOCH: '3' } }).firstEpoch).toBe(
      0,
    );
    expect(() => loadSiteConfig({ ...base, mode: 'e2e', env: { VITE_FIRST_EPOCH: 'x' } })).toThrow(
      /first epoch/,
    );
  });

  test("the record's bridge and migration blocks travel as JSON; an e2e build may hand its own", () => {
    const bridge = {
      chainId: '11155111',
      portal: `0x${'be'.repeat(20)}`,
      yaca: `0x${'ca'.repeat(20)}`,
      registry: `0x${'ee'.repeat(20)}`,
      operators: `0x${'01'.repeat(20)}`,
      l1RpcUrl: 'https://rpc.example',
    };
    const migration = { toIndex: '1', announcedAt: '1790000000', expectedFlipAt: '1790600000' };
    const none = loadSiteConfig({
      ...base,
      mode: 'production',
      deployment: { ...deployment, bridge: undefined, migration: undefined },
    });
    expect(none.bridge).toBeNull();
    expect(none.migration).toBeNull();
    expect(viteDefine(none)['import.meta.env.VITE_BRIDGE']).toBe('""');
    expect(viteDefine(none)['import.meta.env.VITE_MIGRATION']).toBe('""');
    const recorded = loadSiteConfig({
      ...base,
      mode: 'production',
      deployment: { ...deployment, bridge, migration },
    });
    expect(recorded.bridge).toEqual(bridge);
    expect(recorded.migration).toEqual(migration);
    expect(JSON.parse(viteDefine(recorded)['import.meta.env.VITE_MIGRATION'] as string)).toBe(
      JSON.stringify(migration),
    );
    const handed = loadSiteConfig({
      ...base,
      mode: 'e2e',
      env: { VITE_BRIDGE: JSON.stringify(bridge), VITE_MIGRATION: JSON.stringify(migration) },
    });
    expect(handed.bridge?.portal).toBe(bridge.portal);
    expect(handed.migration?.toIndex).toBe('1');
    // An e2e run without a portal gets no bridge, whatever the profile's record carries.
    const throwaway = loadSiteConfig({
      ...base,
      mode: 'e2e',
      deployment: { ...deployment, bridge, migration },
      env: { VITE_BRIDGE: '', VITE_MIGRATION: '' },
    });
    expect(throwaway.bridge).toBeNull();
    expect(throwaway.migration).toBeNull();
    // Production never takes them from the environment: the record's block, or none, whatever the env says.
    const ignored = loadSiteConfig({
      ...base,
      mode: 'production',
      env: { VITE_BRIDGE: JSON.stringify(bridge) },
    });
    expect(ignored.bridge?.portal).not.toBe(bridge.portal);
    expect(ignored.bridge).toEqual(deployment.bridge ?? null);
    expect(() =>
      loadSiteConfig({
        ...base,
        mode: 'production',
        deployment: { ...deployment, migration: { ...migration, toIndex: 'one' } },
      }),
    ).toThrow(/toIndex/);
  });

  test("the record's lifecycle notes travel the same way, checked as a unix time and a boolean", () => {
    const lifecycle = { stoppedProvingAt: '1790700000', nodeRetired: true };
    expect(loadSiteConfig({ ...base, mode: 'production' }).lifecycle).toBeNull();
    const noted = loadSiteConfig({ ...base, mode: 'production', deployment: { ...deployment, lifecycle } });
    expect(noted.lifecycle).toEqual(lifecycle);
    expect(JSON.parse(viteDefine(noted)['import.meta.env.VITE_LIFECYCLE'] as string)).toBe(
      JSON.stringify(lifecycle),
    );
    expect(
      viteDefine(loadSiteConfig({ ...base, mode: 'production' }))['import.meta.env.VITE_LIFECYCLE'],
    ).toBe('""');
    expect(
      loadSiteConfig({ ...base, mode: 'e2e', env: { VITE_LIFECYCLE: JSON.stringify({ nodeRetired: true }) } })
        .lifecycle,
    ).toEqual({ nodeRetired: true });
    expect(() =>
      loadSiteConfig({
        ...base,
        mode: 'production',
        deployment: { ...deployment, lifecycle: { stoppedProvingAt: 'Sep 21' } },
      }),
    ).toThrow(/stoppedProvingAt/);
    expect(() =>
      loadSiteConfig({
        ...base,
        mode: 'production',
        deployment: { ...deployment, lifecycle: { nodeRetired: 'yes' as unknown as boolean } },
      }),
    ).toThrow(/nodeRetired/);
  });

  test('the mode is one of three words or an error, never a fourth mode by typo', () => {
    expect(siteModeFrom(undefined, 'production')).toBe('production');
    expect(siteModeFrom('', 'dev')).toBe('dev');
    expect(siteModeFrom('e2e', 'production')).toBe('e2e');
    for (const bad of ['Production', 'prod', 'e2e ', 'test'])
      expect(() => siteModeFrom(bad, 'production')).toThrow(/YACANA_SITE_MODE=/);
  });

  test('parseEnvFile ignores comments and rejects a line without a key', () => {
    expect(parseEnvFile('# c\nA=1\n\nB = x=y\n')).toEqual({ A: '1', B: 'x=y' });
    expect(() => parseEnvFile('=1')).toThrow(/malformed/);
  });
});
