// The prover against a fake Presto on loopback: what it sends, when it sticks to WASM, when it
// gives native another chance, and that a winning native proof is verified against the job's own
// public inputs. WASM proofs are real (bb.js in this process), so the suite proves W a few times.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { BackendType, Barretenberg } from '@aztec-foundation/bb.js';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { PROOF_FIELDS } from '@yacana/miner-core/proof';
import type { WorkArtifact, WorkInputs } from '@yacana/miner-core/work';
import crsLock from '@yacana/web-kit/crs.lock.json';
import { bbVersion } from '@yacana/web-kit/vite-base';
import { W_VK_BYTES } from '@yacana/work-circuit/generated/vk';
import {
  acceleratorUrls,
  PRESTO_AZTEC_VERSION,
  type PrestoEndpoint,
  type ProverKind,
} from '../src/presto.ts';
import { BB_VERSION, PrestoWorkProver, type ProverTransition } from '../src/presto-prover.ts';

const circuit = resolve(import.meta.dir, '../../../protocol/work-circuit');
const artifact = (await Bun.file(resolve(circuit, 'artifacts/yacana_work.json')).json()) as WorkArtifact;
// Prover.toml's inputs and the proof bb made of them, committed beside the VK.
const FIXTURE: WorkInputs = {
  domain: new Fr(1n),
  seed: new Fr(2n),
  epoch: 0n,
  minerCommit: new Fr(3n),
  nonce: 4n,
};
const fixtureProof = new Uint8Array(
  await Bun.file(resolve(circuit, 'fixtures/yacana_work/proof')).arrayBuffer(),
);
const fixtureInputs = new Uint8Array(
  await Bun.file(resolve(circuit, 'fixtures/yacana_work/public_inputs')).arrayBuffer(),
);
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

// A literal left behind by an SDK bump would ask Presto for a prover whose proofs differ from WASM's.
test('the bb release Presto is asked for is the installed bb.js', () => {
  expect(BB_VERSION).toBe(bbVersion());
  expect(PRESTO_AZTEC_VERSION).toBe(bbVersion());
});

type Answer = { status: number; body: unknown } | 'fixture';

/** One fake per suite: `/health` says a current Presto; `/prove/ultra-honk` answers from the script. */
function fakePresto() {
  const requests: { path: string; body: Record<string, unknown> | null }[] = [];
  const script: Answer[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : null;
      requests.push({ path, body });
      if (path === '/health')
        return Response.json({
          status: 'ok',
          api_version: 1,
          schemes: ['chonk', 'ultra_honk'],
          version: '1.2.1',
          aztec_version: '6.0.0',
          available_versions: ['6.0.0'],
          versions: [{ aztec_version: '6.0.0', bb_version: '6.0.0' }],
          bb_available: true,
        });
      const next = script.shift();
      if (next === undefined) return Response.json({ error: 'unscripted' }, { status: 500 });
      if (next === 'fixture')
        return Response.json({ proof: b64(fixtureProof), public_inputs: b64(fixtureInputs) });
      return Response.json(next.body, { status: next.status });
    },
  });
  const endpoint: PrestoEndpoint = {
    host: '127.0.0.1',
    port: Number(server.port),
    httpsPort: 1,
    httpsOnly: false,
  };
  return { server, requests, script, endpoint, proves: () => requests.filter((r) => r.path !== '/health') };
}

const api = () =>
  Barretenberg.new({ threads: Math.max(1, cpus().length - 1), backend: BackendType.WasmWorker });

function prover(endpoint: PrestoEndpoint) {
  const transitions: { kind: ProverKind; t: ProverTransition }[] = [];
  const counts = { verified: 0 };
  const p = new PrestoWorkProver(artifact, api, endpoint, {
    prover: (kind, t) => transitions.push({ kind, t }),
    verified: () => counts.verified++,
  });
  return { p, transitions, counts };
}

const pkg = resolve(import.meta.dir, '..');
const CRS_HOSTS = new Set(crsLock.hosts);

/** The pinned asset this request is for, or null for anything that is not the CRS. */
function crsAsset(input: RequestInfo | URL): string | null {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  const name = url.pathname.slice(1);
  return CRS_HOSTS.has(url.origin) && name in crsLock.files ? name : null;
}

/** bb.js takes the prefix it needs; the pinned file is exactly the length the app pins. */
function ranged(bytes: Uint8Array, init: RequestInit | undefined): Response {
  const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)?$/);
  const total = bytes.length;
  if (!range) return new Response(bytes.slice().buffer as ArrayBuffer);
  const start = Number(range[1]);
  const end = range[2] === undefined ? total : Math.min(total, Number(range[2]) + 1);
  return new Response(bytes.slice(start, end).buffer as ArrayBuffer, {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end - 1}/${total}` },
  });
}

/**
 * bb.js asks Aztec's CDN for the proving keys before it can prove in WASM, and only reads its own
 * disk cache on a machine that already has one — so the WASM proofs below passed on a warm machine
 * and died at the guard on a cold one. This answers those requests from the pinned CRS the app
 * serves, fetched through the repo's own script and checked against the same lock.
 */
function serveCrs(): () => void {
  const under = globalThis.fetch;
  const files = new Map<string, Uint8Array>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = crsAsset(input);
    if (!name) return under(input, init);
    let bytes = files.get(name);
    if (!bytes) {
      bytes = new Uint8Array(await Bun.file(resolve(pkg, 'public/crs', name)).arrayBuffer());
      files.set(name, bytes);
    }
    return ranged(bytes, init);
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = under;
  };
}

let fake: ReturnType<typeof fakePresto>;
let stopCrs: (() => void) | undefined;
beforeAll(async () => {
  fake = fakePresto();
  // Another suite in this process may have armed the node guard over `fetch`: admit the fake as the
  // Worker admits Presto, or the SDK's requests die at the guard and every test reads as `network`.
  const guard = await import('@yacana/web-kit/browser/node-guard');
  guard.setAcceleratorEndpoints(acceleratorUrls(fake.endpoint), 60_000);
  // In its own process: by now `fetch` in this one may be the guard, or the miner's CRS interceptor
  // over it, and the download would be turned into a page request no one here can answer.
  const script = Bun.resolveSync('@yacana/web-kit/scripts/fetch-crs', pkg);
  const fetched = Bun.spawnSync(['bun', script, resolve(pkg, 'public')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!fetched.success) throw new Error(`the pinned CRS could not be fetched: ${fetched.stderr.toString()}`);
  stopCrs = serveCrs();
}, 120_000);

afterAll(() => {
  stopCrs?.();
  fake?.server.stop(true);
});

describe('PrestoWorkProver', () => {
  test('sends the circuit, the witness and the pinned VK; a native answer is the proof, native is reported once', async () => {
    fake.script.push('fixture', 'fixture');
    const { p, transitions } = prover(fake.endpoint);
    try {
      const first = await p.prove(FIXTURE);
      const second = await p.prove(FIXTURE);
      expect(Buffer.from(first.proof).equals(Buffer.from(fixtureProof))).toBe(true);
      expect(second.proof.length).toBe(PROOF_FIELDS * 32);
      const sent = fake.proves()[0]?.body ?? {};
      expect(sent.bytecode).toBe(artifact.bytecode);
      expect(sent.verifier_target).toBe('noir-recursive-no-zk');
      expect(Buffer.from(String(sent.vk), 'base64').equals(Buffer.from(W_VK_BYTES))).toBe(true);
      // The witness travels gzip-encoded, as the route expects.
      expect(Buffer.from(String(sent.witness), 'base64').subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
      expect(transitions).toEqual([{ kind: 'presto', t: { sticky: false } }]);
      expect(p.active).toBe('presto');
      expect(p.lastProver).toBe('presto');
    } finally {
      await p.destroy();
    }
  }, 120_000);

  test('a winning native proof verifies against the job’s own public inputs; a corrupted one does not', async () => {
    fake.script.push('fixture');
    const { p } = prover(fake.endpoint);
    try {
      // A copy of the bytes: `prove()` already verified this build's first proof, and would trust the object itself.
      const proved = await p.prove(FIXTURE);
      const result = { ...proved, proof: new Uint8Array(proved.proof) };
      const t0 = performance.now();
      expect(await p.verifyWin(FIXTURE, result)).toBe(true);
      console.log(`verifyWin of a copy ${(performance.now() - t0).toFixed(0)} ms`);
      const flipped = new Uint8Array(result.proof);
      flipped[100] ^= 1;
      expect(await p.verifyWin(FIXTURE, { ...result, proof: flipped })).toBe(false);
      expect(await p.verifyWin({ ...FIXTURE, nonce: 5n }, result)).toBe(false);
    } finally {
      await p.destroy();
    }
  }, 180_000);

  test('a denial sticks: one WASM proof with the reason, and no further request to Presto', async () => {
    fake.script.push({ status: 403, body: { error: 'origin_denied', message: 'denied' } });
    const { p, transitions } = prover(fake.endpoint);
    try {
      const before = fake.proves().length;
      const a = await p.prove(FIXTURE);
      const b = await p.prove(FIXTURE);
      expect(a.proof.length).toBe(PROOF_FIELDS * 32);
      expect(Buffer.from(a.proof).equals(Buffer.from(b.proof))).toBe(true); // WASM is deterministic on one witness
      expect(fake.proves().length - before).toBe(1);
      expect(transitions).toEqual([{ kind: 'wasm', t: { sticky: true, reason: 'denied' } }]);
      expect(p.active).toBe('wasm');
      expect(p.lastProver).toBe('wasm');
    } finally {
      await p.destroy();
    }
  }, 180_000);

  test('a busy Presto gets three chances: WASM for that nonce, native next, sticky on the third in a row', async () => {
    const busy = { status: 429, body: { error: 'origin_queue_full', message: 'busy' } };
    fake.script.push(busy, 'fixture', busy, busy, busy);
    const { p, transitions } = prover(fake.endpoint);
    try {
      const before = fake.proves().length;
      await p.prove(FIXTURE); // busy → WASM, one chance used
      // Native is still what proves next, but this proof was WASM's: provenance follows the proof.
      expect([p.active, p.lastProver]).toEqual(['presto', 'wasm']);
      await p.prove(FIXTURE); // native again, the count resets
      expect(p.lastProver).toBe('presto');
      await p.prove(FIXTURE); // busy
      await p.prove(FIXTURE); // busy
      await p.prove(FIXTURE); // busy: sticky
      await p.prove(FIXTURE); // WASM, no request
      expect(fake.proves().length - before).toBe(5);
      expect(transitions.map((x) => [x.kind, x.t.sticky, x.t.reason])).toEqual([
        ['wasm', false, undefined],
        ['presto', false, undefined],
        ['wasm', false, undefined],
        ['wasm', true, 'transient'],
      ]);
    } finally {
      await p.destroy();
    }
  }, 300_000);

  test('a proof of the right length with an element above the modulus never reaches the digest: sticky, malformed', async () => {
    fake.script.push({
      status: 200,
      body: { proof: b64(new Uint8Array(PROOF_FIELDS * 32).fill(0xff)), public_inputs: b64(fixtureInputs) },
    });
    const { p, transitions } = prover(fake.endpoint);
    try {
      const r = await p.prove(FIXTURE);
      expect(r.proof.length).toBe(PROOF_FIELDS * 32);
      expect(transitions).toEqual([{ kind: 'wasm', t: { sticky: true, reason: 'malformed-response' } }]);
      // And the verifier's own throw on such bytes is a false, not an exception, for the Worker.
      expect(await p.verifyWin(FIXTURE, { ...r, proof: new Uint8Array(PROOF_FIELDS * 32).fill(0xff) })).toBe(
        false,
      );
    } finally {
      await p.destroy();
    }
  }, 180_000);

  test('a well-formed answer of the wrong length sticks as malformed', async () => {
    fake.script.push({
      status: 200,
      body: { proof: b64(new Uint8Array(64)), public_inputs: b64(fixtureInputs) },
    });
    const { p, transitions } = prover(fake.endpoint);
    try {
      const r = await p.prove(FIXTURE);
      expect(r.proof.length).toBe(PROOF_FIELDS * 32);
      expect(transitions).toEqual([{ kind: 'wasm', t: { sticky: true, reason: 'malformed-response' } }]);
    } finally {
      await p.destroy();
    }
  }, 180_000);
});

describe('the first native proof of a build', () => {
  test('is verified once and reported; later proofs are not; a win on that very proof needs no second check; a new build verifies again', async () => {
    fake.script.push('fixture', 'fixture', 'fixture');
    const { p, transitions, counts } = prover(fake.endpoint);
    try {
      const first = await p.prove(FIXTURE);
      expect(counts.verified).toBe(1);
      const second = await p.prove(FIXTURE);
      expect(counts.verified).toBe(1);
      expect(transitions).toEqual([{ kind: 'presto', t: { sticky: false } }]);
      // Identity, not bytes: the object `prove()` verified is trusted as is; a copy goes through the verifier.
      expect(await p.verifyWin({ ...FIXTURE, nonce: 5n }, first)).toBe(true);
      expect(await p.verifyWin({ ...FIXTURE, nonce: 5n }, second)).toBe(false);
    } finally {
      await p.destroy();
    }
    const rebuilt = prover(fake.endpoint);
    try {
      await rebuilt.p.prove(FIXTURE);
      expect(rebuilt.counts.verified).toBe(1);
    } finally {
      await rebuilt.p.destroy();
    }
  }, 240_000);

  test('one that does not verify: sticky as invalid, the same witness proved in WASM, no further request', async () => {
    const bad = new Uint8Array(fixtureProof);
    bad[100] ^= 1;
    fake.script.push({ status: 200, body: { proof: b64(bad), public_inputs: b64(fixtureInputs) } });
    const { p, transitions, counts } = prover(fake.endpoint);
    try {
      const before = fake.proves().length;
      const r = await p.prove(FIXTURE);
      expect(Buffer.from(r.proof).equals(Buffer.from(bad))).toBe(false);
      expect(await p.verifyWin(FIXTURE, r)).toBe(true); // WASM's proof of the same inputs
      expect(counts.verified).toBe(0);
      expect(transitions).toEqual([{ kind: 'wasm', t: { sticky: true, reason: 'invalid-proof' } }]);
      await p.prove(FIXTURE);
      expect(fake.proves().length - before).toBe(1);
      expect(p.lastProver).toBe('wasm');
    } finally {
      await p.destroy();
    }
  }, 240_000);

  test('a revoke while the witness is being prepared: it never leaves, and nothing native is announced', async () => {
    const { p, transitions, counts } = prover(fake.endpoint);
    try {
      const before = fake.proves().length;
      const proving = p.prove(FIXTURE);
      p.forceLocal('revoked');
      const r = await proving;
      expect(r.proof.length).toBe(PROOF_FIELDS * 32);
      await p.prove(FIXTURE);
      expect(fake.proves().length - before).toBe(0);
      expect(transitions).toEqual([{ kind: 'wasm', t: { sticky: true, reason: 'revoked' } }]);
      expect(counts.verified).toBe(0);
    } finally {
      await p.destroy();
    }
  }, 240_000);

  test('a revoke still queued as a message when the witness is ready: the queue gets its turn first', async () => {
    fake.script.push({ status: 200, body: { proof: b64(fixtureProof), public_inputs: b64(fixtureInputs) } });
    const { p } = prover(fake.endpoint);
    try {
      await p.prove(FIXTURE); // warm: the next execute has nothing left to load
      const before = fake.proves().length;
      // As the Worker receives it: a task, not a call, behind whatever runs now.
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => p.forceLocal('revoked');
      const proving = p.prove(FIXTURE);
      port2.postMessage(null);
      await proving;
      port1.close();
      expect(fake.proves().length - before).toBe(0);
      expect(p.lastProver).toBe('wasm');
    } finally {
      await p.destroy();
    }
  }, 240_000);
});
