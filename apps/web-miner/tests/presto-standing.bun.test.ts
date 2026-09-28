// The browser's permission as the page reads it, and the one reading of Presto's standing that both
// surfaces show.
import { describe, expect, test } from 'bun:test';
import type { PrestoStatus } from '@alejoamiras/presto-core';
import {
  initialPresto,
  type Lna,
  lnaState,
  mayAsk,
  type PrestoState,
  prestoDecides,
  prestoStanding,
} from '../src/presto.ts';
import type { ConsentRecord } from '../src/presto-consent.ts';

type Query = Pick<Permissions, 'query'>;

/** A Permissions API that knows the listed descriptors and rejects the rest, as browsers do. */
function permissions(known: Record<string, PermissionState>) {
  const statuses = new Map<string, PermissionStatus>();
  const query: Query = {
    query: ({ name }) => {
      const state = known[name];
      if (!state) return Promise.reject(new TypeError(`unknown descriptor ${name}`));
      const status = { name, state, onchange: null } as unknown as PermissionStatus;
      statuses.set(name, status);
      return Promise.resolve(status);
    },
  };
  return {
    query,
    /** The browser changing its mind for the descriptor that answered. */
    change(name: string, state: PermissionState) {
      const s = statuses.get(name) as { state: PermissionState; onchange: (() => void) | null };
      s.state = state;
      s.onchange?.();
    },
  };
}

describe('lnaState', () => {
  test('the split descriptor answers first; the legacy one when the split is unknown; neither is unknown', async () => {
    expect(
      await lnaState(permissions({ 'loopback-network': 'granted', 'local-network-access': 'denied' }).query),
    ).toBe('granted');
    expect(await lnaState(permissions({ 'local-network-access': 'prompt' }).query)).toBe('prompt');
    expect(await lnaState(permissions({ 'local-network-access': 'denied' }).query)).toBe('denied');
    expect(await lnaState(permissions({}).query)).toBe('unknown');
    expect(await lnaState(undefined)).toBe('unknown');
  });

  test('the status that answered keeps the page current', async () => {
    const p = permissions({ 'local-network-access': 'prompt' });
    const seen: Lna[] = [];
    expect(await lnaState(p.query, (s) => seen.push(s))).toBe('prompt');
    p.change('local-network-access', 'granted');
    p.change('local-network-access', 'denied');
    expect(seen).toEqual(['granted', 'denied']);
  });

  test('an automatic probe needs consent and a browser that will not prompt', () => {
    const table: Array<[boolean, Lna, boolean]> = [
      [true, 'granted', true],
      [true, 'unknown', true],
      [true, 'prompt', false],
      [true, 'denied', false],
      [true, 'pending', false],
      [false, 'granted', false],
    ];
    for (const [consented, lna, asks] of table) expect(mayAsk(consented, lna)).toBe(asks);
  });
});

const eligible = {
  available: true,
  needsDownload: false,
  schemes: ['ultra_honk'],
  protocol: 'https',
} as PrestoStatus;
const offline = { available: false, reason: 'unreachable', protocol: 'https' } as unknown as PrestoStatus;
const blockedByBrowser = {
  available: false,
  reason: 'permission-blocked',
  protocol: 'https',
} as PrestoStatus;

const never: ConsentRecord = { used: false, rev: 0 };
const used: ConsentRecord = { used: true, rev: 0 };
const clicked: Partial<PrestoState> = { consentRev: 0 };

describe('prestoStanding', () => {
  const standing = (s: Partial<PrestoState>, record: ConsentRecord, lna: Lna = 'granted', mining = true) =>
    prestoStanding({ ...initialPresto, ...s }, record, lna, mining);

  test('the table over used × click × permission × status', () => {
    // Never consented: the ask, whatever the probe once said.
    expect(standing({}, never)).toBe('ask');
    expect(standing({ status: eligible }, never)).toBe('ask');
    expect(standing({ status: eligible }, never, 'unknown')).toBe('ask');
    // A click at the current revision: the look, then its answer.
    expect(standing({ ...clicked, looking: true }, never)).toBe('checking');
    expect(standing({ ...clicked, status: eligible }, never)).toBe('found');
    expect(standing({ ...clicked, status: offline }, never)).toBe('absent');
    expect(standing({ ...clicked, status: eligible, fallbackReason: 'denied' }, never)).toBe('absent');
    expect(standing({ ...clicked, status: eligible, selected: 'presto' }, never)).toBe('proving');
    // The Worker's native prover while idle: found, "proves when you start".
    expect(standing({ ...clicked, status: eligible, selected: 'presto' }, never, 'granted', false)).toBe(
      'found',
    );
    // A click at a revision a revoke has moved past is no consent.
    expect(standing({ consentRev: 0, status: eligible }, { used: false, rev: 1 })).toBe('ask');
    // Remembered: before this page asked, and once it did.
    expect(standing({}, used)).toBe('remembered');
    expect(standing({}, used, 'prompt')).toBe('remembered');
    expect(standing({ status: eligible, selected: 'presto' }, used)).toBe('proving');
    expect(standing({ status: eligible, selected: 'presto', fallbackReason: 'transient' }, used)).toBe(
      'absent',
    );
    expect(standing({ status: offline }, used)).toBe('absent');
  });

  test('the browser’s block wins, whether it says so or the probe does', () => {
    expect(standing({}, never, 'denied')).toBe('blocked');
    expect(standing({ status: eligible, selected: 'presto' }, used, 'denied')).toBe('blocked');
    expect(standing({ ...clicked, status: blockedByBrowser }, never)).toBe('blocked');
    expect(standing({ status: blockedByBrowser }, used, 'unknown')).toBe('blocked');
  });
});

describe('prestoDecides', () => {
  const decides = (s: Partial<PrestoState>, record: ConsentRecord, lna: Lna = 'granted') =>
    prestoDecides({ ...initialPresto, ...s }, record, lna);

  test('the slider steps aside once Presto is found under consent, remembered or proving, and not otherwise', () => {
    const table: Array<[string, Partial<PrestoState>, ConsentRecord, Lna, boolean]> = [
      ['found', { ...clicked, status: eligible }, never, 'granted', true],
      ['remembered', {}, used, 'granted', true],
      ['proving', { status: eligible, selected: 'presto' }, used, 'granted', true],
      ['absent', { ...clicked, status: offline }, never, 'granted', false],
      ['checking', { ...clicked, looking: true }, never, 'granted', false],
      ['consent revoked', { consentRev: 0, status: eligible }, { used: false, rev: 1 }, 'granted', false],
      ['permission denied', { status: eligible, selected: 'presto' }, used, 'denied', false],
      [
        'the WASM fallback',
        { status: eligible, selected: 'presto', fallbackReason: 'transient' },
        used,
        'granted',
        false,
      ],
    ];
    for (const [name, s, record, lna, want] of table)
      expect([name, decides(s, record, lna)]).toEqual([name, want]);
  });
});
