// Three apps into one origin (`/`, `/mine/`, `/stats/`), the shared assets once at the root,
// `_headers`, `_redirects`, `build.json`. `bun run site:build` → apps/site/dist (the apex
// Worker) or, under YACANA_APP_ROLE=old, apps/site/dist-old (the versioned origin's Worker,
// v5/wrangler.jsonc: the miner alone, at `/`); an e2e run passes its own out dir.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AppRole, appRoleFrom, type SiteConfig } from '@yacana/web-kit/config';
import { renderHeaders } from '@yacana/web-kit/headers';
import { copyArtifacts } from '@yacana/web-kit/scripts/copy-artifacts';
import { copySlots } from '@yacana/web-kit/scripts/copy-slots';
import { fetchCrs } from '@yacana/web-kit/scripts/fetch-crs';
import { siteConfig } from '@yacana/web-kit/vite-base';
import type { Route as MinerRoute } from '@yacana/web-miner/routes';
import type { Route as StatsRoute } from '@yacana/web-stats/routes';
import { assertProductionArtifact } from './artifact.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
export const PRODUCTION_OUT = resolve(here, '../dist');
/** The old role's assembly: what the versioned origin's Worker (`v5/wrangler.jsonc`) serves. */
export const OLD_OUT = resolve(here, '../dist-old');
/** Each role's production directory; a production build lands in its own and nowhere else. */
export const productionOutFor = (role: AppRole): string => (role === 'old' ? OLD_OUT : PRODUCTION_OUT);

/** Where each app lands; the landing goes first because emptying `/` would delete the nested apps. */
export const APPS = [
  { name: 'web-landing', base: '/' },
  { name: 'web-miner', base: '/mine/' },
  { name: 'web-stats', base: '/stats/' },
] as const;
/** The old origin's one app: nothing to mine on, no stats of a retired version, the FAQ on the apex. */
export const OLD_APPS = [{ name: 'web-miner', base: '/' }] as const;
export const appsFor = (role: AppRole): readonly { name: string; base: string }[] =>
  role === 'old' ? OLD_APPS : APPS;

/**
 * The witness archives the operator commits (`deployments/witnesses/*.jsonl`: one file per profile,
 * every version of that profile in it), served as `/witnesses/<version>.jsonl`: each line goes to
 * the file of the version it names, so a later version's page reads an earlier version's settled
 * exits from here once that version's node is gone. A line without a version number fails the build.
 */
export function witnessFiles(repoDir: string): { to: string; lines: string[] }[] {
  const dir = resolve(repoDir, 'deployments/witnesses');
  if (!existsSync(dir)) return [];
  const byVersion = new Map<string, string[]>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()) {
    for (const line of readFileSync(resolve(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const { version } = JSON.parse(line) as { version?: unknown };
      if (typeof version !== 'string' || !/^\d+$/.test(version))
        throw new Error(`deployments/witnesses/${file}: an archive line without a version number`);
      const lines = byVersion.get(version) ?? [];
      lines.push(line);
      byVersion.set(version, lines);
    }
  }
  return [...byVersion]
    .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1))
    .map(([version, lines]) => ({ to: `witnesses/${version}.jsonl`, lines }));
}

/**
 * The nested apps' deep links as exact 200 rewrites to each app's directory: Cloudflare evaluates
 * `_redirects` before static assets (a wildcard would shadow the app's bundle) and turns an
 * `.html` target into a canonical 308. Each with its trailing slash too, which the routers read alike
 * and which would otherwise fall through to the landing.
 */
const MINER_LINKS: Record<Exclude<MinerRoute, 'mine'>, true> = {
  wallet: true,
  settings: true,
  stats: true,
  'stats/bridge': true,
  'stats/verify': true,
};
/** The old origin's miner has no stats pages. */
const OLD_LINKS = ['wallet', 'settings'] as const satisfies readonly (keyof typeof MINER_LINKS)[];
const STATS_LINKS: Record<Exclude<StatsRoute, 'stats'>, true> = { verify: true, bridge: true };
const both = (path: string, to: string): string[] => [`${path} ${to} 200`, `${path}/ ${to} 200`];
export const REDIRECTS = [
  ...Object.keys(MINER_LINKS).flatMap((r) => both(`/mine/${r}`, '/mine/')),
  ...Object.keys(STATS_LINKS).flatMap((r) => both(`/stats/${r}`, '/stats/')),
  ...both('/verify', '/stats/'),
];
/** The old origin's: the version's old bookmarks (`/mine/`, its deep links) land on the one app at `/`. */
export const OLD_REDIRECTS = [
  '/mine / 200',
  '/mine/ / 200',
  ...OLD_LINKS.flatMap((r) => [`/mine/${r} / 200`, `/${r} / 200`]),
];
export const redirectsFor = (role: AppRole): readonly string[] =>
  role === 'old' ? OLD_REDIRECTS : REDIRECTS;

export interface BuildRecord {
  mode: SiteConfig['mode'];
  commit: string;
  /** The default node's origin; a user may point the pages elsewhere from the miner's settings. */
  nodeOrigin: string;
  rpId: string;
  /** `apex`, or `old` for the versioned origin a retired version's last build moves to. */
  role: AppRole;
  /** The deployment this build carries: an open tab compares them to learn it is behind a redeploy. */
  rollupVersion: string;
  miner: string;
}

export const buildRecord = (c: SiteConfig): BuildRecord => ({
  mode: c.mode,
  commit: c.sourceCommit,
  nodeOrigin: new URL(c.nodeUrl).origin,
  rpId: c.rpId,
  role: c.role,
  rollupVersion: c.rollupVersion,
  miner: c.miner,
});

/** An app's bundle without its `public/` copies: the shared assets are materialised once at the root. */
function buildApp(name: string, base: string, outDir: string, env: NodeJS.ProcessEnv): void {
  execFileSync('bunx', ['vite', 'build', '--base', base, '--outDir', outDir, '--emptyOutDir'], {
    cwd: resolve(repo, 'apps', name),
    stdio: 'inherit',
    env: { ...env, YACANA_ASSEMBLE: '1' },
  });
}

/** The minutes-long steps of an assembly, replaceable so a test can drive the rest in milliseconds. */
export interface AssemblySteps {
  buildApp: typeof buildApp;
  fetchCrs: typeof fetchCrs;
  copyArtifacts: typeof copyArtifacts;
  copySlots: typeof copySlots;
}
const STEPS: AssemblySteps = { buildApp, fetchCrs, copyArtifacts, copySlots };

export async function assemble(
  outDir: string,
  env: NodeJS.ProcessEnv = process.env,
  steps: AssemblySteps = STEPS,
): Promise<BuildRecord> {
  const out = resolve(outDir);
  // The config is loaded once here so a production build fails before any app is built.
  const config = siteConfig('build', env);
  // What Cloudflare serves is a role's directory of a Cloudflare build: none may hold anything but production.
  if (config.mode !== 'production' && (out === PRODUCTION_OUT || out === OLD_OUT || env.CF_PAGES))
    throw new Error(`a ${config.mode} build may not land in ${out}: production builds only`);
  // Fail closed on the pairing: the apex Worker must never ship the old app, nor the old Worker the apex.
  if (config.mode === 'production' && out !== productionOutFor(config.role))
    throw new Error(
      `a production ${config.role} build lands in ${productionOutFor(config.role)}, not ${out}: the roles' Workers serve different directories`,
    );
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const app of appsFor(config.role))
    steps.buildApp(app.name, app.base, resolve(out, app.base.slice(1)), env);
  await steps.fetchCrs(out);
  await steps.copyArtifacts(out);
  console.log(await steps.copySlots(out));
  // The landing's card; the old origin has no landing.
  if (config.role === 'apex') cpSync(resolve(repo, 'apps/web-landing/public/og.png'), resolve(out, 'og.png'));
  for (const w of witnessFiles(repo)) {
    mkdirSync(resolve(out, 'witnesses'), { recursive: true });
    writeFileSync(resolve(out, w.to), `${w.lines.join('\n')}\n`);
  }
  writeFileSync(
    resolve(out, '_headers'),
    renderHeaders({ mode: config.mode === 'production' ? 'production' : 'e2e' }),
  );
  writeFileSync(resolve(out, '_redirects'), `${redirectsFor(config.role).join('\n')}\n`);
  const record = buildRecord(config);
  writeFileSync(resolve(out, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
  if (config.mode === 'production') assertProductionArtifact(out, config);
  return record;
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? productionOutFor(appRoleFrom(process.env.YACANA_APP_ROLE)));
  const record = await assemble(out);
  console.log(`site: ${record.mode} build of ${record.commit.slice(0, 7)} in ${out}`);
}
