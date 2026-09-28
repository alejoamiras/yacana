import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { type EpochRow, rowsFromJson } from '@yacana/miner-core/reader';
import { type Fixed, fixedAtom, historyAtom, unsettledAtom } from '@yacana/stats-view/state';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from './App';

const fixture = await import('@yacana/miner-core/fixtures/epochs.testnet.json?raw');
const rows: EpochRow[] = rowsFromJson(fixture.default);
const last = rows[rows.length - 1] as EpochRow;

afterEach(cleanup);

describe('the shell', () => {
  test('the header pill reads the chain until beat one, then names the block; settled waits for beat two', async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <App
          connection={{
            nodeUrl: 'http://node.test',
            ethRpcUrl: 'http://rpc.test',
            miner: '0x1',
            token: '0x2',
            firstEpoch: 0,
          }}
          onWindow={() => {}}
        />
      </Provider>,
    );
    expect(screen.getByTestId('freshness-pending').textContent).toBe('reading the chain…');
    const main = screen.getByRole('main');
    expect(main.getAttribute('data-settled')).toBe('0');
    const fixed: Fixed = {
      open: last.epoch,
      supply: 448n * 10n ** 18n,
      genesis: { target: 0n, seed: 0n, launchAt: 0 },
      block: { number: 1, timestamp: last.openedAt + 60 },
      readAt: 0,
    };
    store.set(fixedAtom, fixed);
    await waitFor(() => expect(screen.getByTestId('freshness').textContent).toContain('block 1'));
    await waitFor(() => expect(store.get(unsettledAtom).size).toBe(0));
    expect(main.getAttribute('data-settled')).toBe('0');
    store.set(historyAtom, { rows: new Map(rows.map((r) => [r.epoch, r])), lottery: null });
    await waitFor(() => expect(main.getAttribute('data-settled')).toBe('1'));
  });
});
