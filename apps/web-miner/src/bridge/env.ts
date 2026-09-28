// The two bridge blocks the build carries, parsed once per read: nothing else in the page decides
// whether the bridge exists. Kept free of the wallet stack so a tile can ask without loading it.

import type { BridgeRecord, LifecycleRecord, MigrationRecord } from '@yacana/bridge/record';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';

/** The build's portal, or null before the L1 deploy: no bridge features then. */
export const bridgeRecord = (): BridgeRecord | null =>
  import.meta.env.VITE_BRIDGE ? (JSON.parse(import.meta.env.VITE_BRIDGE) as BridgeRecord) : null;

/** The announced upgrade, or null on a quiet version. */
export const migrationRecord = (): MigrationRecord | null =>
  import.meta.env.VITE_MIGRATION ? (JSON.parse(import.meta.env.VITE_MIGRATION) as MigrationRecord) : null;

/** The operator's notes on a retired version (the stop, the node gone), or null while none is noted. */
export const lifecycleRecord = (): LifecycleRecord | null =>
  import.meta.env.VITE_LIFECYCLE ? (JSON.parse(import.meta.env.VITE_LIFECYCLE) as LifecycleRecord) : null;

/** The versioned origin's build: it restores accounts and moves what is left, and mines nothing. */
export const isOldRole = (): boolean => import.meta.env.VITE_APP_ROLE === 'old';

/** A build that continues an earlier version's epochs: send-aheads from that version land here. */
export const isContinuation = (): boolean =>
  !!import.meta.env.VITE_DEPLOYMENT_RECORD &&
  (JSON.parse(import.meta.env.VITE_DEPLOYMENT_RECORD) as { continuation?: unknown }).continuation !==
    undefined;

/** A version by name: this build's from the record, the canonical's from the view; any other has no name here. */
export const versionNameOf = (
  number: string | bigint | undefined,
  canonical?: { version: bigint; index: bigint },
): string => {
  if (number === undefined) return 'the next version';
  const n = number.toString();
  if (n === import.meta.env.VITE_ROLLUP_VERSION) return ownVersionName();
  if (canonical && canonical.version.toString() === n) return `V${canonical.index}`;
  return 'another version';
};

/**
 * The version after this one, by name: the canonical one when it is already another than this
 * build's, the announced upgrade's otherwise. Unnamed until one of the two says so — the page never
 * invents a number for a version nobody has registered.
 */
export const nextVersionName = (canonical?: { version: bigint; index: bigint }): string => {
  if (canonical && canonical.version.toString() !== import.meta.env.VITE_ROLLUP_VERSION)
    return `V${canonical.index}`;
  const m = migrationRecord();
  return m ? `V${m.toIndex}` : 'the next version';
};

export interface ServedBuild {
  miner?: string;
  rollupVersion?: string;
  commit?: string;
}

/** The deployment the site serves now, from its `/build.json`; null when unreadable. */
export async function servedBuild(): Promise<ServedBuild | null> {
  const url = `${(import.meta.env.BASE_URL ?? '/').replace(/\/mine\/?$/, '/')}build.json`;
  try {
    return (await (await fetch(url, { cache: 'no-store' })).json()) as ServedBuild;
  } catch {
    return null;
  }
}

/** Whether the site serves another build of the code than this tab's (its lazy chunks are gone); an unreadable file is not. */
export const redeployed = (served: ServedBuild | null): boolean =>
  !!served?.commit && served.commit !== import.meta.env.VITE_SOURCE_COMMIT;

/** Whether the served build is another deployment than this tab's; an unreadable file is not. */
export const staleTab = (
  served: ServedBuild | null,
  mine: { miner: string; rollupVersion: string },
): boolean =>
  !!served?.miner &&
  !!served.rollupVersion &&
  (served.miner.toLowerCase() !== mine.miner.toLowerCase() || served.rollupVersion !== mine.rollupVersion);
