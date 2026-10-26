// bb.js WASM proving of W (the miner's path in a browser): timed proves with one multithreaded
// WasmWorker backend, byte-comparison against the native proof of the same witness, and a
// WASM verify. Requires a prior `aztec-nargo execute` + native prove (prove.ts) for the crate.
//   bun protocol/work-circuit/scripts/wasm-prove.ts [--runs 3] [--threads N] [crate]

import { cpus, hostname } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BackendType, Barretenberg, UltraHonkBackend } from '@aztec-foundation/bb.js';
import { workCircuitRoot } from './toolchain.ts';

const args = process.argv.slice(2);
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const runs = opt('--runs', 3);
const threads = opt('--threads', Math.max(1, cpus().length - 1));
const crate = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a))[0] ?? 'yacana_work';

const root = workCircuitRoot;
const artifact = await Bun.file(resolve(root, 'target', `${crate}.json`)).json();
const witness = new Uint8Array(await Bun.file(resolve(root, 'target', `${crate}.gz`)).arrayBuffer());
const nativeProof = new Uint8Array(await Bun.file(resolve(root, 'target', crate, 'proof')).arrayBuffer());

const t0 = performance.now();
const api = await Barretenberg.new({ threads, backend: BackendType.WasmWorker });
const backend = new UltraHonkBackend(artifact.bytecode, api);
const initMs = performance.now() - t0;

const times: number[] = [];
let proof: Uint8Array = new Uint8Array();
let publicInputs: string[] = [];
const hashes = new Set<string>();
for (let i = 0; i < runs; i++) {
  const t = performance.now();
  const r = await backend.generateProof(witness, { verifierTarget: 'noir-recursive-no-zk' });
  times.push(performance.now() - t);
  proof = r.proof;
  publicInputs = r.publicInputs;
  hashes.add(new Bun.CryptoHasher('sha256').update(proof).digest('hex'));
}
const tv = performance.now();
const ok = await backend.verifyProof({ proof, publicInputs }, { verifierTarget: 'noir-recursive-no-zk' });
const verifyMs = performance.now() - tv;
await api.destroy();

const sameAsNative = proof.length === nativeProof.length && proof.every((b, i) => b === nativeProof[i]);
const sorted = [...times].sort((a, b) => a - b);
const s = (ms: number) => (ms / 1000).toFixed(2);
console.log(
  `Machine: ${hostname()} · ${cpus()[0]?.model ?? 'cpu'} × ${cpus().length}; WasmWorker × ${threads} threads`,
);
console.log(
  `${crate}: init ${s(initMs)} s (first prove includes CRS/pk setup); prove min ${s(sorted[0] ?? 0)} s, median ${s(sorted[Math.floor(sorted.length / 2)] ?? 0)} s over ${runs}; verify ${s(verifyMs)} s`,
);
console.log(
  `proof ${proof.length} bytes, ${publicInputs.length} public inputs; distinct proofs ${hashes.size}; byte-identical to native: ${sameAsNative}; wasm verify: ${ok}`,
);
await Bun.write(
  resolve(root, 'target', `${crate}-wasm.json`),
  JSON.stringify(
    { threads, initMs, proveMs: times, verifyMs, proofBytes: proof.length, sameAsNative, ok },
    null,
    2,
  ),
);
if (!ok || !sameAsNative || hashes.size !== 1) process.exit(1);
