import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HoldButton } from '@yacana/ui';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MinerController } from '../controller';
import type { MasterRecord } from '../keys/store';
import { initial, type MinerState } from '../lib/reducer';
import { consent } from '../presto-consent';
import { minerAtom, nowAtom } from '../state';
import { canSignOut, SignOutDialog } from './SignOutDialog';
import { useHotkeys } from './use-page-behaviour';

const record = (patch: Partial<MasterRecord>): MasterRecord =>
  ({
    v: 1,
    id: 'r1',
    method: 'passkey',
    createdAt: 0,
    askEveryOpen: false,
    backedUp: false,
    account: { address: `0x${'282d'.padEnd(64, '9')}` },
    ...patch,
  }) as MasterRecord;

afterEach(cleanup);
beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

const mount = (r: MasterRecord, miner: Partial<MinerState> = {}) => {
  const onSignOut = vi.fn(() => Promise.resolve());
  const onBackUp = vi.fn();
  const store = createStore();
  store.set(minerAtom, { ...initial, ...miner } as MinerState);
  store.set(nowAtom, 100_000);
  render(
    <Provider store={store}>
      <SignOutDialog record={r} open onOpenChange={() => {}} onSignOut={onSignOut} onBackUp={onBackUp} />
    </Provider>,
  );
  return { onSignOut, onBackUp };
};

describe('sign out', () => {
  test('a passkey account: the hold at rest, the click path one failed hold away; one forget per confirmation', () => {
    const { onSignOut } = mount(record({ method: 'passkey' }));
    expect(screen.getByText('Sign out?')).toBeDefined();
    expect(screen.getByText(/^account ·/).textContent).toBe('account · 0x282d99…9999');
    expect(
      screen.getByText('Your passkey logs you back in. Your balance stays with the account.'),
    ).toBeDefined();
    expect(screen.getByTestId('sign-out-hold')).toBeDefined();
    expect(screen.queryByTestId('sign-out-click')).toBeNull();
    // A click no hold produced (voice control) reveals the click path and confirms nothing.
    fireEvent.click(screen.getByTestId('sign-out-hold'));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText('hold for 1.2 s ·')).toBeDefined();
    fireEvent.click(screen.getByTestId('sign-out-click'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('sign-out-click'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('mining says so; a claim in flight replaces the gesture with its clock until it is done', () => {
    mount(record({ method: 'passkey' }), { phase: 'mining' } as MinerState);
    expect(screen.getByText(/Mining stops\.$/)).toBeDefined();
    cleanup();
    mount(record({ method: 'passkey' }), {
      phase: 'claiming',
      claim: { step: 'sent', since: 90_000, done: [2_000] },
    } as MinerState);
    expect(screen.getByText(/A win is being claimed; sign out waits for it\./)).toBeDefined();
    const waiting = screen.getByRole('button', { name: /claim finishing/i });
    expect(waiting.textContent).toContain('Claim finishing · 12 s');
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
  });

  test('a words account not backed up gets the backup in place of the gesture', () => {
    const { onSignOut, onBackUp } = mount(record({ method: 'words', backedUp: false }));
    expect(
      screen.getByText(
        'Your 12 words are the only way back in, and they are not backed up yet. Yacana keeps no copy.',
      ),
    ).toBeDefined();
    expect(screen.queryByTestId('sign-out-hold')).toBeNull();
    expect(screen.getByText('sign out anyway · after the backup')).toBeDefined();
    fireEvent.click(screen.getByTestId('back-up-first'));
    expect(onBackUp).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    expect(canSignOut({ method: 'words', backedUp: false })).toBe(false);
    expect(canSignOut({ method: 'words', backedUp: true })).toBe(true);
    expect(canSignOut({ method: 'passkey', backedUp: false })).toBe(true);
  });

  test('a backed-up words account may sign out', () => {
    mount(record({ method: 'words', backedUp: true }));
    expect(
      screen.getByText('Your 12 words log you back in. Your balance stays with the account.'),
    ).toBeDefined();
    expect(screen.getByTestId('sign-out-hold')).toBeDefined();
  });
});

describe('the Space shortcut beside the hold', () => {
  test('holding Space on the hold button never starts the miner; a plain Space still does, once per press', () => {
    const start = vi.fn();
    const controller = () => ({ start, stop: vi.fn() }) as unknown as MinerController;
    function Page() {
      useHotkeys(controller, start, consent);
      return (
        <>
          <HoldButton onConfirm={() => {}} data-testid="hold">
            Hold
          </HoldButton>
          <button type="button" data-testid="plain">
            Send
          </button>
          <div role="dialog" data-testid="dialog">
            <p tabIndex={-1} data-testid="dialog-text">
              proving
            </p>
          </div>
        </>
      );
    }
    render(
      <Provider store={createStore()}>
        <Page />
      </Provider>,
    );
    const hold = screen.getByTestId('hold');
    fireEvent.keyDown(hold, { key: ' ' });
    fireEvent.keyDown(hold, { key: ' ', repeat: true });
    fireEvent.keyUp(hold, { key: ' ' });
    expect(start).not.toHaveBeenCalled();
    // A plain button owns its Space too: it is that button's click, never the page's Start.
    fireEvent.keyDown(screen.getByTestId('plain'), { key: ' ' });
    expect(start).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    expect(start).toHaveBeenCalledTimes(1);
    // Inside an open dialog no key is the page's: a locked transaction dialog is not navigated away from.
    fireEvent.keyDown(screen.getByTestId('dialog-text'), { key: ' ' });
    fireEvent.keyDown(screen.getByTestId('dialog-text'), { key: ',' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(location.pathname).not.toContain('settings');
  });
});
