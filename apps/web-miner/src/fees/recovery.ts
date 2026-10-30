// A funding's identity and the file that brings it back once the site's data is gone. The deposit
// commits to a hash of a secret the master derives for a random index, so the file needs only the
// index: no secret, no account, no amount it could be held to. Another account's file derives a
// commitment no deposit carries; a forged hint changes what the mock rebuilds, never what a real
// provider reads.

import { hkdf } from '@yacana/miner-core/keys/derive';
import type { FundingHint, Token } from './provider';

export const RECORD_VERSION = 1;
export const RECORD_KIND = 'yacana-fee-funding';
/** A file above this is refused unread. */
export const MAX_RECORD_BYTES = 64 * 1024;
/** Labels the secret; pinned, since changing it orphans every funding ever made. */
const SECRET_INFO = 'yacana.fees.v1';
/** Random, so no journal is needed to avoid reuse, and never a bound anything scans to. */
const INDEX_LIMIT = 2 ** 48;
/** The last millisecond a JavaScript Date represents. */
const MAX_TIME_MS = 8_640_000_000_000_000;
/** Under the flag the flow never reads the session's master: this public one stands in, so its commitments guard nothing. */
export const STAND_IN_MASTER: Uint8Array = new Uint8Array(32).fill(0x59);

/** Where a funding lives: the rollup's Ethereum chain and its version, as decimal strings. */
export interface FundingScope {
  readonly chainId: string;
  readonly rollupVersion: string;
}

export interface FundingRecord extends FundingScope {
  readonly v: typeof RECORD_VERSION;
  readonly kind: typeof RECORD_KIND;
  readonly index: number;
  readonly createdAt: number;
  readonly hint: FundingHint;
}

/** A record whose download the visitor started, and the commitment its deposit carries. */
export interface Saved {
  readonly record: FundingRecord;
  readonly commit: string;
}

export const randomIndex = (): number =>
  crypto.getRandomValues(new Uint8Array(6)).reduce((v, b) => v * 256 + b, 0);

export const newRecord = (
  scope: FundingScope,
  hint: FundingHint,
  createdAt: number,
  index = randomIndex(),
): FundingRecord => ({ v: RECORD_VERSION, kind: RECORD_KIND, ...scope, index, createdAt, hint });

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The commitment a funding's deposit carries. SHA-256 of the secret stands in for the claim's
 * Poseidon2 secret hash, which needs bb's wasm in the page; the label and the index are what bind it.
 */
export async function commitOf(master: Uint8Array, r: FundingScope & { index: number }): Promise<string> {
  if (master.length !== 32) throw new Error(`master is ${master.length} bytes, expected 32`);
  const secret = await hkdf(master, `${SECRET_INFO}:${r.chainId}:${r.rollupVersion}:${r.index}`, 32);
  return `0x${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', secret as BufferSource)))}`;
}

export const fileName = (r: FundingRecord): string => `yacana-fees-${r.chainId}-${r.index}.json`;

/** The record as its file spells it: the amount a decimal string, since JSON has no bigint. */
export const toFile = (r: FundingRecord) => ({
  ...r,
  hint: { token: r.hint.token, amountIn: r.hint.amountIn.toString() },
});

/** Why a file cannot resume a funding; its message is the line the visitor reads. */
export class RecordRefused extends Error {
  override readonly name = 'RecordRefused';
}

export const TOO_LARGE = 'The file is larger than a recovery file can be.';
const NOT_A_RECORD = 'The file is not a fee funding’s recovery file.';
const ELSEWHERE = 'The file is for another network.';
const damaged = (field: string) => new RecordRefused(`The file is damaged: ${field} is malformed.`);

const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
const HEX20 = /^0x[0-9a-fA-F]{40}$/;
/** Printable text of a bounded length: it is rendered, and a symbol is part of a test id. */
const label = (max: number) => new RegExp(`^[^\\p{C}]{1,${max}}$`, 'u');
const SYMBOL = label(16);
const NAME = label(64);

type Fields = Record<string, unknown>;

/** An object with exactly these keys, or a refusal naming `where`. */
function closed(raw: unknown, keys: readonly string[], where: string): Fields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw damaged(where);
  const o = raw as Fields;
  const extra = Object.keys(o).find((k) => !keys.includes(k));
  if (extra !== undefined) throw damaged(`${where}.${extra}`);
  return o;
}

const whole = (v: unknown, below: number, where: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v >= below) throw damaged(where);
  return v;
};

const text = (v: unknown, re: RegExp, where: string): string => {
  if (typeof v !== 'string' || !re.test(v)) throw damaged(where);
  return v;
};

function parseToken(raw: unknown): Token {
  const o = closed(raw, ['chainId', 'address', 'symbol', 'name', 'decimals'], 'hint.token');
  return {
    chainId: whole(o.chainId, Number.MAX_SAFE_INTEGER, 'hint.token.chainId'),
    address: text(o.address, HEX20, 'hint.token.address'),
    symbol: text(o.symbol, SYMBOL, 'hint.token.symbol'),
    name: text(o.name, NAME, 'hint.token.name'),
    decimals: whole(o.decimals, 37, 'hint.token.decimals'),
  };
}

function parseHint(raw: unknown): FundingHint {
  const o = closed(raw, ['token', 'amountIn'], 'hint');
  const amountIn = BigInt(text(o.amountIn, DECIMAL, 'hint.amountIn'));
  if (amountIn === 0n) throw damaged('hint.amountIn');
  return { token: parseToken(o.token), amountIn };
}

/** A recovery file's text, checked whole against `scope`; throws a RecordRefused for anything else. */
export function parseRecord(json: string, scope: FundingScope): FundingRecord {
  if (new TextEncoder().encode(json).length > MAX_RECORD_BYTES) throw new RecordRefused(TOO_LARGE);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new RecordRefused(NOT_A_RECORD);
  }
  const top = raw as Fields | null;
  if (typeof top !== 'object' || top === null || top.v !== RECORD_VERSION || top.kind !== RECORD_KIND)
    throw new RecordRefused(NOT_A_RECORD);
  const o = closed(raw, ['v', 'kind', 'chainId', 'rollupVersion', 'index', 'createdAt', 'hint'], 'record');
  const chainId = text(o.chainId, DECIMAL, 'chainId');
  const rollupVersion = text(o.rollupVersion, DECIMAL, 'rollupVersion');
  if (chainId !== scope.chainId || rollupVersion !== scope.rollupVersion) throw new RecordRefused(ELSEWHERE);
  return newRecord(
    { chainId, rollupVersion },
    parseHint(o.hint),
    whole(o.createdAt, MAX_TIME_MS + 1, 'createdAt'),
    whole(o.index, INDEX_LIMIT, 'index'),
  );
}
