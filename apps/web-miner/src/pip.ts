// A Document Picture-in-Picture window (Chromium): the page's styles are carried over, the shell
// renders into its body (`PipHost`). Closing it, or the page, ends it.
import { atom, type createStore } from 'jotai';

type Store = ReturnType<typeof createStore>;

export interface PipApi {
  requestWindow(o: { width: number; height: number }): Promise<Window>;
}

export const pipSupported = (w: Window = window): boolean => 'documentPictureInPicture' in w;

export const PIP_SIZE = { width: 360, height: 216 };

/** The open mini window; whatever route the page shows, `PipHost` renders into it. */
export const pipWindowAtom = atom<Window | null>(null);

/**
 * Copies the page's styles into the pop-out. Linked stylesheets are re-linked by URL so their relative
 * `url()`s (the self-hosted font files) resolve against the sheet, not against the pop-out's document, which
 * has no base and whose CSP forbids one; inline `<style>` elements (Radix, Sonner, the dev server) are copied
 * as text.
 */
export function copyStyles(from: Document, to: Document): void {
  for (const node of Array.from(from.querySelectorAll('link[rel="stylesheet"], style'))) {
    if (node instanceof HTMLLinkElement) {
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href;
      to.head.append(link);
    } else {
      const style = to.createElement('style');
      style.textContent = node.textContent;
      to.head.append(style);
    }
  }
  to.documentElement.className = from.documentElement.className;
}

/**
 * Follows the window's life from before it is published, so a close that comes first is not missed:
 * `pagehide` clears the atom, and the page's theme class is carried over while it stays open.
 */
function track(store: Store, from: Document, pip: Window): void {
  const theme = new MutationObserver(() => {
    pip.document.documentElement.className = from.documentElement.className;
  });
  theme.observe(from.documentElement, { attributes: true, attributeFilter: ['class'] });
  pip.addEventListener(
    'pagehide',
    () => {
      theme.disconnect();
      if (store.get(pipWindowAtom) === pip) store.set(pipWindowAtom, null);
    },
    { once: true },
  );
}

let pending: Promise<Window | null> | null = null;

/**
 * Opens the mini window, or resolves to the one already open or being opened. Call it synchronously
 * from a click: the browser opens it only inside a user activation, so outside one (and on a refusal
 * or a browser without the API) it resolves to null and never throws.
 */
export function openPip(store: Store, w: Window = window): Promise<Window | null> {
  const open = store.get(pipWindowAtom);
  if (open && !open.closed) return Promise.resolve(open);
  if (open) store.set(pipWindowAtom, null);
  if (pending) return pending;
  const api = (w as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
  if (!api || w.navigator.userActivation?.isActive === false) return Promise.resolve(null);
  let request: Promise<Window>;
  try {
    request = api.requestWindow(PIP_SIZE);
  } catch {
    return Promise.resolve(null);
  }
  pending = request
    .then((pip) => {
      if (pip.closed) return null;
      copyStyles(w.document, pip.document);
      track(store, w.document, pip);
      store.set(pipWindowAtom, pip);
      return pip;
    })
    .catch(() => null);
  void pending.finally(() => {
    pending = null;
  });
  return pending;
}
