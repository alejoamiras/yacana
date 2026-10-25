// The Worker's mining run over a duck-typed native prover (the digest is real: Poseidon2 over the
// proof's fields, at a target every digest beats): a native win shows only once it verified, a
// rejected one leaves no trace and its nonce is proved again in WASM, a Stop during the check
// reports nothing, and a WASM proof under a native prover is never held.
import { describe, expect, test } from 'bun:test';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { PROOF_FIELDS } from '@yacana/miner-core/proof';
import type { ProverKind } from '../src/presto.ts';
import { mineFrom, type NativeAwareProver } from '../src/worker-mine.ts';
import type { FromWorker, MineJob } from '../src/worker-protocol.ts';

const job: MineJob = {
  epoch: 1n,
  seed: '0x2',
  domain: '0x3',
  secret: '0x4',
  recipient: '0x5',
  target: 1n << 128n,
  secretId: 1,
  startNonce: 1n,
};

function fake(o: { first?: ProverKind; verdicts?: boolean[]; onVerify?: () => void } = {}) {
  const calls: string[] = [];
  let last: ProverKind = o.first ?? 'presto';
  const verdicts = o.verdicts ?? [];
  const p: NativeAwareProver = {
    get lastProver() {
      return last;
    },
    async prove(inputs) {
      calls.push(`prove:${inputs.nonce}:${last}`);
      return { proof: new Uint8Array(PROOF_FIELDS * 32), out: new Fr(9n) };
    },
    async verifyWin() {
      calls.push('verify');
      o.onVerify?.();
      return verdicts.shift() ?? true;
    },
    forceLocal(reason) {
      calls.push(`force:${reason}`);
      last = 'wasm';
    },
    async destroy() {},
  };
  return { p, calls };
}

const types = (posted: FromWorker[]) => posted.map((m) => m.type);

describe('mineFrom over a native prover', () => {
  test('a verified native win: the attempt, then the winner marked presto', async () => {
    const { p, calls } = fake({ verdicts: [true] });
    const posted: FromWorker[] = [];
    expect(
      await mineFrom(
        p,
        job,
        1n,
        () => true,
        (m) => posted.push(m),
      ),
    ).toBe(true);
    expect(calls).toEqual(['prove:1:presto', 'verify']);
    expect(types(posted)).toEqual(['attempt', 'winner']);
    expect(posted[0]).toMatchObject({ type: 'attempt', nonce: 1n, win: true });
    expect(posted[1]).toMatchObject({ type: 'winner', nonce: 1n, prover: 'presto' });
  });

  test('a rejected native win never reaches the ledger: WASM proves the same nonce and that winner is wasm', async () => {
    const { p, calls } = fake({ verdicts: [false] });
    const posted: FromWorker[] = [];
    expect(
      await mineFrom(
        p,
        job,
        1n,
        () => true,
        (m) => posted.push(m),
      ),
    ).toBe(true);
    expect(calls).toEqual(['prove:1:presto', 'verify', 'force:invalid-proof', 'prove:1:wasm']);
    // One attempt only — the rejected proof's was dropped, not posted as a loss.
    expect(types(posted)).toEqual(['attempt', 'winner']);
    expect(posted[0]).toMatchObject({ type: 'attempt', nonce: 1n, win: true });
    expect(posted[1]).toMatchObject({ type: 'winner', nonce: 1n, prover: 'wasm' });
  });

  test('a Stop that lands during the verification reports nothing', async () => {
    let going = true;
    const { p } = fake({
      verdicts: [true],
      onVerify: () => {
        going = false;
      },
    });
    const posted: FromWorker[] = [];
    expect(
      await mineFrom(
        p,
        job,
        1n,
        () => going,
        (m) => posted.push(m),
      ),
    ).toBe(false);
    expect(posted).toEqual([]);
  });

  test('a WASM proof under a native prover is not held: no verification, the winner is wasm', async () => {
    const { p, calls } = fake({ first: 'wasm' });
    const posted: FromWorker[] = [];
    expect(
      await mineFrom(
        p,
        job,
        1n,
        () => true,
        (m) => posted.push(m),
      ),
    ).toBe(true);
    expect(calls).toEqual(['prove:1:wasm']);
    expect(types(posted)).toEqual(['attempt', 'winner']);
    expect(posted[1]).toMatchObject({ type: 'winner', prover: 'wasm' });
  });
});
