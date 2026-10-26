// Pins the cross-language vectors: every hash the contract and miner-core must agree on,
// computed here once and written to protocol/work-circuit/fixtures/vectors.json. The codegen
// turns them into Noir tests; vectors.test.ts checks miner-core against the same file. Re-run only
// when a domain separator or a hash layout changes on purpose (that is a new deployment).
import { resolve } from 'node:path';
import { poseidon2Hash } from '@aztec-labs/foundation/crypto/poseidon';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { PARAMS } from '../src/generated/params.ts';
import {
  computeDigest,
  DOM_NULL,
  deployDomain,
  low128,
  proofToFields,
  secretCommitment,
} from '../src/proof.ts';
import { nextSeed, nextTarget } from '../src/retarget.ts';

const repo = resolve(import.meta.dir, '../../..');
const fixture = resolve(repo, 'protocol/work-circuit/fixtures/yacana_work/proof');
const fields = proofToFields(new Uint8Array(await Bun.file(fixture).arrayBuffer()));
const digest = await computeDigest(fields);
const hex = (v: Fr | bigint) => `0x${(typeof v === 'bigint' ? v : v.toBigInt()).toString(16)}`;

const chainId = 31337n;
const rollupVersion = 1821665230n;
const miner = new Fr(0x1234n);
const version = 1n;
const secret = new Fr(7n);
const recipient = new Fr(0x1e57n);
const seed = new Fr(5n);
const nextEpoch = 1n;
const now = 100n;
const rules = { N: PARAMS.N, EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS, T_MAX: PARAMS.T_MAX };
const target = (1n << 118n) + 12345n;
const actual = PARAMS.EXPECTED_EPOCH_SECONDS + 7n;

const vectors = {
  fixtureProof: fields.map(hex),
  digest: hex(digest),
  low128: hex(low128(digest)),
  deployDomain: {
    chainId: hex(chainId),
    miner: hex(miner),
    version: hex(version),
    rollupVersion: hex(rollupVersion),
    value: hex(await deployDomain(chainId, rollupVersion, miner, version)),
  },
  secretCommitment: {
    secret: hex(secret),
    recipient: hex(recipient),
    value: hex(await secretCommitment(secret, recipient)),
  },
  nullifier: hex(await poseidon2Hash([new Fr(DOM_NULL), digest])),
  nextSeed: {
    seed: hex(seed),
    nextEpoch: hex(nextEpoch),
    now: hex(now),
    value: hex(await nextSeed(seed, nextEpoch, digest, now)),
  },
  retarget: {
    expectedEpochSeconds: Number(PARAMS.EXPECTED_EPOCH_SECONDS),
    target: hex(target),
    actual: hex(actual),
    value: hex(nextTarget(target, actual, rules)),
  },
};
const out = resolve(repo, 'protocol/work-circuit/fixtures/vectors.json');
await Bun.write(out, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`pinned ${Object.keys(vectors).length} vectors → ${out}`);
