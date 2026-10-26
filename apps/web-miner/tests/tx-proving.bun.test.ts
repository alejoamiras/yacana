// Who proves the wallet's transaction, as the page reads the prover's phases; when the next one will
// go to Presto; and the words each answer gets on the claim line.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PrestoPhase } from '@alejoamiras/presto-core';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { winNote } from '../src/lib/claim-copy.ts';
import {
  initialPresto,
  PROVING,
  type PrestoState,
  type ProverKind,
  prestoProvesTx,
  txProvingAfter,
} from '../src/presto.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

/** The prover after each phase, walked in order. */
const walk = (phases: PrestoPhase[]): (ProverKind | null)[] => {
  const out: (ProverKind | null)[] = [];
  for (const p of phases) out.push(txProvingAfter(out.at(-1) ?? null, p));
  return out;
};

describe('the transaction’s prover', () => {
  test('Presto from the transmit; the page from a proving with no transmit, or a fallback; unknown until then', () => {
    expect(walk(['detect', 'serialize', 'transmit', 'proving', 'proved', 'receive'])).toEqual([
      null,
      null,
      'presto',
      'presto',
      'presto',
      'presto',
    ]);
    // Forced local: the SDK proves in the page and says so without a transmit.
    expect(walk(['proving', 'proved'])).toEqual(['wasm', 'wasm']);
    // Presto refused the proof (`denied` is `/prove`'s answer): the fallback precedes the local proving.
    expect(walk(['detect', 'denied', 'fallback', 'proving', 'proved', 'receive'])).toEqual([
      null,
      null,
      'wasm',
      'wasm',
      'wasm',
      'wasm',
    ]);
    // Gone mid-proof: the transmit said Presto, the fallback takes it back.
    expect(walk(['detect', 'serialize', 'transmit', 'proving', 'fallback', 'proving', 'proved'])).toEqual([
      null,
      null,
      'presto',
      'presto',
      'wasm',
      'wasm',
      'wasm',
    ]);
  });

  test('the next proof goes to Presto only while the probe saw it serve the kernel’s scheme and the Worker keeps it', () => {
    const serving = (schemes: string[]): PrestoState['status'] => ({
      available: true,
      needsDownload: false,
      schemes,
      protocol: 'http',
    });
    const sticky: PrestoState = {
      ...initialPresto,
      selected: 'presto',
      status: serving(['ultra_honk', 'chonk']),
    };
    expect(prestoProvesTx(sticky)).toBe(true);
    expect(prestoProvesTx({ ...sticky, status: serving(['ultra_honk']) })).toBe(false);
    expect(prestoProvesTx({ ...sticky, fallbackReason: 'denied' })).toBe(false);
    // The Worker's own build is not the wallet's: Presto serving chonk alone still proves the kernel.
    expect(prestoProvesTx({ ...sticky, selected: 'wasm', status: serving(['chonk']) })).toBe(true);
    expect(prestoProvesTx({ ...sticky, status: null })).toBe(false);
  });

  test('the claim line names who proves it', () => {
    const claim = { step: 'proving' as const };
    expect(winNote(claim, 5_000, 'presto')?.text).toBe(PROVING.presto.claim);
    expect(winNote(claim, 5_000)?.text).toBe('claiming: proving in your browser, about 20 s');
    expect(PROVING.presto.claim).toBe('claiming: proving through Presto ✦');
  });
});
