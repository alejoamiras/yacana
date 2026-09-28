import { useStore } from 'jotai';
import { useCallback } from 'react';
import { openPip } from '../pip';
import { navigate, routeFromPath, signInShowsOn } from '../routes';
import { settingsAtom } from '../settings';
import { bootAtom, mineIntentAtom, signInAtom } from '../state';

/**
 * Every Start button's click. Signed in: the mini window when the setting asks (requested inside the click's
 * activation, never awaited), then mining. Signed out: the intent, the sign-in and Presto's probe, on Mine
 * when the page has no sign-in (the mini window's Start over Stats or Settings).
 */
export function useStartClick(onStart: () => void): () => void {
  const store = useStore();
  return useCallback(() => {
    if (store.get(bootAtom).phase !== 'ready') {
      store.set(mineIntentAtom, true);
      store.set(signInAtom, true);
      if (!signInShowsOn(routeFromPath(location.pathname))) navigate('mine');
      onStart();
      return;
    }
    if (store.get(settingsAtom).pipOnStart) void openPip(store);
    onStart();
  }, [store, onStart]);
}
