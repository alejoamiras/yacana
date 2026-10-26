// Where the page connects. The build carries the deployment (apps/site); the user may pick
// another node and another Ethereum RPC, persisted in localStorage and shared by the three apps;
// e2e builds may pin everything by query. A node is only ever used after it passed the deployment
// check; an RPC after it answered for the portal's chain.
export interface Connection {
  nodeUrl: string;
  /** The Ethereum JSON-RPC the bridge reads through and the guard admits beside the node. */
  ethRpcUrl: string;
  miner: string;
  token: string;
  /** The first epoch this miner has (0, or a continuation's start): no read goes below it. */
  firstEpoch: number;
}

export interface Expected {
  chainId: bigint;
  rollupVersion: bigint;
  rollupAddress: string;
  minerClassId: string;
  tokenClassId: string;
}

const KEY = 'yacana.connection';

/** The two settings a user owns; the deployment is the build's. */
type Saved = Partial<Pick<Connection, 'nodeUrl' | 'ethRpcUrl'>>;

const defaults: Connection = {
  nodeUrl: import.meta.env.VITE_AZTEC_NODE_URL,
  ethRpcUrl: import.meta.env.VITE_ETH_RPC_URL,
  miner: import.meta.env.VITE_YACANA_MINER,
  token: import.meta.env.VITE_YACANA_TOKEN,
  firstEpoch: Number(import.meta.env.VITE_FIRST_EPOCH || 0),
};

/** The build's default node: what "Use the default" restores (read live, so a test may stub it). */
export const defaultNodeUrl = (): string => import.meta.env.VITE_AZTEC_NODE_URL;

/**
 * Every default the site's builds carried before this one; a saved node equal to one is no choice.
 * Append the old `VITE_AZTEC_NODE_URL` whenever site.env's changes.
 */
const RETIRED_DEFAULT_NODES: readonly string[] = ['https://v5.testnet.rpc.aztec-labs.com'];

/** One spelling per node: the tile saves `URL.href` (`https://host/`), site.env names `https://host`. */
const sameNode = (a: string, b: string): boolean => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};
const isRetiredDefault = (url: string): boolean => RETIRED_DEFAULT_NODES.some((d) => sameNode(url, d));
/** Whether `url` is the build's default node, however it is spelled. */
export const isDefaultNode = (url: string): boolean => sameNode(url, defaultNodeUrl());
export const defaultEthRpcUrl = (): string => import.meta.env.VITE_ETH_RPC_URL;
/** The build's first epoch: the floor of every window, page and history read. */
export const firstEpoch = (): number => defaults.firstEpoch;

/** Back to the build's node and a fresh boot: the way out of a saved node that does not answer. */
export const restoreDefaultNode = (): void => {
  // Reload only once the write lands (it clears the saved node): a browser that refused it would
  // otherwise reload straight back into the broken one. The banner stays up until the write can land.
  if (saveConnection({ nodeUrl: defaults.nodeUrl })) location.reload();
};

/** The miner's Node settings, from any of the three apps on the one origin. */
export const NODE_SETTINGS_HREF = '/mine/settings/';

/** The build's deployment identity, checked against the node at boot and before any switch. */
export const expectedDeployment = (): Expected => ({
  chainId: BigInt(import.meta.env.VITE_CHAIN_ID),
  rollupVersion: BigInt(import.meta.env.VITE_ROLLUP_VERSION),
  rollupAddress: import.meta.env.VITE_ROLLUP_ADDRESS,
  minerClassId: import.meta.env.VITE_YACANA_MINER_CLASS,
  tokenClassId: import.meta.env.VITE_YACANA_TOKEN_CLASS,
});

/**
 * A crafted link must not point a production page at another deployment on the allowed node;
 * only an e2e build on loopback (by name, or by the IPv4 address a lane binds) honours the query.
 */
export const queryOverridesAllowed = (hostname = globalThis.location?.hostname): boolean =>
  import.meta.env.VITE_E2E_QUERY_OVERRIDES === '1' && (hostname === 'localhost' || hostname === '127.0.0.1');

const fromQuery = (): Partial<Connection> => {
  if (!queryOverridesAllowed()) return {};
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const pick = (k: string) => q.get(k) ?? undefined;
  return {
    ...(pick('node') && { nodeUrl: pick('node') }),
    ...(pick('ethRpc') && { ethRpcUrl: pick('ethRpc') }),
    ...(pick('miner') && { miner: pick('miner') }),
    ...(pick('token') && { token: pick('token') }),
  } as Partial<Connection>;
};

const fromStorage = (): Saved => {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Saved;
    return {
      ...(stored.nodeUrl && !isRetiredDefault(stored.nodeUrl) ? { nodeUrl: stored.nodeUrl } : {}),
      ...(stored.ethRpcUrl ? { ethRpcUrl: stored.ethRpcUrl } : {}),
    };
  } catch {
    return {};
  }
};

export const loadConnection = (): Connection => ({ ...defaults, ...fromStorage(), ...fromQuery() });

/**
 * Saves one or both settings, keeping the other. A default node, today's or a retired one, is saved as
 * no choice, so a later default reaches this visitor. False when the browser refused the write (quota,
 * private mode): the caller must not act as if it held.
 */
export const saveConnection = (c: Saved): boolean => {
  try {
    const next: Saved = { ...fromStorage(), ...c };
    if (c.nodeUrl !== undefined && (isDefaultNode(c.nodeUrl) || isRetiredDefault(c.nodeUrl)))
      delete next.nodeUrl;
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
    return globalThis.localStorage?.getItem(KEY) !== null;
  } catch {
    return false;
  }
};

/** The query string wins over storage, so an E2E page can never pick up a stale saved node. */
export const isPinnedByQuery = (): boolean => Object.keys(fromQuery()).length > 0;
/** An e2e page naming its own Ethereum RPC: the one case a build without a portal reads L1. */
export const ethRpcPinnedByQuery = (): boolean => fromQuery().ethRpcUrl !== undefined;
