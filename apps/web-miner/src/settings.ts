// User settings, one localStorage key; every field has a default so a partial or foreign value
// degrades to the defaults instead of breaking boot.

import type { Theme } from '@yacana/ui';
import { atom, useAtom } from 'jotai';

export interface Settings {
  /** undefined = cores − 1 (the max). */
  threads?: number;
  pauseOnBattery: boolean;
  backgroundProving: boolean;
  /** Turns on after the first Start; never on the first visit. */
  resumeOnOpen: boolean;
  notify: boolean;
  sound: boolean;
  tabStatus: boolean;
  /** A signed-in Start click also opens the mini window (a click is what a browser lets open it). */
  pipOnStart: boolean;
  theme: Theme;
  /** Passkey keys: keep the sealed master on this device instead of a touch per open. */
  stayOpen: boolean;
}

export const KEY = 'yacana.settings';

export const DEFAULTS: Settings = {
  pauseOnBattery: false,
  backgroundProving: true,
  resumeOnOpen: false,
  notify: false,
  sound: false,
  tabStatus: true,
  pipOnStart: false,
  theme: 'dark',
  stayOpen: false,
};

export const BOOLEANS = [
  'pauseOnBattery',
  'backgroundProving',
  'resumeOnOpen',
  'notify',
  'sound',
  'tabStatus',
  'pipOnStart',
  'stayOpen',
] as const;
export type BooleanSetting = (typeof BOOLEANS)[number];

export function parseSettings(raw: string | null): Settings {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>;
  } catch {
    /* foreign value: defaults */
  }
  const s: Settings = { ...DEFAULTS };
  for (const k of BOOLEANS) if (typeof v[k] === 'boolean') s[k] = v[k] as boolean;
  if (v.theme === 'dark' || v.theme === 'light' || v.theme === 'system') s.theme = v.theme;
  if (typeof v.threads === 'number' && Number.isInteger(v.threads) && v.threads >= 1) s.threads = v.threads;
  return s;
}

export const loadSettings = (): Settings => {
  try {
    return parseSettings(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return { ...DEFAULTS };
  }
};

export const saveSettings = (s: Settings): void => {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the session keeps them */
  }
};

const base = atom<Settings>(loadSettings());
export const settingsAtom = atom(
  (get) => get(base),
  (get, set, patch: Partial<Settings>) => {
    const next = { ...get(base), ...patch };
    set(base, next);
    saveSettings(next);
  },
);

export const useSettings = () => useAtom(settingsAtom);
