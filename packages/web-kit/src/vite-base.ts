// The Vite configuration every app shares: the site config as `define`, the rendered headers on
// the dev/preview servers and in the build output, and the bb.js plumbing for the apps that prove.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin, Rollup, UserConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { faviconDataUrl } from '../../ui/src/mark.ts';
import {
  appRoleFrom,
  type DeploymentRecord,
  type ExampleClaim,
  loadSiteConfig,
  parseEnvFile,
  type SiteConfig,
  siteModeFrom,
  viteDefine,
} from './config.ts';
import { headerMap, renderHeaders } from './headers.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const shims = resolve(here, 'shims');

export interface SiteAppOptions {
  /** The app's directory (its `src/` is the `@` alias). */
  root: string;
  /** bb.js in the bundle: WASM-safe pre-bundling and module Workers. */
  prover: boolean;
  /** Served path of the app inside the origin; `/` for standalone servers. */
  base?: string;
}

/** An e2e build may fix the commit it shows: a screenshot baseline must not move with every commit. */
const sourceCommit = (env: NodeJS.ProcessEnv): string =>
  (env.YACANA_SITE_MODE === 'e2e' && env.VITE_SOURCE_COMMIT) ||
  (env.CF_PAGES_COMMIT_SHA ??
    env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());

/** Loads the config for the build at hand; an explicit `YACANA_SITE_MODE` overrides the command's default. */
export function siteConfig(command: 'build' | 'serve', env: NodeJS.ProcessEnv = process.env): SiteConfig {
  const mode = siteModeFrom(env.YACANA_SITE_MODE, command === 'serve' ? 'dev' : 'production');
  const profile = env.YACANA_PROFILE ?? 'testnet';
  const deployment = JSON.parse(
    readFileSync(resolve(repo, `deployments/${profile}.json`), 'utf8'),
  ) as DeploymentRecord;
  // The profile's recorded claim when there is one. An e2e build's deployment is a throwaway, so the
  // profile's claim is never its own: it ships the file `VITE_EXAMPLE_CLAIM` names, or none.
  const claimPath =
    mode === 'e2e'
      ? env.VITE_EXAMPLE_CLAIM && resolve(repo, env.VITE_EXAMPLE_CLAIM)
      : resolve(repo, `deployments/${profile}.example-claim.json`);
  const exampleClaim =
    claimPath && existsSync(claimPath) ? (JSON.parse(readFileSync(claimPath, 'utf8')) as ExampleClaim) : null;
  return loadSiteConfig({
    mode,
    siteEnv: parseEnvFile(readFileSync(resolve(repo, 'deployments/site.env'), 'utf8')),
    deployment,
    exampleClaim,
    env,
    role: appRoleFrom(env.YACANA_APP_ROLE),
    sourceCommit: sourceCommit(env),
    bbVersion: bbVersion(),
  });
}

/**
 * The installed bb.js version. The package exports no `./package.json`, and the first manifest above its
 * resolved entry is `dest/node-cjs/package.json` (`{"type":"commonjs"}`): walk up to the one that names it.
 */
export function bbVersion(): string {
  for (let dir = dirname(createRequire(import.meta.url).resolve('@aztec/bb.js')); ; dir = dirname(dir)) {
    if (dirname(dir) === dir) throw new Error('@aztec/bb.js resolved outside its package');
    const manifest = resolve(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name, version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: string;
      version?: string;
    };
    if (name !== '@aztec/bb.js') continue;
    if (!/^\d+\.\d+\.\d+/.test(version ?? ''))
      throw new Error(`@aztec/bb.js's manifest has no version: ${manifest}`);
    return version as string;
  }
}

/** The mark as every app's icon; the miner swaps in its status light at runtime, the others keep this one. */
const favicon = (): Plugin => ({
  name: 'yacana-favicon',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <link rel="icon" type="image/svg+xml" href="${faviconDataUrl('idle')}" />`,
    ),
});

/** The certificate an e2e run hands its previews (YACANA_E2E_TLS_CERT / _KEY), or nothing. */
const e2eTls = (): Pick<NonNullable<UserConfig['preview']>, 'https'> => {
  const cert = process.env.YACANA_E2E_TLS_CERT;
  const key = process.env.YACANA_E2E_TLS_KEY;
  return cert && key ? { https: { cert: readFileSync(cert), key: readFileSync(key) } } : {};
};

/** Writes `_headers` next to the bundle so `wrangler pages dev dist` serves the shipped policy. */
const emitHeaders = (text: string): Plugin => ({
  name: 'yacana-headers',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: '_headers', source: text });
  },
});

const reported = new Map<string, string>();

/** A page's report carries the app's name; a Worker's, its entry too: each is a build of its own. */
function reportFile(name: string, chunks: Rollup.OutputChunk[]): string {
  const entry = chunks.find((c) => c.isEntry);
  const file = name.endsWith('.worker') && entry ? `${name}.${entry.name}` : name;
  // Two Workers whose files share a name would share a report, and the second would erase the first.
  const source = entry?.facadeModuleId ?? file;
  const earlier = reported.get(file) ?? source;
  if (earlier !== source) throw new Error(`module report ${file} names both ${earlier} and ${source}`);
  reported.set(file, source);
  return file;
}

/**
 * With `YACANA_MODULE_REPORT=<dir>` (relative to the repo root, whatever the build's cwd), lists every
 * module that went into this bundle, one repo-relative id per line: what a page or the Worker actually
 * carries, which a hash cannot say and a successful build does not (the Node polyfills let a Node-only
 * module bundle quietly). Beside it, `.chunks.json`: each chunk's modules, static and dynamic imports
 * and size, which is what says whether a module waits for a lazy load or rides the first paint. Emits
 * nothing into the bundle.
 */
const moduleReport = (name: string): Plugin => ({
  name: 'yacana-module-report',
  generateBundle(_options, bundle) {
    if (!process.env.YACANA_MODULE_REPORT) return;
    const dir = resolve(repo, process.env.YACANA_MODULE_REPORT);
    const chunks = Object.values(bundle).filter((c): c is Rollup.OutputChunk => c.type === 'chunk');
    const idsOf = (c: Rollup.OutputChunk) =>
      Object.keys(c.modules).map((id) => id.replace(`${repo}/`, '').replace(/\?.*$/, ''));
    const file = reportFile(name, chunks);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${file}.txt`), `${[...new Set(chunks.flatMap(idsOf))].sort().join('\n')}\n`);
    const graph = chunks.map((c) => ({
      file: c.fileName,
      entry: c.isEntry,
      modules: idsOf(c).sort(),
      imports: c.imports,
      dynamicImports: c.dynamicImports,
      bytes: Buffer.byteLength(c.code),
    }));
    writeFileSync(resolve(dir, `${file}.chunks.json`), `${JSON.stringify(graph, null, 1)}\n`);
  },
});

export function siteVite(app: SiteAppOptions): (ctx: { command: 'build' | 'serve' }) => UserConfig {
  return ({ command }) => {
    const reportName = basename(app.root);
    const config = siteConfig(command);
    // An e2e build previews under production's headers plus the local node forms; production alone ships.
    const shipped = headerMap({ mode: config.mode === 'production' ? 'production' : 'e2e' });
    const dev = headerMap({ mode: 'dev' });
    const proverConfig: UserConfig = app.prover
      ? {
          resolve: {
            alias: [
              // pino probes detect-node at import time; the shim keeps it on the browser build.
              { find: 'detect-node', replacement: resolve(shims, 'detect-node.ts') },
            ],
            // A second nested copy of either WASM binding leaves initAbi() and abiEncode() in
            // different module scopes, so the WASM instance never resolves.
            dedupe: ['@aztec/noir-noirc_abi', '@aztec/noir-acvm_js'],
          },
          optimizeDeps: {
            include: [
              'pino',
              'pino/browser',
              '@aztec/bb.js > comlink',
              '@aztec/bb.js > idb-keyval',
              '@aztec/bb.js > msgpackr',
              '@aztec/bb.js > pako',
              '@aztec/noir-noir_js > pako',
            ],
            // WASM loaders resolve their binaries relative to import.meta.url, which pre-bundling
            // would rewrite to a chunk that has none of them.
            exclude: ['@aztec/bb.js', '@aztec/noir-acvm_js', '@aztec/noir-noirc_abi', '@aztec/noir-noir_js'],
          },
          worker: { format: 'es', plugins: () => [moduleReport(`${reportName}.worker`)] },
        }
      : {
          resolve: {
            // aztec.js reaches the proving packages through lazy imports; a page that never proves
            // resolves them to a stub, so its bundle cannot carry them and a reach fails loudly.
            alias: [/^@aztec\/bb\.js(\/|$)/, /^@aztec\/noir-(acvm_js|noirc_abi|noir_js)(\/|$)/].map(
              (find) => ({
                find,
                replacement: resolve(here, 'browser/no-prover.ts'),
              }),
            ),
          },
        };
    return {
      base: app.base ?? '/',
      // The assembly materialises the shared assets once at the origin's root; an app's own
      // `public/` copies (CRS, artifacts, slots) must not land under its base as well.
      ...(process.env.YACANA_ASSEMBLE === '1' && { publicDir: false }),
      define: viteDefine(config),
      plugins: [
        react(),
        tailwindcss(),
        // Every app imports aztec.js (fields, addresses, the node client), which reads Buffer and
        // process at import time; only the provers need the bb.js Worker plumbing above.
        nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
        emitHeaders(renderHeaders({ mode: config.mode === 'production' ? 'production' : 'e2e' })),
        favicon(),
        moduleReport(reportName),
      ],
      server: { headers: dev, fs: { allow: [repo] } },
      // An e2e preview answers any host name, over TLS when a case brings a certificate: the rig's
      // origin case reaches the apps as made-up domains, which WebAuthn accepts only from https.
      preview: {
        headers: shipped,
        ...(config.mode === 'e2e' ? { allowedHosts: true, ...e2eTls() } : {}),
      },
      ...proverConfig,
      resolve: {
        ...proverConfig.resolve,
        alias: [
          { find: '@', replacement: resolve(app.root, 'src') },
          ...((proverConfig.resolve?.alias as []) ?? []),
        ],
      },
      // No inlined assets: the CSP allows fonts (and everything else) from the origin only, and
      // Vite would otherwise turn the small font subsets into data: URLs the policy blocks.
      build: { target: 'esnext', sourcemap: false, chunkSizeWarningLimit: 4096, assetsInlineLimit: 0 },
    };
  };
}
