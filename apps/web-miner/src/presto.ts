// Presto, the native prover on the visitor's machine: where this build looks for it, the exact URLs
// the page may reach it at, the page's probe, and what the page knows about it (the probe's answer,
// the Worker's choice) with the words each state gets.
import {
  type FallbackReason,
  PrestoClient,
  type PrestoConfig,
  type PrestoPhase,
  type PrestoStatus,
} from '@alejoamiras/presto-core';
import type { PrestoStanding } from '@yacana/ui';
import { setAcceleratorEndpoints } from '@yacana/web-kit/browser/node-guard';
import { atom, type createStore } from 'jotai';
import { queryOverridesAllowed } from './config';
import { type ConsentRecord, consent, isConsented } from './presto-consent';

type Store = ReturnType<typeof createStore>;

/** The SDK's connection config, every field spelled out so the guard can derive the URLs from it. */
export interface PrestoEndpoint {
  host: string;
  port: number;
  httpsPort: number;
  /** Never a witness over plaintext: the browser default, and the production value. */
  httpsOnly: boolean;
}

/** Presto's defaults; the desktop app serves HTTPS on 59834 once its certificate is trusted. */
export const PRESTO_DEFAULT: PrestoEndpoint = {
  host: '127.0.0.1',
  port: 59833,
  httpsPort: 59834,
  httpsOnly: true,
};

/** The Aztec release this miner proves with; Presto downloads that bb once if it lacks it. */
export const PRESTO_AZTEC_VERSION = '5.2.0';

export const prestoConfig = (e: PrestoEndpoint): PrestoConfig => ({
  host: e.host,
  port: e.port,
  httpsPort: e.httpsPort,
  httpsOnly: e.httpsOnly,
});

const ROUTES = ['/health', '/prove', '/prove/ultra-honk'];

/**
 * The URLs the SDK fetches, exactly: health and prove over HTTPS, and over HTTP only when plaintext
 * is allowed (the e2e mode). Under `httpsOnly` the SDK's witness-free HTTP health diagnosis is not
 * admitted, so an installed Presto whose HTTPS is off reads as absent.
 */
export function acceleratorUrls(e: PrestoEndpoint): string[] {
  const urls = ROUTES.map((r) => `https://${e.host}:${e.httpsPort}${r}`);
  if (!e.httpsOnly) urls.push(...ROUTES.map((r) => `http://${e.host}:${e.port}${r}`));
  return urls;
}

/**
 * Where this build looks for Presto: the SDK's HTTPS defaults, or the e2e lane's plaintext port
 * (nothing listens for TLS there, so `httpsPort` is the same closed port). An e2e page on localhost
 * may move it (`?presto=<port>`) or switch it off (`?presto=off`: no probe, no banner, WASM).
 */
export function prestoEndpointFor(
  env: { e2ePort: string; overrides: boolean },
  query: URLSearchParams,
): PrestoEndpoint | null {
  const q = env.overrides ? query.get('presto') : null;
  if (q === 'off') return null;
  const port = q && /^\d+$/.test(q) ? Number(q) : env.e2ePort ? Number(env.e2ePort) : null;
  if (port !== null) return { host: '127.0.0.1', port, httpsPort: port, httpsOnly: false };
  return PRESTO_DEFAULT;
}

export const prestoEndpoint = (): PrestoEndpoint | null =>
  prestoEndpointFor(
    { e2ePort: import.meta.env.VITE_PRESTO_E2E_PORT ?? '', overrides: queryOverridesAllowed() },
    new URLSearchParams(globalThis.location?.search ?? ''),
  );

export type ProverKind = 'presto' | 'wasm';
/** Why the Worker stopped proving natively: the SDK's reason, a native proof that did not verify, or consent withdrawn. */
export type FallbackCause = FallbackReason | 'invalid-proof' | 'revoked';

export interface PrestoState {
  /** The page's own probe; null before the first answer. */
  status: PrestoStatus | null;
  probedAt: number | null;
  /** The backend the Worker built (`ready`); 'presto' says nothing about native proving yet. */
  selected: ProverKind | null;
  /** What actually proved the last proof, from the Worker's `prover` messages. */
  active: ProverKind | null;
  /** Set once the Worker's choice of WASM is sticky; cleared by a rebuild, never by a probe. */
  fallbackReason?: FallbackCause;
  /** The backend's phase worth showing (`downloading`: Presto is fetching bb before the first proof). */
  phase?: PrestoPhase;
  /** The record's `rev` when this page's Look was clicked; null until then, and again after a revoke. */
  consentRev: number | null;
  /** A Look's probe is out. */
  looking: boolean;
  /**
   * Bumped by every consent change and never reset, not even with the rest of this state: a
   * lookup publishes only on its own `gen`, so an answer from before a revoke lands nowhere.
   */
  gen: number;
}

export const initialPresto: PrestoState = {
  status: null,
  probedAt: null,
  selected: null,
  active: null,
  consentRev: null,
  looking: false,
  gen: 0,
};
export const prestoAtom = atom<PrestoState>(initialPresto);

/**
 * Where the browser stands on this page reaching loopback. `pending` until the first query settles;
 * `unknown` is a browser without the descriptor (Firefox, Safari), confirmed, never "slow".
 */
export type Lna = 'pending' | 'granted' | 'prompt' | 'denied' | 'unknown';
export const lnaAtom = atom<Lna>('pending');

/** Chromium's split descriptor first, the one it replaced when the first is unknown. */
const LNA_NAMES = ['loopback-network', 'local-network-access'];

/**
 * Queries the permission and follows the status that answered through `onChange`. No timeout: an
 * unsettled query means the browser has not answered, and nothing automatic may run until it has.
 */
export async function lnaState(
  permissions: Pick<Permissions, 'query'> | undefined,
  onChange?: (state: Lna) => void,
): Promise<Lna> {
  if (!permissions) return 'unknown';
  for (const name of LNA_NAMES) {
    let status: PermissionStatus;
    try {
      status = await permissions.query({ name: name as PermissionName });
    } catch {
      continue;
    }
    if (onChange) status.onchange = () => onChange(status.state);
    return status.state;
  }
  return 'unknown';
}

/** Settles `lnaAtom` from the browser and keeps it current; the session calls it once. */
export function watchLna(store: Store, permissions: Pick<Permissions, 'query'> | undefined): void {
  const set = (s: Lna) => store.set(lnaAtom, s);
  void lnaState(permissions, set).then(set);
}

/**
 * An automatic probe (a Start with Presto remembered) may run: consent is in force and the
 * browser will not prompt for it. Under `prompt` the user primes the prompt with a click instead;
 * `unknown` runs it, the accepted limit of a browser that re-asks without a descriptor.
 */
export const mayAsk = (consented: boolean, lna: Lna): boolean =>
  consented && (lna === 'granted' || lna === 'unknown');

export type { PrestoStanding };

const permissionBlocked = (status: PrestoStatus | null): boolean =>
  status?.available === false && status.reason === 'permission-blocked';

/**
 * `blocked` is the browser's verdict, before anything else. Under consent: the Worker's native
 * prover (`proving` while mining, `found` — "proves when you start" — while idle), then the probe's
 * answer (`found`: eligible and not given up on; `absent`: offline or a fix-it reason), then a
 * remembered Presto not yet asked this page.
 */
export function prestoStanding(
  s: PrestoState,
  record: ConsentRecord,
  lna: Lna,
  mining: boolean,
): PrestoStanding {
  if (lna === 'denied' || permissionBlocked(s.status)) return 'blocked';
  if (s.looking) return 'checking';
  if (!isConsented(record, s.consentRev)) return 'ask';
  if (prestoSticky(s)) return mining ? 'proving' : 'found';
  if (s.status) return prestoEligible(s.status) && !s.fallbackReason ? 'found' : 'absent';
  return record.used ? 'remembered' : 'ask';
}

/**
 * Presto's own speed setting decides, not the browser's threads: found (which implies consent),
 * remembered, or proving. Mining only tells found from proving, so it is not an input.
 */
export const prestoDecides = (s: PrestoState, record: ConsentRecord, lna: Lna): boolean => {
  const standing = prestoStanding(s, record, lna, false);
  return standing === 'found' || standing === 'remembered';
};

/** What the controller asks of the page's consent, for every native message the Worker sends. */
export interface ConsentHooks {
  /** Native may be published and remembered: consent is in force right now. */
  allowed(): boolean;
  /** The Worker verified this build's first native proof: Presto is remembered, at the click's revision. */
  promote(): void;
  /** A native proof did not verify: whatever was remembered is taken back. */
  forget(): void;
}

export const pageConsent = (store: Store): ConsentHooks => ({
  allowed: () => isConsented(consent.read(), store.get(prestoAtom).consentRev),
  promote: () => void consent.promote(store.get(prestoAtom).consentRev ?? consent.read().rev),
  forget: () => void consent.revoke(),
});

/** Presto's site: the billboard's link and the epoch tile's "About Presto". */
export const PRESTO_SITE = 'https://presto.build';

/**
 * Native is the prover in force: the Worker built Presto's and has not given up on it. The epoch
 * tile's row ↔ slider swap and the thread rule follow this; `active` flips on one refused proof and
 * only the pill's ✦ follows it.
 */
export const prestoSticky = (s: PrestoState): boolean => s.selected === 'presto' && !s.fallbackReason;

/** Native is worth asking for when Presto answers and serves UltraHonk; a pending bb download is not a bar. */
export const prestoEligible = (status: PrestoStatus | null): boolean =>
  status?.available === true && (status.schemes ?? []).includes('ultra_honk');

/**
 * The wallet's transaction proof goes to Presto: the page's probe saw it serve the kernel's scheme
 * and the Worker has not given up on it. The Worker's own build does not matter (it wants
 * UltraHonk); an unprobed Presto is not asked.
 */
export const prestoProvesTx = (s: PrestoState): boolean =>
  s.fallbackReason === undefined &&
  s.status?.available === true &&
  (s.status.schemes ?? []).includes('chonk');

/**
 * Who is proving the wallet's transaction, from the prover's phases: unknown until the steps are
 * transmitted (Presto) or proving begins without a transmit (the page); a fallback is the page's.
 */
export const txProvingAfter = (prev: ProverKind | null, phase: PrestoPhase): ProverKind | null => {
  switch (phase) {
    case 'detect':
      return null;
    case 'transmit':
      return 'presto';
    case 'proving':
      return prev ?? 'wasm';
    case 'fallback':
      return 'wasm';
    default:
      return prev;
  }
};

/** Who proves the miner's own claim under way, from its proof's word until it settles; null otherwise. */
export const txProvingAtom = atom<ProverKind | null>(null);

/** What a proving step says, by who proves it; the times are this machine's: Presto's own bb, or bb.js in the page. */
export const PROVING = {
  presto: {
    about: 'about 5 s',
    line: 'proves through Presto ✦, about 5 s · mining pauses meanwhile',
    detail: 'Through Presto ✦ on this machine; mining pauses meanwhile.',
    foot: 'Keep this tab open while it proves, about 5 s.',
    claim: 'claiming: proving through Presto ✦',
    how: 'With Presto, your transaction’s private inputs go to Presto on this machine, never elsewhere; mining pauses meanwhile.',
  },
  wasm: {
    about: 'about 20 s',
    line: 'proves in your browser, about 20 s · mining pauses meanwhile',
    detail: 'In your browser; mining pauses meanwhile.',
    foot: 'Keep this tab open while it proves, about 20 s.',
    claim: 'claiming: proving in your browser, about 20 s',
    how: 'Your browser proves it; mining pauses meanwhile.',
  },
} as const satisfies Record<ProverKind, Record<string, string>>;

/**
 * The guard's deadline on Presto's routes, in the Worker and the page alike: a proof may wait behind
 * Presto's queue and, once, behind its bb download; the SDK bounds the health check itself.
 */
export const ACCELERATOR_DEADLINE_MS = 600_000;

const clients = new Map<string, PrestoClient>();
const clientFor = (e: PrestoEndpoint): PrestoClient => {
  const key = JSON.stringify(e);
  let c = clients.get(key);
  if (!c) {
    c = new PrestoClient({ presto: prestoConfig(e), aztecVersion: PRESTO_AZTEC_VERSION });
    clients.set(key, c);
  }
  return c;
};

/**
 * The page's probe: the guard of this realm learns Presto's URLs, the SDK asks `/health` (10 s
 * cache unless forced). Only the session calls it, after consent, and publishes the answer itself
 * so a lookup overtaken by a revoke lands nowhere. Never awaited by the boot or the sign-in.
 */
export function probePresto(endpoint: PrestoEndpoint, force = false): Promise<PrestoStatus> {
  setAcceleratorEndpoints(acceleratorUrls(endpoint), ACCELERATOR_DEADLINE_MS);
  return clientFor(endpoint).checkStatus({ forceRefresh: force });
}

/**
 * What the page is told about a native proof's phases: the start of a bb download, and the end of the
 * proving that follows it. The SDK walks serialize → transmit → proving between the two, so only a
 * finished or abandoned proof ends the download; every other phase is the page's business to ignore.
 */
export function downloadPhases(post: (phase: PrestoPhase) => void): (phase: PrestoPhase) => void {
  let downloading = false;
  return (phase) => {
    if (phase === 'downloading') {
      if (downloading) return;
      downloading = true;
    } else if (!downloading || (phase !== 'proved' && phase !== 'fallback')) return;
    else downloading = false;
    post(phase);
  };
}

export interface PrestoNotice {
  tone: 'warn' | 'info';
  text: string;
  retry: boolean;
}

const UPDATE =
  'Presto needs an update for this app. Open Presto from your menu bar and let it update, then retry.';
const ENCRYPTED =
  'Presto’s encrypted connection is off. Presto › Settings › Encrypted Connection, then retry.';
const GONE = 'Presto stopped answering. Proving in the browser; retry when it’s back.';

/** The Worker's sticky reasons, in the visitor's terms; the site is named so the approval step is unmistakable. */
const causeText = (cause: FallbackCause, site: string): string => {
  switch (cause) {
    case 'denied':
      return `Presto hasn’t approved ${site} yet. Approve it in the Presto app, then retry. Proving in the browser meanwhile.`;
    case 'cooldown':
      return `Presto is in a cooldown after a denial. Approve ${site} in the app; Retry works once the cooldown ends, about a minute.`;
    case 'transient':
      return 'Presto is busy: three proofs in a row refused. Proving in the browser; Retry tries it again.';
    case 'invalid-proof':
      return 'Presto returned a winning proof that didn’t verify. Proving in the browser; check the Presto install, then retry.';
    case 'malformed-response':
      return 'Presto answered with something this page couldn’t use. Proving in the browser; Retry tries it again.';
    case 'version-mismatch':
    case 'scheme-unsupported':
    case 'route-missing':
      return UPDATE;
    case 'secure-connection-unavailable':
      return ENCRYPTED;
    default:
      return GONE;
  }
};

/** What the probe alone says needs fixing; null for "absent" (the billboard's case) and for "fine". */
const statusText = (status: PrestoStatus): string | null => {
  if (status.available) return prestoEligible(status) ? null : UPDATE;
  switch (status.reason) {
    case 'permission-blocked':
      return 'Your browser blocked local access, so this page can’t reach Presto. Allow local network access for this site, then retry. Mining in the browser meanwhile.';
    case 'secure-connection-unavailable':
      return status.diagnosis === 'unconfirmed' ? null : ENCRYPTED;
    case 'version-mismatch':
      return UPDATE;
    case 'error':
      return 'Presto answered, but not with a health report this page understands. Proving in the browser; Retry asks again.';
    default:
      return null;
  }
};

/** The fix-it row's content: the Worker's verdict first, then a download in progress, then the probe's. */
export function noticeFor(
  s: PrestoState,
  site = globalThis.location?.hostname ?? 'this site',
): PrestoNotice | null {
  // A revoke is the user's own doing: nothing to fix.
  if (s.fallbackReason === 'revoked') return null;
  if (s.fallbackReason) return { tone: 'warn', text: causeText(s.fallbackReason, site), retry: true };
  if (s.phase === 'downloading')
    return {
      tone: 'info',
      text: `Presto is fetching its prover for Aztec ${PRESTO_AZTEC_VERSION}. The first native proof waits for it; the rate stalls until then.`,
      retry: false,
    };
  if (!s.status) return null;
  const text = statusText(s.status);
  return text ? { tone: 'warn', text, retry: true } : null;
}
