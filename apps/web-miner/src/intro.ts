// The first visit's strip: shown until its × or the first mining, then never again on this browser.
import { atom } from 'jotai';

export const INTRO_KEY = 'yacana.intro';

/** Only `{ dismissed: true }` dismisses: an absent or foreign value leaves the strip showing. */
export function parseIntro(raw: string | null): boolean {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    return typeof v === 'object' && v !== null && (v as { dismissed?: unknown }).dismissed === true;
  } catch {
    return false;
  }
}

const storedDismissed = (): boolean => {
  try {
    return parseIntro(globalThis.localStorage?.getItem(INTRO_KEY) ?? null);
  } catch {
    return false;
  }
};

const dismissedHere = atom(false);

/** Whether the strip shows; setting it dismisses the strip for good (for this page, where storage throws). */
export const introAtom = atom(
  (get) => !get(dismissedHere) && !storedDismissed(),
  (_get, set) => {
    set(dismissedHere, true);
    try {
      globalThis.localStorage?.setItem(INTRO_KEY, JSON.stringify({ dismissed: true }));
    } catch {
      /* private mode: dismissed for this page only */
    }
  },
);
