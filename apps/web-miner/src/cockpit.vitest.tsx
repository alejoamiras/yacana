import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { initial } from './lib/reducer';
import { Mine } from './routes/Mine';
import { bootAtom, claimsAtom, epochAtom, minerAtom, nowAtom, rulesAtom } from './state';

afterEach(cleanup);
// jsdom has no matchMedia; the score loop's reduced-motion hook reads it. A returning visitor: the first
// visit's strip is intro-strip.vitest.tsx's.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  localStorage.setItem('yacana.intro', JSON.stringify({ dismissed: true }));
});

// The M1 frame's placement, as classes: the computed grid is asserted in the browser (miner.e2e.ts).
describe('the cockpit grid', () => {
  test('loop, KPIs and ledger over three columns; the right column balance first, then the rail, over three rows', () => {
    const { container } = render(<Mine controller={() => undefined} />);
    const cockpit = container.querySelector('[data-testid=cockpit]') as HTMLElement;
    expect(cockpit.className).toContain('xl:grid-cols-[1fr_1fr_1fr_300px]');
    expect(cockpit.className).toContain('xl:grid-rows-[auto_auto_1fr]');
    expect(cockpit.className).toContain('gap-[14px]');
    expect(cockpit.className).toContain('items-start');
    const tiles = Array.from(cockpit.children) as HTMLElement[];
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.className).toContain('xl:col-span-3');
    // The loop tile holds no claim stepper: the claim lives on the loop's chip and the ledger.
    expect(tiles[0]?.querySelector('[data-testid=claim-stepper]')).toBeNull();
    expect(tiles[0]?.querySelector('[data-slot=score-loop]')?.getAttribute('data-calm')).toBe('true');
    // The right column: one flex column at xl spanning the three left rows, dissolved below it.
    const right = tiles[1] as HTMLElement;
    expect(right.getAttribute('data-testid')).toBe('right-column');
    expect(right.className).toContain('contents');
    expect(right.className).toContain('xl:flex-col');
    expect(right.className).toContain('xl:row-span-3');
    expect(right.firstElementChild?.textContent).toContain('balance');
    expect(right.firstElementChild?.querySelector('[data-testid=mint-line]')?.textContent).toBe('');
    expect(right.lastElementChild?.getAttribute('data-testid')).toBe('rail');
    expect(right.lastElementChild?.className).toContain('md:row-span-2');
    expect(right.querySelector('[data-testid=claim-slot]')).toBeNull();
    expect(tiles[2]?.getAttribute('data-testid')).toBe('kpi-tiles');
    expect(tiles[2]?.querySelectorAll('[data-slot=tile]')).toHaveLength(3);
    expect(tiles[3]?.className).toContain('xl:col-span-3');
    expect(tiles[3]?.textContent).toContain('proofs, newest first');
  });

  test('signed in with no upgrade announced, the upgrade card draws nothing and reserves no row', () => {
    const store = createStore();
    store.set(bootAtom, {
      phase: 'ready',
      account: '0xacc',
      threads: 1,
      record: {
        v: 1,
        id: 'k',
        method: 'words',
        createdAt: 0,
        askEveryOpen: false,
        backedUp: true,
        account: { address: '0xacc', index: 0 },
      },
    });
    const { container } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} session={{} as never} />
      </Provider>,
    );
    const cockpit = container.querySelector('[data-testid=cockpit]') as HTMLElement;
    expect(cockpit.children).toHaveLength(4);
    expect(cockpit.className).toContain('xl:grid-rows-[auto_auto_1fr]');
  });

  test('a notice above the cockpit adds a row before the one that takes the slack', () => {
    const store = createStore();
    store.set(minerAtom, { ...initial, notice: { kind: 'offline', title: 'node away', body: '…' } });
    const { container } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(container.querySelector('[data-testid=cockpit]')?.className).toContain(
      'xl:grid-rows-[auto_auto_auto_1fr]',
    );
  });
});

describe('the epoch tile and the ledger', () => {
  test('renders the chain before any account: the epoch tile from the atoms alone, no session', () => {
    const store = createStore();
    const nowSec = Math.floor(Date.now() / 1000);
    store.set(epochAtom, {
      epoch: 38n,
      seed: 7n,
      target: 1n << 122n,
      openedAt: BigInt(nowSec - 120),
      claims: 3,
    });
    store.set(rulesAtom, {
      N: 4,
      EXPECTED_EPOCH_SECONDS: 300n,
      T_MAX: 1200n,
      REWARD: 4_000_000_000_000_000_000n,
    });
    store.set(nowAtom, Date.now());
    const { getByTestId, getByText } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(getByTestId('epoch').textContent).toBe('38');
    expect(getByTestId('epoch-claims').textContent).toContain('3 of 4');
    // Signed out: the loop's header names the tile, the balance tile says what fills it, the KPIs what starts it.
    expect(getByText('your proofs')).toBeTruthy();
    expect(getByText('Your balance shows once you log in.')).toBeTruthy();
    expect(getByText('starts with mining')).toBeTruthy();
    expect(getByText('difficulty 64.0 · about 64 proofs per win')).toBeTruthy();
    // The rows in the visitor's words, each label a tip; the header word too.
    const labels = Array.from(
      getByTestId('rail').querySelectorAll('[data-slot=kv] > :first-child') as NodeListOf<HTMLElement>,
    ).map((l) => l.textContent);
    expect(labels).toEqual([
      'wins this epoch',
      'difficulty',
      'open for',
      'expected epoch time',
      'next difficulty, if closed now',
      'reset if stuck',
    ]);
    expect(getByTestId('rail').querySelectorAll('[data-slot=tip-trigger]')).toHaveLength(6);
    expect(getByText('epoch 38').getAttribute('data-slot')).toBe('tip-trigger');
    // The ? carries the chart's three sentences with today's odds.
    expect(screen.queryByTestId('loop-help-content')).toBeNull();
    fireEvent.click(getByTestId('loop-help'));
    expect(screen.getByTestId('loop-help-content').textContent).toContain(
      'Today about 1 proof in 64 does, so most ticks stay low.',
    );
  });

  test('the ledger’s footer counts the device’s wins and opens them in the dialog, newest first', async () => {
    const store = createStore();
    store.set(claimsAtom, [
      { epoch: 3n, block: 120, at: 1_700_000_000_000, txHash: '0xa', nullifier: '0x1', settled: 'settled' },
      { epoch: 4n, block: 133, at: 1_700_000_060_000, txHash: '0xb', nullifier: '0x2', settled: 'pending' },
    ]);
    const { getByTestId } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(getByTestId('wins-count').textContent).toBe('2 wins on this device');
    expect(screen.queryByTestId('wins-dialog')).toBeNull();
    await act(async () => fireEvent.click(getByTestId('all-wins')));
    const rows = Array.from(screen.getByTestId('claims-history').querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    expect(rows).toEqual([
      '2023-11-14 22:14epoch 4block 133↗ (opens in a new tab)',
      '2023-11-14 22:13epoch 3block 120↗ (opens in a new tab)',
    ]);
    expect(screen.getByTestId('wins-dialog').textContent).toContain('2 wins');
  });
});

describe('the mint line', () => {
  test('ten seconds from the mint, whatever the next claim does to the miner’s own ✓, across a remount', () => {
    const store = createStore();
    store.set(bootAtom, {
      phase: 'ready',
      account: '0xacc',
      threads: 1,
      record: {
        v: 1,
        id: 'k',
        method: 'words',
        createdAt: 0,
        askEveryOpen: false,
        backedUp: true,
        account: { address: '0xacc', index: 0 },
      },
    });
    store.set(claimsAtom, [{ epoch: 3n, block: 9, at: 1_000 }]);
    store.set(nowAtom, 2_000);
    const ui = () => (
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>
    );
    const first = render(ui());
    expect(first.getByTestId('mint-line').textContent).toBe('+4 tYACA · just now');
    // The next win's claim clears the miner's mint, and the user visits the Wallet and comes back:
    // the balance keeps its acknowledgement through both.
    act(() => {
      store.set(minerAtom, { ...initial, minted: null });
      store.set(nowAtom, 3_000);
    });
    first.unmount();
    const { getByTestId, rerender } = render(ui());
    expect(getByTestId('mint-line').textContent).toBe('+4 tYACA · just now');
    act(() => store.set(nowAtom, 11_500));
    rerender(ui());
    expect(getByTestId('mint-line').textContent).toBe('');
  });
});

describe('the start and stop buttons', () => {
  test('Stop stays on the cockpit while a claim is in flight', () => {
    const store = createStore();
    store.set(bootAtom, {
      phase: 'ready',
      account: '0xacc',
      threads: 1,
      record: {
        v: 1,
        id: 'k',
        method: 'words',
        createdAt: 0,
        askEveryOpen: false,
        backedUp: true,
        account: { address: '0xacc', index: 0 },
      },
    });
    store.set(minerAtom, {
      ...initial,
      phase: 'claiming',
      claim: { step: 'sent', wonAt: 19_000, since: 50_000, done: [12_400], lineId: 1, txHash: '0xab' },
      ledger: [
        {
          id: 1,
          kind: 'win',
          time: '00:00:19',
          n: 12,
          score: 2.8,
          proveMs: 3610,
          claim: { step: 'sent', expiresAt: 660 },
        },
      ],
    });
    store.set(nowAtom, 60_000);
    const { getByTestId } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(getByTestId('stop').getAttribute('title')).toContain('does not resume');
    // The chip: the step and one clock from the win; the ledger's win line the same step with its countdown.
    expect(getByTestId('claim-chip').textContent).toBe('claiming · sent · 41 s');
    expect(getByTestId('ledger').textContent).toContain(
      'a win · claiming: sent to the node · drops in 10:00 if no block takes it',
    );
    cleanup();
    store.set(minerAtom, { ...store.get(minerAtom), stopping: true });
    const stopping = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(stopping.getByTestId('claim-chip').textContent).toBe('stopping · claim finishing · 41 s');
    expect((stopping.getByTestId('stop') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a lost race is a banner under the header, no way out but time; a paused account names its clock', () => {
    const store = createStore();
    store.set(nowAtom, 60_000);
    store.set(minerAtom, {
      ...initial,
      phase: 'recovering',
      notice: {
        kind: 'reverted',
        title: 'lost a race',
        body: 'Re-syncing this account from the chain; mining resumes in about a minute.',
      },
    });
    const { getByTestId, queryByTestId } = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(getByTestId('notice-reverted').textContent).toContain('Re-syncing this account');
    expect(queryByTestId('fresh-key')).toBeNull();
    cleanup();
    store.set(minerAtom, {
      ...initial,
      notice: {
        kind: 'paused',
        title: 'claims paused',
        body: 'Mining resumes about 16:48.',
        until: 60_000 + 38 * 60_000,
      },
    });
    const paused = render(
      <Provider store={store}>
        <Mine controller={() => undefined} />
      </Provider>,
    );
    expect(paused.getByTestId('notice-paused').textContent).toContain('in 38 min');
  });
});
