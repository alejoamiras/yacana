import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PipHost } from './features/PipHost';
import { openPip, type PipApi, pipWindowAtom } from './pip';
import { bootAtom, epochAtom, mineIntentAtom, signInAtom } from './state';

// The strip is a canvas, tested in `ui`.
vi.mock('@yacana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@yacana/ui')>()),
  ScoreLoop: () => null,
}));

beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  cleanup();
  // Each window closes as a real one would, so no observer of a past test sees the next one's changes.
  for (const f of frames.splice(0)) {
    act(() => {
      f.contentWindow?.dispatchEvent(new Event('pagehide'));
    });
    f.remove();
  }
});

/** Another document to render into, standing in for the Picture-in-Picture window. */
function frame(): Window {
  const f = document.createElement('iframe');
  document.body.append(f);
  frames.push(f);
  return f.contentWindow as Window;
}

/** The page as `openPip` sees it: the API, the click's activation, and this document. */
const host = (requestWindow: PipApi['requestWindow'], isActive = true) =>
  ({
    documentPictureInPicture: { requestWindow },
    navigator: { userActivation: { isActive } },
    document,
  }) as unknown as Window;

const mount = (store: ReturnType<typeof createStore>, onStart = () => {}) =>
  render(
    <Provider store={store}>
      <PipHost controller={() => undefined} onStart={onStart} />
    </Provider>,
  );

describe('PipHost', () => {
  test('renders into the window openPip opened; its pagehide clears the atom and the body', async () => {
    const store = createStore();
    store.set(epochAtom, { epoch: 57n, seed: 7n, target: 1n << 122n, openedAt: 0n, claims: 1 });
    mount(store);
    const pip = frame();
    await act(() =>
      openPip(
        store,
        host(async () => pip),
      ),
    );
    const footer = pip.document.querySelector('[data-testid=pip-footer]');
    expect(footer?.children).toHaveLength(2);
    expect(footer?.children[1]?.textContent).toBe('epoch 57 · 1 of 4 wins · difficulty 64.0');
    act(() => {
      pip.dispatchEvent(new Event('pagehide'));
    });
    expect(store.get(pipWindowAtom)).toBeNull();
    expect(pip.document.body.children).toHaveLength(0);
  });

  test("Start in the window is the cockpit's: signed out it asks for the account; off while one opens", async () => {
    const store = createStore();
    store.set(bootAtom, { phase: 'signedOut' } as never);
    const onStart = vi.fn();
    mount(store, onStart);
    const pip = frame();
    await act(() =>
      openPip(
        store,
        host(async () => pip),
      ),
    );
    const start = pip.document.querySelector('[data-testid=pip-start]') as HTMLButtonElement;
    fireEvent.click(start);
    expect([store.get(mineIntentAtom), store.get(signInAtom), onStart.mock.calls.length]).toEqual([
      true,
      true,
      1,
    ]);
    act(() => store.set(bootAtom, { phase: 'opening', steps: [] }));
    expect(start.disabled).toBe(true);
  });
});

describe('openPip', () => {
  test('a close before anything renders is not missed; a closed window is never handed out again', async () => {
    const store = createStore();
    const first = frame();
    await openPip(
      store,
      host(async () => first),
    );
    first.dispatchEvent(new Event('pagehide'));
    expect(store.get(pipWindowAtom)).toBeNull();
    const gone = { closed: true } as Window;
    store.set(pipWindowAtom, gone);
    const second = frame();
    expect(
      await openPip(
        store,
        host(async () => second),
      ),
    ).toBe(second);
  });

  test("the page's theme follows into the open window, and stops following once it closes", async () => {
    const store = createStore();
    const pip = frame();
    await openPip(
      store,
      host(async () => pip),
    );
    document.documentElement.className = 'light';
    await new Promise((r) => setTimeout(r, 0));
    expect(pip.document.documentElement.className).toBe('light');
    pip.dispatchEvent(new Event('pagehide'));
    document.documentElement.className = '';
    await new Promise((r) => setTimeout(r, 0));
    expect(pip.document.documentElement.className).toBe('light');
  });

  test('one window: a second call while the first is pending gets the same promise, then the open window', async () => {
    const store = createStore();
    const pip = frame();
    const requestWindow = vi.fn(async () => pip);
    const w = host(requestWindow);
    const first = openPip(store, w);
    expect(openPip(store, w)).toBe(first);
    expect(await first).toBe(pip);
    expect(store.get(pipWindowAtom)).toBe(pip);
    expect(await openPip(store, w)).toBe(pip);
    expect(requestWindow).toHaveBeenCalledTimes(1);
  });

  test('outside a user activation nothing is asked; a refusal resolves to null and leaves no window', async () => {
    const store = createStore();
    const requestWindow = vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
    expect(await openPip(store, host(requestWindow, false))).toBeNull();
    expect(requestWindow).not.toHaveBeenCalled();
    expect(await openPip(store, host(requestWindow))).toBeNull();
    expect(store.get(pipWindowAtom)).toBeNull();
    // The refused request is not left pending: the next click asks again.
    await openPip(store, host(requestWindow));
    expect(requestWindow).toHaveBeenCalledTimes(2);
  });
});
