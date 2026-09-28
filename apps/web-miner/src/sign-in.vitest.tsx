import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MinerController } from './controller';
import { SignInDialog } from './features/SignInDialog';
import { useHotkeys } from './features/use-page-behaviour';
import type { SlotView } from './keys/slot';
import type { MasterRecord } from './keys/store';
import { initialSteps, type OpeningStep } from './opening-steps';
import { initialPresto, prestoAtom } from './presto';
import { consent } from './presto-consent';
import { Mine } from './routes/Mine';
import type { Session } from './session';
import { settingsAtom } from './settings';
import {
  type AccountError,
  bootAtom,
  epochAtom,
  mineIntentAtom,
  minerAtom,
  nowAtom,
  rulesAtom,
  signInAtom,
} from './state';

afterEach(cleanup);
// jsdom has no matchMedia; the score loop's reduced-motion hook reads it.
beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const session = {
  createWithPasskey: vi.fn(async () => {}),
  createWithWords: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  restoreWithPasskey: vi.fn(async () => {}),
  restoreWithWords: vi.fn(async () => {}),
  forget: vi.fn(async () => {}),
  hideOpeningFailure: vi.fn(),
  newWords: () => PHRASE,
} as unknown as Session;
const record = {
  id: 'r1',
  v: 1,
  method: 'passkey',
  askEveryOpen: true,
  backedUp: false,
  account: { address: `0x${'ab'.repeat(32)}`, index: 0 },
} as unknown as MasterRecord;
const empty: SlotView = { record: null, staged: null, revision: 0 };
const held: SlotView = { record, staged: null, revision: 3 };

/** The cockpit and the dialog on a store that holds the chain and no account. */
function mount(slot: SlotView = empty, error?: AccountError) {
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
  store.set(bootAtom, { phase: 'signedOut', slot, error });
  store.set(signInAtom, slot.record !== null || slot.staged !== null); // as the boot decides on arrival
  render(
    <Provider store={store}>
      <Mine controller={() => undefined} />
      <SignInDialog session={session} />
    </Provider>,
  );
  return store;
}

const fail = (store: ReturnType<typeof createStore>, error: AccountError, slot: SlotView = empty) =>
  store.set(bootAtom, { phase: 'signedOut', slot, error });

/** The balance tile's Log in: the dialog without the mining intent. */
const openDialog = () => fireEvent.click(screen.getByTestId('sign-in-balance'));

describe('the cockpit signed out', () => {
  test('a new visitor gets the page first: no dialog, the cockpit at full contrast, Start mining and Log in open it', () => {
    const store = mount();
    expect(screen.queryByTestId('sign-in')).toBeNull();
    const cockpit = screen.getByTestId('cockpit');
    expect(cockpit.hasAttribute('data-signed-out')).toBe(true);
    expect(cockpit.className).not.toMatch(/opacity|saturate/);
    expect(screen.getByTestId('epoch-claims').textContent).toContain('3 of 4');
    expect(screen.getByTestId('sign-in-mine').textContent).toBe('Start mining');
    expect(screen.queryByTestId('start')).toBeNull();
    expect(screen.getByTestId('balance').textContent).toBe('—');
    expect(screen.getByTestId('sign-in-balance').textContent).toBe('Log in');
    // Start mining opens the dialog and records the intent; the corner X is gone.
    fireEvent.click(screen.getByTestId('sign-in-mine'));
    expect(screen.getByTestId('sign-in')).toBeTruthy();
    expect(store.get(mineIntentAtom)).toBe(true);
    expect(screen.getByText('Mine with an account.')).toBeTruthy();
    expect(screen.getByTestId('start-create')).toBeTruthy();
    expect(screen.getByTestId('start-login')).toBeTruthy();
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  test('Just watch for now closes the dialog and forgets the intent; Log in reopens it without one', async () => {
    const store = mount();
    fireEvent.click(screen.getByTestId('sign-in-mine'));
    fireEvent.click(screen.getByTestId('not-now'));
    await waitFor(() => expect(screen.queryByTestId('sign-in')).toBeNull());
    expect(store.get(signInAtom)).toBe(false);
    expect(store.get(mineIntentAtom)).toBe(false);
    openDialog();
    await waitFor(() => expect(screen.getByTestId('sign-in')).toBeTruthy());
    expect(store.get(mineIntentAtom)).toBe(false);
  });

  test('a device with an account gets Welcome back: the chip, one touch, and another account through Sign out', async () => {
    mount(held);
    expect(screen.getByText('Welcome back.')).toBeTruthy();
    expect(screen.getByTestId('key-address').textContent).toContain('0xababab');
    expect(screen.getByTestId('key-address').getAttribute('title')).toBe(record.account.address);
    expect(screen.getByText('passkey')).toBeTruthy();
    expect(screen.getByTestId('open-key').textContent).toBe('Open with passkey');
    expect(screen.queryByTestId('start-create')).toBeNull();
    expect(screen.getByTestId('not-now')).toBeTruthy();
    fireEvent.click(screen.getByTestId('use-other'));
    await waitFor(() => expect(screen.getByTestId('sign-out-dialog')).toBeTruthy());
    expect(
      screen.getByText('Your passkey logs you back in. Your balance stays with the account.'),
    ).toBeTruthy();
    expect(screen.getByTestId('sign-out-hold')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('sign-out-dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('open-key'));
    expect(session.open).toHaveBeenCalledWith(record);
    // The attempt runs: every way out waits for it.
    expect((screen.getByTestId('use-other') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a staged record (a create that never finished) is Welcome’s candidate; a sealed one opens without a touch', () => {
    mount({ record: null, staged: { ...record, method: 'words' } as MasterRecord, revision: 1 });
    expect(screen.getByText('Welcome back.')).toBeTruthy();
    expect(screen.getByText('12 words')).toBeTruthy();
    expect(screen.getByTestId('open-key').textContent).toBe('Open');
  });
});

describe('the screens', () => {
  test('Create: consent gates the passkey; the words are one link away and come back to Create', async () => {
    const store = mount();
    openDialog();
    fireEvent.click(screen.getByTestId('start-create'));
    expect(screen.getByText('Create your account.')).toBeTruthy();
    expect(screen.getByText('Your passkey is the only key.')).toBeTruthy();
    const create = screen.getByTestId('create-passkey') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('consent'));
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(session.createWithPasskey).toHaveBeenCalledTimes(1);
    // The links wait for the attempt; the mock resolves at once.
    expect((screen.getByTestId('use-words') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByTestId('use-words') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('use-words'));
    expect(screen.getByText('Write down your 12 words.')).toBeTruthy();
    expect(screen.getByTestId('words-grid').querySelectorAll('li')).toHaveLength(12);
    expect((screen.getByTestId('words-done') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('words-skip'));
    expect(session.createWithWords).toHaveBeenCalledWith(PHRASE, false);
    // The attempt shows the checklist (the Words screen unmounts); a refusal before the record is
    // staged (another tab holds the slot) comes back to the same words, with the note.
    store.set(bootAtom, { phase: 'opening', steps: initialSteps() });
    await waitFor(() => expect(screen.queryByTestId('words-grid')).toBeNull());
    fail(store, { kind: 'slot', message: 'Another tab is opening an account.' });
    await waitFor(() => expect(screen.getByTestId('key-error')).toBeTruthy());
    expect(screen.getByTestId('words-grid').textContent).toContain('about');
    fireEvent.click(screen.getByTestId('back'));
    expect(screen.getByText('Create your account.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('back'));
    expect(screen.getByText('Mine with an account.')).toBeTruthy();
  });

  test('Log in with words: the counter, the wordlist and checksum refusals, then the phrase opens', async () => {
    mount();
    openDialog();
    fireEvent.click(screen.getByTestId('start-login'));
    expect(screen.getByText('Log in with the passkey you created, or your 12 words.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('restore-passkey'));
    expect(session.restoreWithPasskey).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect((screen.getByTestId('restore-words') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('restore-words'));
    expect(screen.getByText('Enter your 12 words.')).toBeTruthy();
    expect(screen.getByTestId('host-banner').textContent).toContain('localhost');
    const input = screen.getByTestId('words-input');
    const open = screen.getByTestId('words-open') as HTMLButtonElement;
    fireEvent.change(input, { target: { value: 'abandon abandon abandon' } });
    expect(screen.getByTestId('words-under').textContent).toBe('3 of 12');
    expect(open.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'abandon abandon quartzz' } });
    expect(screen.getByTestId('words-under').textContent).toContain(
      'Word 3 isn\'t in the list: check "quartzz".',
    );
    fireEvent.change(input, { target: { value: 'abandon '.repeat(12).trim() } });
    expect(screen.getByTestId('words-under').textContent).toContain(
      "These 12 words don't form a valid phrase.",
    );
    expect(open.disabled).toBe(true);
    fireEvent.change(input, { target: { value: PHRASE } });
    expect(screen.getByTestId('words-under').textContent).toBe('12 of 12');
    fireEvent.click(open);
    expect(session.restoreWithWords).toHaveBeenCalledWith(PHRASE);
  });

  test('a failure notes on the screen it came from, with the primary the note names, and nowhere else', async () => {
    const store = mount();
    openDialog();
    fireEvent.click(screen.getByTestId('start-create'));
    fireEvent.click(screen.getByTestId('consent'));
    fireEvent.click(screen.getByTestId('create-passkey'));
    fail(store, { kind: 'no-prf', message: 'no prf' });
    await waitFor(() => expect(screen.getByTestId('key-error')).toBeTruthy());
    expect(screen.getByText("This device can't make a Yacana passkey.")).toBeTruthy();
    expect(screen.getByTestId('use-words').textContent).toBe('Use 12 words');
    expect(screen.queryByTestId('create-passkey')).toBeNull();
    fireEvent.click(screen.getByTestId('back'));
    expect(screen.queryByTestId('key-error')).toBeNull();
    // On Welcome, another tab's hold on the chain view: the note and Retry.
    fail(store, { kind: 'held-tab', message: 'held' }, held);
    await waitFor(() => expect(screen.getByText('Another tab has this account open.')).toBeTruthy());
    expect(screen.getByTestId('open-key').textContent).toBe('Retry');
  });
});

const opening = (over: Partial<Record<OpeningStep['id'], Partial<OpeningStep>>>) =>
  initialSteps().map((x) => ({ ...x, ...over[x.id] }));
const mountOpening = (steps: OpeningStep[], intent = false) => {
  const store = createStore();
  store.set(nowAtom, 60_000);
  store.set(mineIntentAtom, intent);
  store.set(bootAtom, { phase: 'opening', steps });
  render(
    <Provider store={store}>
      <SignInDialog session={session} />
    </Provider>,
  );
  return store;
};

describe('the opening body', () => {
  test('the bar shows under the keys step while its bytes land; the sync shows its elapsed time and no bar', () => {
    mountOpening(
      opening({ key: { state: 'done' }, crs: { state: 'active', bytes: { loaded: 5, total: 20 } } }),
    );
    expect(screen.getByText('Opening your account.')).toBeTruthy();
    expect(screen.getByText('Passkey confirmed')).toBeTruthy();
    expect(screen.getByText('0.0 of 0 MB')).toBeTruthy();
    // key 5 + crs 60×0.25 = 20.
    expect(screen.getByTestId('opening-bar').getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByText('Kept on this device; next time this step is skipped.')).toBeTruthy();
    expect(screen.getByText(/You can start mining when this finishes/)).toBeTruthy();
    // Cancel is available: the ceremony (the key step) is done.
    expect((screen.getByTestId('opening-cancel') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    mountOpening(
      opening({ key: { state: 'done' }, crs: { state: 'done' }, notes: { state: 'active', since: 18_000 } }),
      true,
    );
    expect(screen.queryByTestId('opening-bar')).toBeNull();
    expect(screen.getByText('0:42')).toBeTruthy();
    expect(screen.getByText('first time only')).toBeTruthy();
    expect(screen.getByText(/Reading your notes from the chain/)).toBeTruthy();
    expect(screen.getByText(/Mining starts when this finishes/)).toBeTruthy();
  });
});

describe('a failed opening', () => {
  test('a step that failed keeps the checklist: the reason, the note, Retry, Change node for the node, Cancel', async () => {
    const store = createStore();
    store.set(nowAtom, 60_000);
    store.set(signInAtom, true);
    const steps = opening({
      key: { state: 'done' },
      crs: { state: 'done' },
      notes: { state: 'failed', reason: 'no answer' },
    });
    store.set(bootAtom, {
      phase: 'signedOut',
      slot: held,
      error: { kind: 'node', message: 'fetch failed', step: 'notes' },
      opening: steps,
    });
    render(
      <Provider store={store}>
        <SignInDialog session={session} />
      </Provider>,
    );
    expect(screen.getByTestId('opening-failed')).toBeTruthy();
    expect(screen.getByText('no answer')).toBeTruthy();
    expect(screen.getByText("The Aztec node isn't answering.")).toBeTruthy();
    expect(screen.getByTestId('key-error').textContent).toContain('Retry, or use another node.');
    expect(screen.getByTestId('opening-change-node')).toBeTruthy();
    fireEvent.click(screen.getByTestId('opening-retry'));
    expect(session.open).toHaveBeenCalledWith(record, undefined);
    // Cancel hides that failure through the session: the dialog closes, and Welcome is what reopens.
    fireEvent.click(screen.getByTestId('opening-cancel'));
    expect(session.hideOpeningFailure).toHaveBeenCalledTimes(1);
    store.set(bootAtom, { phase: 'signedOut', slot: held, error: { kind: 'node', message: 'fetch failed' } });
    await waitFor(() => expect(screen.queryByTestId('sign-in')).toBeNull());
    expect(store.get(signInAtom)).toBe(false);
    store.set(signInAtom, true);
    await waitFor(() => expect(screen.getByText('Welcome back.')).toBeTruthy());
    expect(screen.queryByTestId('opening-failed')).toBeNull();
    // The keys step failing names the download; a held tab keeps its own note.
    cleanup();
    const crsFailed = opening({
      key: { state: 'done' },
      crs: { state: 'failed', reason: 'failed', bytes: { loaded: 13 * 2 ** 20, total: 20 * 2 ** 20 } },
    });
    const s2 = createStore();
    s2.set(signInAtom, true);
    s2.set(bootAtom, {
      phase: 'signedOut',
      slot: held,
      error: { kind: 'other', message: 'x', step: 'crs' },
      opening: crsFailed,
      typedWords: true,
    });
    render(
      <Provider store={s2}>
        <SignInDialog session={session} />
      </Provider>,
    );
    expect(screen.getByText("The miner's files didn't download.")).toBeTruthy();
    expect(screen.getByTestId('key-error').textContent).toContain(
      'The connection dropped at 13.0 of 20 MB. Retry keeps what arrived.',
    );
    expect(screen.queryByTestId('opening-change-node')).toBeNull();
    // A retry of a typed login keeps the empty-account hint's provenance.
    fireEvent.click(screen.getByTestId('opening-retry'));
    expect(session.open).toHaveBeenLastCalledWith(record, true);
  });

  test('Cancel is disabled while the ceremony (the key step) is still active', () => {
    const store = createStore();
    const steps = opening({ key: { state: 'active' } });
    store.set(bootAtom, { phase: 'opening', steps });
    render(
      <Provider store={store}>
        <SignInDialog session={session} />
      </Provider>,
    );
    expect((screen.getByTestId('opening-cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the page hotkeys', () => {
  test('do nothing while the dialog is open, and work once it is closed', () => {
    const start = vi.fn();
    const controller = () => ({ start, stop: vi.fn(), reconfigure: vi.fn() }) as unknown as MinerController;
    function Keys({ enabled }: { enabled: boolean }) {
      useHotkeys(controller, start, consent, enabled);
      return null;
    }
    const { rerender } = render(
      <Provider store={createStore()}>
        <Keys enabled={false} />
      </Provider>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(start).not.toHaveBeenCalled();
    rerender(
      <Provider store={createStore()}>
        <Keys enabled />
      </Provider>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('Space stops wherever the button says Stop: an attempt on its way, a claim in flight', () => {
    const start = vi.fn();
    const stop = vi.fn();
    const controller = () => ({ start, stop, reconfigure: vi.fn() }) as unknown as MinerController;
    function Keys() {
      useHotkeys(controller, start, consent);
      return null;
    }
    const store = createStore();
    const fore = {
      lineId: 1,
      epoch: 3n,
      attempts: 1,
      kind: 'anchor-pruned',
      sent: false,
      auto: true,
      held: false,
      more: false,
    } as const;
    store.set(minerAtom, { ...store.get(minerAtom), recovery: { fore, watching: false, checks: 0 } });
    render(
      <Provider store={store}>
        <Keys />
      </Provider>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    store.set(minerAtom, { ...store.get(minerAtom), phase: 'claiming' });
    fireEvent.keyDown(window, { key: ' ' });
    expect([stop.mock.calls.length, start.mock.calls.length]).toEqual([2, 0]);
  });

  test('[ and ] move the threads only while the slider is shown: found under consent, they change nothing', () => {
    const reconfigure = vi.fn();
    const controller = () => ({ start: vi.fn(), stop: vi.fn(), reconfigure }) as unknown as MinerController;
    function Keys() {
      useHotkeys(controller, vi.fn(), consent);
      return null;
    }
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 12, configurable: true });
    const store = createStore();
    store.set(settingsAtom, { threads: 5 });
    const eligible = {
      available: true,
      needsDownload: false,
      schemes: ['ultra_honk'],
      protocol: 'https',
    } as const;
    store.set(prestoAtom, { ...initialPresto, consentRev: 0, status: eligible });
    render(
      <Provider store={store}>
        <Keys />
      </Provider>,
    );
    fireEvent.keyDown(window, { key: '[' });
    expect(store.get(settingsAtom).threads).toBe(5);
    expect(reconfigure).not.toHaveBeenCalled();
    store.set(prestoAtom, {
      ...initialPresto,
      consentRev: 0,
      status: { available: false, reason: 'offline' },
    });
    fireEvent.keyDown(window, { key: '[' });
    expect(store.get(settingsAtom).threads).toBe(4);
    expect(reconfigure).toHaveBeenCalledWith(4);
  });
});
