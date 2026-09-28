// What the page does on its own: keyboard, the battery and hidden-tab pauses, resume on open.

import { clampThreads } from '@yacana/ui';
import { useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import type { MinerController } from '../controller';
import { offersStop } from '../lib/reducer';
import { lnaAtom, prestoAtom, prestoDecides } from '../presto';
import type { Consent } from '../presto-consent';
import { navigate } from '../routes';
import { type Settings, settingsAtom } from '../settings';
import { bootAtom, minerAtom } from '../state';

type Battery = {
  charging: boolean;
  addEventListener(t: 'chargingchange', l: () => void): void;
  removeEventListener(t: 'chargingchange', l: () => void): void;
};

/**
 * A focused control keeps its own keys: Space on a button is that button's click, not the page's
 * Start. An open dialog keeps every key: a transaction dialog navigated away from mid-proof is torn
 * down under its transaction.
 */
const interactive = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.closest(
      'input, textarea, select, button, a, [role="button"], [contenteditable], [role="dialog"], [role="alertdialog"]',
    ) !== null);

/** Space is the Start button's own action (`onStart`: it also re-asks Presto; only a click opens the mini window), Stop where it says Stop. */
export function useHotkeys(
  controller: () => MinerController | undefined,
  onStart: () => void,
  consent: Consent,
  enabled = true,
) {
  const store = useStore();
  useEffect(() => {
    // Off while the sign-in dialog shows: its own keys (Escape, Enter) must not reach the page.
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || interactive(e.target))
        return;
      const c = controller();
      const miner = store.get(minerAtom);
      const settings = store.get(settingsAtom);
      const cores = navigator.hardwareConcurrency || 2;
      const threads = settings.threads ?? Math.max(1, cores - 1);
      const power = (delta: number) => {
        // The slider is gone while Presto decides: its own speed setting governs, not the page's threads.
        if (prestoDecides(store.get(prestoAtom), consent.read(), store.get(lnaAtom))) return;
        const next = clampThreads(threads + delta, cores);
        store.set(settingsAtom, { threads: next });
        c?.reconfigure(next);
      };
      switch (e.key) {
        case ' ':
          e.preventDefault();
          offersStop(miner) ? c?.stop() : onStart();
          return;
        case '[':
          return power(-1);
        case ']':
          return power(1);
        case 'w':
          return navigate('wallet');
        case ',':
          return navigate('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, onStart, consent, store, enabled]);
}

/** Battery and hidden-tab pauses; both clear by themselves. */
export function usePauses(controller: () => MinerController | undefined, settings: Settings) {
  useEffect(() => {
    if (settings.backgroundProving) {
      controller()?.release('hidden');
      return;
    }
    const onVisibility = () =>
      document.hidden ? controller()?.pause('hidden') : controller()?.release('hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [controller, settings.backgroundProving]);

  useEffect(() => {
    const getBattery = (navigator as { getBattery?: () => Promise<Battery> }).getBattery;
    if (!settings.pauseOnBattery || !getBattery) {
      controller()?.release('battery');
      return;
    }
    let battery: Battery | undefined;
    const apply = () =>
      battery?.charging === false ? controller()?.pause('battery') : controller()?.release('battery');
    void getBattery.call(navigator).then((b) => {
      battery = b;
      apply();
      b.addEventListener('chargingchange', apply);
    });
    return () => battery?.removeEventListener('chargingchange', apply);
  }, [controller, settings.pauseOnBattery]);
}

/** After the first Start the page may resume by itself; never on a first visit. The session's Start, so its refusals hold. */
export function useResumeOnOpen(start: () => void) {
  const boot = useAtomValue(bootAtom);
  const store = useStore();
  useEffect(() => {
    if (boot.phase !== 'ready' || !store.get(settingsAtom).resumeOnOpen) return;
    start();
  }, [boot.phase, start, store]);
}
