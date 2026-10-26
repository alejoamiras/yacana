// The page's prover around the SDK's: a proof's start and end bracket the UI's attribution, a thrown
// proof included.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PrestoProver } from '@alejoamiras/presto';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { TxProver } from '../src/tx-prover.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const ENDPOINT = { host: '127.0.0.1', port: 1, httpsPort: 1, httpsOnly: false } as const;
const proto = PrestoProver.prototype as unknown as { createChonkProof: () => Promise<unknown> };

describe('the transaction prover', () => {
  test('a proof that throws still ends; the next starts from nothing', async () => {
    const prover = new TxProver(ENDPOINT);
    const seen: string[] = [];
    prover.onProof = (state) => seen.push(state);
    const original = proto.createChonkProof;
    // A `/prove` answer the client does not recognise: the SDK throws after the transmit, no `fallback`.
    proto.createChonkProof = async () => {
      seen.push('transmit');
      throw new Error('HTTP 500');
    };
    try {
      await expect(prover.createChonkProof([])).rejects.toThrow('HTTP 500');
      expect(seen).toEqual(['start', 'transmit', 'end']);
      seen.length = 0;
      const proof = {} as Awaited<ReturnType<TxProver['createChonkProof']>>;
      proto.createChonkProof = async () => proof;
      expect(await prover.createChonkProof([])).toBe(proof);
      expect(seen).toEqual(['start', 'end']);
    } finally {
      proto.createChonkProof = original;
    }
  });
});
