// The Worker's backend under a revoke: one that lands while the prover is still being built ends in
// WASM with Presto's URLs never admitted, and one that lands on a native prover forgets them at once.
// The guard's verdict is read the way the SDK meets it: a fetch to Presto's health route.
import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Barretenberg } from '@aztec-foundation/bb.js';
import type { WorkArtifact } from '@yacana/miner-core/work';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import type { PrestoEndpoint } from '../src/presto.ts';
import { createProverLoop } from '../src/prover-loop.ts';
import { createWorkerBackend } from '../src/worker-backend.ts';
import type { FromWorker } from '../src/worker-protocol.ts';

const artifact = (await Bun.file(
  resolve(import.meta.dir, '../../../protocol/work-circuit/artifacts/yacana_work.json'),
).json()) as WorkArtifact;
const presto = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json({ status: 'ok' }) });
const endpoint: PrestoEndpoint = {
  host: '127.0.0.1',
  port: Number(presto.port),
  httpsPort: 1,
  httpsOnly: false,
};
const health = `http://127.0.0.1:${presto.port}/health`;
installNodeGuard();
afterAll(() => {
  presto.stop(true);
  uninstallNodeGuard();
});

/** Nothing here proves: the WASM backend is never asked to. */
const api = async () => ({ destroy: async () => {} }) as unknown as Barretenberg;

function backend(o: { holdArtifact?: boolean } = {}) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const posted: FromWorker[] = [];
  const b = createWorkerBackend({
    post: (m) => posted.push(m),
    async loadArtifact() {
      if (o.holdArtifact) await gate;
      return artifact;
    },
    api,
  });
  return { b, posted, release: () => release?.() };
}

const ready = (posted: FromWorker[]) => posted.find((m) => m.type === 'ready');

describe('the Worker backend under a revoke', () => {
  test('during the build: the prover is WASM and the guard never admits Presto', async () => {
    const { b, posted, release } = backend({ holdArtifact: true });
    const loop = createProverLoop(b, (m) => posted.push(m));
    const init = b.init({ threads: 2, presto: endpoint });
    loop.handle({ type: 'revoke' });
    release();
    await init;
    expect(ready(posted)).toMatchObject({ prover: 'wasm' });
    await expect(fetch(health)).rejects.toThrow(/blocked endpoint/);
    await b.destroy();
  });

  test('on a native prover: the URLs are forgotten at once and WASM is for good, with the reason', async () => {
    const { b, posted } = backend();
    const loop = createProverLoop(b, (m) => posted.push(m));
    await b.init({ threads: 2, presto: endpoint });
    expect(ready(posted)).toMatchObject({ prover: 'presto' });
    expect((await fetch(health)).status).toBe(200);
    loop.handle({ type: 'revoke' });
    expect(posted.at(-1)).toEqual({ type: 'prover', kind: 'wasm', sticky: true, reason: 'revoked' });
    await expect(fetch(health)).rejects.toThrow(/blocked endpoint/);
    await b.destroy();
  });
});
