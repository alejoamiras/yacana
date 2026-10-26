// A crossing's row keeps who proved its transaction for as long as it proves or claims: the
// session's map, so a list mounted later reads it, and a new attempt starts from the promise.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Crossing } from '@yacana/bridge/journal';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import { createStore } from 'jotai';
import { BridgeSession } from '../src/bridge/session.ts';
import type { ProverKind } from '../src/presto.ts';
import { claimingAtom, crossingProversAtom } from '../src/state.ts';

// web-kit's fetch guard, held for this suite alone: later suites in the run get the realm's fetch back.
beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

interface Attribution {
  claim: (c: Pick<Crossing, 'id'>) => Promise<unknown>;
  forgetProvers: (list: readonly Pick<Crossing, 'id' | 'state'>[]) => void;
}
const sessionOn = (store: ReturnType<typeof createStore>): Attribution =>
  Object.assign(Object.create(BridgeSession.prototype), { d: { store }, after: async () => undefined });

describe('a crossing’s prover', () => {
  test('an answer is kept while its crossing proves or claims, and no longer', () => {
    const store = createStore();
    store.set(
      crossingProversAtom,
      new Map<string, ProverKind>([
        ['proving', 'wasm'],
        ['claiming', 'presto'],
        ['sent', 'wasm'],
      ]),
    );
    store.set(claimingAtom, new Map([['claiming', 1]]));
    sessionOn(store).forgetProvers([
      { id: 'proving', state: 'proving' },
      { id: 'sent', state: 'sent' },
    ]);
    expect([...store.get(crossingProversAtom).keys()]).toEqual(['proving', 'claiming']);
  });

  test('a claim tapped again before the last attempt’s answer was pruned starts from the promise', async () => {
    const store = createStore();
    store.set(crossingProversAtom, new Map<string, ProverKind>([['A', 'wasm']]));
    store.set(claimingAtom, new Map([['A', 1]]));
    await sessionOn(store).claim({ id: 'A' });
    expect(store.get(crossingProversAtom).size).toBe(0);
  });
});
