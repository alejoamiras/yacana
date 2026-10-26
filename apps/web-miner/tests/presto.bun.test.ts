import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PrestoStatus } from '@alejoamiras/presto-core';
import { installNodeGuard, uninstallNodeGuard } from '@yacana/web-kit/browser/node-guard';
import {
  acceleratorUrls,
  downloadPhases,
  initialPresto,
  noticeFor,
  PRESTO_DEFAULT,
  type PrestoEndpoint,
  prestoEligible,
  prestoEndpointFor,
} from '../src/presto.ts';

beforeAll(installNodeGuard);
afterAll(uninstallNodeGuard);

const available = (schemes?: string[]): PrestoStatus =>
  ({ available: true, needsDownload: false, schemes, protocol: 'https' }) as PrestoStatus;
const unavailable = (reason: string, extra: Record<string, unknown> = {}): PrestoStatus =>
  ({ available: false, reason, protocol: 'https', ...extra }) as PrestoStatus;

describe('the endpoint per mode', () => {
  test("production is the SDK's HTTPS default; the e2e port is plaintext on itself; the query moves or disables it", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(prestoEndpointFor({ e2ePort: '', overrides: false }, q(''))).toEqual(PRESTO_DEFAULT);
    expect(prestoEndpointFor({ e2ePort: '24996', overrides: false }, q(''))).toEqual({
      host: '127.0.0.1',
      port: 24996,
      httpsPort: 24996,
      httpsOnly: false,
    });
    expect(prestoEndpointFor({ e2ePort: '24996', overrides: true }, q('?presto=off'))).toBeNull();
    expect(prestoEndpointFor({ e2ePort: '24996', overrides: true }, q('?presto=1'))?.port).toBe(1);
    // A crafted link on a production page changes nothing.
    expect(prestoEndpointFor({ e2ePort: '', overrides: false }, q('?presto=off'))).toEqual(PRESTO_DEFAULT);
    expect(prestoEndpointFor({ e2ePort: '', overrides: false }, q('?presto=1'))).toEqual(PRESTO_DEFAULT);
  });

  test('a production build reaches Presto over HTTPS only, and httpsOnly is what makes it so', () => {
    const shipped = prestoEndpointFor({ e2ePort: '', overrides: false }, new URLSearchParams(''));
    expect(shipped?.httpsOnly).toBe(true);
    for (const url of acceleratorUrls(shipped as PrestoEndpoint)) expect(url).toMatch(/^https:\/\//);
    const flipped = acceleratorUrls({ ...(shipped as PrestoEndpoint), httpsOnly: false });
    expect(flipped.some((u) => u.startsWith('http://'))).toBe(true);
  });

  test('the guard admits health and prove over HTTPS, and over HTTP only when plaintext is allowed', () => {
    expect(acceleratorUrls(PRESTO_DEFAULT)).toEqual([
      'https://127.0.0.1:59834/health',
      'https://127.0.0.1:59834/prove',
      'https://127.0.0.1:59834/prove/ultra-honk',
    ]);
    expect(acceleratorUrls({ host: '127.0.0.1', port: 5, httpsPort: 5, httpsOnly: false })).toEqual([
      'https://127.0.0.1:5/health',
      'https://127.0.0.1:5/prove',
      'https://127.0.0.1:5/prove/ultra-honk',
      'http://127.0.0.1:5/health',
      'http://127.0.0.1:5/prove',
      'http://127.0.0.1:5/prove/ultra-honk',
    ]);
  });

  test('native is asked for when Presto answers and serves UltraHonk, a pending download included', () => {
    expect(prestoEligible(null)).toBe(false);
    expect(prestoEligible(available(['chonk', 'ultra_honk']))).toBe(true);
    expect(prestoEligible({ ...available(['ultra_honk']), needsDownload: true } as PrestoStatus)).toBe(true);
    expect(prestoEligible(available(['chonk']))).toBe(false);
    expect(prestoEligible(available())).toBe(false);
    expect(prestoEligible(unavailable('offline'))).toBe(false);
  });
});

describe('the fix-it row', () => {
  const site = 'yacana.network';
  test('the Worker’s verdict first, a download second, the probe last; absent and fine say nothing', () => {
    expect(noticeFor(initialPresto, site)).toBeNull();
    expect(noticeFor({ ...initialPresto, status: available(['ultra_honk']) }, site)).toBeNull();
    expect(noticeFor({ ...initialPresto, status: unavailable('offline') }, site)).toBeNull();
    expect(
      noticeFor(
        {
          ...initialPresto,
          status: unavailable('secure-connection-unavailable', { diagnosis: 'unconfirmed' }),
        },
        site,
      ),
    ).toBeNull();
    const denied = noticeFor(
      { ...initialPresto, status: available(['ultra_honk']), fallbackReason: 'denied' },
      site,
    );
    expect(denied?.tone).toBe('warn');
    expect(denied?.retry).toBe(true);
    expect(denied?.text).toContain('approved yacana.network');
    const downloading = noticeFor(
      { ...initialPresto, status: available(['ultra_honk']), phase: 'downloading' },
      site,
    );
    expect(downloading).toEqual({
      tone: 'info',
      text: expect.stringContaining('fetching its prover for Aztec 6.0.0'),
      retry: false,
    });
    // A sticky verdict outranks a phase that is over.
    expect(
      noticeFor({ ...initialPresto, fallbackReason: 'invalid-proof', phase: 'downloading' }, site)?.text,
    ).toContain('didn’t verify');
  });

  test("each probe outcome that needs the visitor's hand has its words", () => {
    const text = (s: PrestoStatus) => noticeFor({ ...initialPresto, status: s }, site)?.text ?? null;
    expect(text(unavailable('permission-blocked'))).toContain('blocked local access');
    expect(text(unavailable('secure-connection-unavailable', { diagnosis: 'https-disabled' }))).toContain(
      'Encrypted Connection',
    );
    expect(text(unavailable('version-mismatch'))).toContain('needs an update');
    expect(text(unavailable('error'))).toContain('health report');
    // Answering without UltraHonk is an old Presto: the update row, not silence.
    expect(text(available(['chonk']))).toContain('needs an update');
  });

  test('the Worker’s reasons: a busy Presto, an old one, a gone one', () => {
    const text = (r: Parameters<typeof noticeFor>[0]['fallbackReason']) =>
      noticeFor({ ...initialPresto, fallbackReason: r }, site)?.text ?? '';
    expect(text('transient')).toContain('busy');
    expect(text('route-missing')).toContain('needs an update');
    expect(text('scheme-unsupported')).toContain('needs an update');
    expect(text('network')).toContain('stopped answering');
    expect(text('cooldown')).toContain('cooldown');
    // The user's own revoke is nothing to fix.
    expect(noticeFor({ ...initialPresto, fallbackReason: 'revoked' }, site)).toBeNull();
  });
});

describe('the phases the page is told about', () => {
  test('the download row lives from the download to the end of the proof it was for', () => {
    const seen: string[] = [];
    const gate = downloadPhases((ph) => seen.push(ph));
    // The SDK's own order around a download: the announcement, then the preparation, then the POST.
    for (const ph of ['detect', 'downloading', 'serialize', 'transmit', 'proving'] as const) gate(ph);
    expect(seen).toEqual(['downloading']);
    gate('proved');
    expect(seen).toEqual(['downloading', 'proved']);
    // A proof that needed no download says nothing at all.
    for (const ph of ['serialize', 'proving', 'proved'] as const) gate(ph);
    expect(seen).toEqual(['downloading', 'proved']);
    // A download the SDK abandons ends the row too, and only once. Under this app's `fallback: 'none'`
    // the SDK throws instead of reaching that phase, and the prover's transition clears the row; the
    // branch is what keeps the row honest for a caller that does let the SDK fall back.
    gate('downloading');
    gate('downloading');
    gate('fallback');
    gate('fallback');
    expect(seen).toEqual(['downloading', 'proved', 'downloading', 'fallback']);
  });
});
