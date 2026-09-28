// Presto for React: the one reading of its standing (the atom, the consent record, the permission,
// whether mining is on) and the two things a surface can do about it, for the rail and Settings alike.

import type { PrestoStanding } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import { useMemo, useSyncExternalStore } from 'react';
import { lnaAtom, prestoAtom, prestoDecides, prestoEndpoint, prestoStanding } from '../presto';
import { isConsented, consent as pageConsent } from '../presto-consent';
import type { Session } from '../session';
import { minerAtom } from '../state';

export interface PrestoView {
  /** False when this build looks for no Presto (`?presto=off`): no card anywhere. */
  configured: boolean;
  standing: PrestoStanding;
  /** Presto's own speed setting decides: the browser's slider is not in force. */
  decides: boolean;
  /** Remembered, but the browser will ask before the next look. */
  needsLook: boolean;
  look: () => void;
  /** Present while there is consent to withdraw. */
  chooseBrowser?: () => void;
}

export function usePresto(session: Session | undefined): PrestoView {
  const state = useAtomValue(prestoAtom);
  const lna = useAtomValue(lnaAtom);
  // A claim under way is not idle: the card must not fall back to "proves when you start".
  const phase = useAtomValue(minerAtom).phase;
  const mining = phase === 'mining' || phase === 'claiming';
  const consent = session?.consent ?? pageConsent;
  const record = useSyncExternalStore(consent.subscribe, consent.read, consent.read);
  const configured = useMemo(() => prestoEndpoint() !== null, []);
  const standing = prestoStanding(state, record, lna, mining);
  return {
    configured,
    standing,
    decides: prestoDecides(state, record, lna),
    needsLook: lna === 'prompt',
    look: () => void session?.lookForPresto(),
    chooseBrowser: isConsented(record, state.consentRev) ? () => void session?.chooseBrowser() : undefined,
  };
}
