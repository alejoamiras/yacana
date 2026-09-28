import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { SiteConfig } from '@yacana/web-kit/config';
import {
  type AssemblySteps,
  assemble,
  buildRecord,
  OLD_OUT,
  OLD_REDIRECTS,
  PRODUCTION_OUT,
  productionOutFor,
  REDIRECTS,
  witnessFiles,
} from './assemble.ts';

/** Every app's build writes one script where Vite would; the asset copies do nothing. */
const stubbed = (script: string): AssemblySteps => ({
  buildApp: (_name, _base, outDir) => {
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    writeFileSync(join(outDir, 'assets/index-abc.js'), script);
  },
  fetchCrs: async () => {},
  copyArtifacts: async () => {},
  copySlots: async () => 'slots: stubbed',
});

const outs: string[] = [];
const scratch = () => {
  const o = mkdtempSync(join(tmpdir(), 'yacana-assemble-'));
  outs.push(o);
  return o;
};
afterEach(() => {
  for (const o of outs.splice(0)) rmSync(o, { recursive: true, force: true });
});

describe('assembly inspects what it emitted', () => {
  const production = { YACANA_SITE_MODE: 'production', GITHUB_SHA: 'abc' };

  test('a clean production assembly completes, in its role’s directory only', async () => {
    const steps = stubbed('fetch("https://node.example/rpc")');
    // The role directories are real deliverables: they are asserted on the pairing, never written by a test.
    await expect(assemble(scratch(), production, steps)).rejects.toThrow(/a production apex build lands in/);
    await expect(assemble(scratch(), { ...production, YACANA_APP_ROLE: 'old' }, steps)).rejects.toThrow(
      /a production old build lands in .*dist-old/,
    );
    expect(productionOutFor('apex')).toBe(PRODUCTION_OUT);
    expect(productionOutFor('old')).toBe(OLD_OUT);
    expect(OLD_OUT).not.toBe(PRODUCTION_OUT);
  });

  test('a production assembly whose emitted script names a loopback origin fails', async () => {
    const steps = stubbed('const node = "http://127.0.0.1:24567/rpc"');
    await expect(assemble(PRODUCTION_OUT, production, steps)).rejects.toThrow(
      /names a plaintext loopback origin/,
    );
  });

  test('an e2e assembly into its own directory is held to no production contract', async () => {
    const steps = stubbed('const node = "http://127.0.0.1:24567/rpc"');
    await expect(
      assemble(scratch(), { YACANA_SITE_MODE: 'e2e', GITHUB_SHA: 'abc' }, steps),
    ).resolves.toMatchObject({ mode: 'e2e' });
  });

  test('the old role assembles the miner alone at the root, with its own rewrites and no landing card', async () => {
    const built: string[] = [];
    const steps = stubbed('fetch("https://node.example/rpc")');
    steps.buildApp = (name, base, outDir) => {
      built.push(`${name}@${base}`);
      mkdirSync(join(outDir, 'assets'), { recursive: true });
      writeFileSync(join(outDir, 'assets/index-abc.js'), '');
    };
    const out = scratch();
    await assemble(out, { YACANA_SITE_MODE: 'e2e', GITHUB_SHA: 'abc', YACANA_APP_ROLE: 'old' }, steps);
    expect(built).toEqual(['web-miner@/']);
    expect(readFileSync(join(out, '_redirects'), 'utf8')).toBe(`${OLD_REDIRECTS.join('\n')}\n`);
    expect(existsSync(join(out, 'og.png'))).toBe(false);
    expect(existsSync(join(out, 'mine'))).toBe(false);
  });
});

describe('assembly', () => {
  test('the witness archives are served by the version each line names, whatever file it came from', () => {
    const repoDir = scratch();
    const dir = join(repoDir, 'deployments/witnesses');
    mkdirSync(dir, { recursive: true });
    const line = (version: string, index: number) => JSON.stringify({ version, index, kind: 2 });
    writeFileSync(join(dir, 'testnet.jsonl'), `${line('5', 0)}\n${line('6', 0)}\n\n${line('5', 1)}\n`);
    writeFileSync(join(dir, 'other.jsonl'), `${line('6', 1)}\n`);
    writeFileSync(join(dir, 'notes.txt'), 'not an archive');
    // Files are read in name order, lines kept in the order met; the outputs come by version.
    expect(witnessFiles(repoDir)).toEqual([
      { to: 'witnesses/5.jsonl', lines: [line('5', 0), line('5', 1)] },
      { to: 'witnesses/6.jsonl', lines: [line('6', 1), line('6', 0)] },
    ]);
    writeFileSync(join(dir, 'broken.jsonl'), '{"index":2}\n');
    expect(() => witnessFiles(repoDir)).toThrow(/broken\.jsonl: an archive line without a version number/);
    expect(witnessFiles(join(repoDir, 'nowhere'))).toEqual([]);
  });

  test('the rewrites are exact sources to directory targets, each with its trailing slash: no splat, no .html', () => {
    expect(REDIRECTS).toEqual(
      [
        '/mine/wallet /mine/',
        '/mine/settings /mine/',
        '/mine/stats /mine/',
        '/mine/stats/bridge /mine/',
        '/mine/stats/verify /mine/',
        '/stats/verify /stats/',
        '/stats/bridge /stats/',
        '/verify /stats/',
      ].flatMap((rule) => {
        const [path, to] = rule.split(' ');
        return [`${path} ${to} 200`, `${path}/ ${to} 200`];
      }),
    );
    for (const rule of REDIRECTS) expect(rule).toMatch(/^\/[a-z/]+ \/(mine|stats)\/ 200$/);
    // The old origin: the version's bookmarks from its apex days land on the one app, which has no stats.
    expect(OLD_REDIRECTS).toEqual([
      '/mine / 200',
      '/mine/ / 200',
      '/mine/wallet / 200',
      '/wallet / 200',
      '/mine/settings / 200',
      '/settings / 200',
    ]);
    for (const rule of OLD_REDIRECTS) expect(rule).toMatch(/^\/[a-z/]+ \/ 200$/);
  });

  test('a mode that is not one of the three is refused before anything is built', async () => {
    await expect(assemble('/tmp/never-written', { YACANA_SITE_MODE: 'Production' })).rejects.toThrow(
      /YACANA_SITE_MODE="Production"/,
    );
  });

  test('an e2e build can land neither in a production directory nor on Cloudflare', async () => {
    await expect(assemble(PRODUCTION_OUT, { YACANA_SITE_MODE: 'e2e' })).rejects.toThrow(
      /production builds only/,
    );
    await expect(assemble(OLD_OUT, { YACANA_SITE_MODE: 'e2e', YACANA_APP_ROLE: 'old' })).rejects.toThrow(
      /production builds only/,
    );
    await expect(
      assemble(relative(process.cwd(), PRODUCTION_OUT), { YACANA_SITE_MODE: 'e2e' }),
    ).rejects.toThrow(/production builds only/);
    await expect(assemble('/tmp/never-written', { YACANA_SITE_MODE: 'e2e', CF_PAGES: '1' })).rejects.toThrow(
      /production builds only/,
    );
  });

  test('build.json says what was built and nothing more: the role and the deployment beside the mode', () => {
    const c = {
      mode: 'production',
      sourceCommit: 'abc',
      rpId: 'yacana.network',
      nodeUrl: 'https://node.example',
      role: 'old',
      rollupVersion: '5',
      miner: '0xabc',
    } as SiteConfig;
    expect(buildRecord(c)).toEqual({
      mode: 'production',
      commit: 'abc',
      nodeOrigin: 'https://node.example',
      rpId: 'yacana.network',
      role: 'old',
      rollupVersion: '5',
      miner: '0xabc',
    });
  });
});
