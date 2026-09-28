import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Header } from '@yacana/ui';
import { hostKind, keysAllowed, previewNotice, relyingParty } from '@yacana/web-kit/browser/host';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { queryOverridesAllowed } from './config';
import { isDesktop } from './desktop';
import { minerTabs, oldTabs } from './lib/tabs';
import { navigate, pathFor, routeFromPath, useRoute } from './routes';
import { tabTitle } from './tab-status';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
});

describe('routes', () => {
  test('three routes under the base; anything else is the cockpit', () => {
    expect(routeFromPath('/')).toBe('mine');
    expect(routeFromPath('/wallet')).toBe('wallet');
    expect(routeFromPath('/settings/')).toBe('settings');
    expect(routeFromPath('/nonsense')).toBe('mine');
    expect(pathFor('mine')).toBe('/');
    expect(pathFor('wallet')).toBe('/wallet');
  });

  test('useRoute follows navigate() and popstate', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe('mine');
    act(() => navigate('wallet'));
    expect(result.current).toBe('wallet');
    expect(location.pathname).toBe('/wallet');
    act(() => {
      history.replaceState(null, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toBe('settings');
  });
});

describe('the header', () => {
  test('Mine · Wallet · Stats ↗ · Verify ↗; the two read-only destinations open the stats app in another tab', () => {
    const go = vi.fn();
    const tabs = minerTabs('wallet', go, '/stats/');
    expect(tabs.map((t) => t.label)).toEqual(['Mine', 'Wallet', 'Stats', 'Verify']);
    expect(tabs.map((t) => t.current ?? false)).toEqual([false, true, false, false]);
    expect(tabs.map((t) => t.external ?? false)).toEqual([false, false, true, true]);
    expect(tabs.map((t) => t.href)).toEqual(['/', '/wallet', '/stats/', '/stats/verify']);
    expect(tabs.map((t) => t.icon)).toEqual(['mine', 'wallet', 'stats', 'verify']);
    tabs[0]?.onSelect?.();
    expect(go).toHaveBeenCalledWith('mine');
    expect(tabs[2]?.onSelect).toBeUndefined();
  });

  test('the old origin: Send ahead and the apex’s Stats ↗, no Wallet — the page is the wallet', () => {
    const tabs = oldTabs('mine', vi.fn(), 'https://yacana.network/stats/');
    expect(tabs.map((t) => t.label)).toEqual(['Send ahead', 'Stats']);
    expect(tabs.map((t) => t.href)).toEqual(['/', 'https://yacana.network/stats/']);
    expect(tabs.map((t) => t.external ?? false)).toEqual([false, true]);
    expect(tabs[0]?.current).toBe(true);
    const { container } = render(<Header version="V5" homeHref="/" mark="idle" tabs={tabs} />);
    const glyphs = [...container.querySelectorAll('nav a svg')].map((s) => s.getAttribute('class'));
    expect(glyphs).toEqual([
      expect.stringContaining('lucide-pickaxe'),
      expect.stringContaining('lucide-chart-column'),
    ]);
  });
});

describe('desktop-only', () => {
  const win = (innerWidth: number, coarse: boolean) => ({
    innerWidth,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') && coarse }) as MediaQueryList,
  });
  test('narrow layouts and coarse pointers without threads are not desktops', () => {
    expect(isDesktop(win(1280, false), true)).toBe(true);
    expect(isDesktop(win(899, false), true)).toBe(false);
    expect(isDesktop(win(1280, true), false)).toBe(false);
    expect(isDesktop(win(1280, true), true)).toBe(true);
  });
});

describe('query overrides', () => {
  test('need the e2e build flag and localhost', () => {
    vi.stubEnv('VITE_E2E_QUERY_OVERRIDES', '1');
    expect(queryOverridesAllowed('localhost')).toBe(true);
    expect(queryOverridesAllowed('yacana.network')).toBe(false);
    vi.stubEnv('VITE_E2E_QUERY_OVERRIDES', '');
    expect(queryOverridesAllowed('localhost')).toBe(false);
  });
});

describe('host rules', () => {
  const SUFFIX = '-yacana.alejo-amiras.workers.dev';
  const alias = `feature-x${SUFFIX}`;
  const version = `252abc2b${SUFFIX}`;

  test("production bundle: the apex, this project's previews, and everything else", () => {
    vi.stubEnv('VITE_RP_ID', 'yacana.network');
    vi.stubEnv('VITE_PREVIEW_HOST_SUFFIX', SUFFIX);
    vi.stubEnv('VITE_SITE_MODE', 'production');
    expect(hostKind('yacana.network')).toBe('production');
    expect(relyingParty('yacana.network')).toBe('yacana.network');
    expect(keysAllowed('yacana.network')).toBe(true);
    expect(previewNotice('yacana.network')).toBeNull();
    for (const h of [alias, version]) {
      expect(hostKind(h)).toBe('preview');
      expect(relyingParty(h)).toBe(h);
      expect(keysAllowed(h)).toBe(true);
      expect(previewNotice(h)).toContain(`Preview on ${h}`);
    }
    for (const h of [
      'x-yacana.other.workers.dev',
      'x-other.alejo-amiras.workers.dev',
      'abc123.yacana.pages.dev',
      `x${SUFFIX}.evil.example`,
      `deep.x${SUFFIX}`,
      SUFFIX.slice(1),
      'www.yacana.network',
      'evil.example',
    ]) {
      expect(hostKind(h)).toBe('unknown');
      expect(relyingParty(h)).toBe('yacana.network');
      expect(keysAllowed(h)).toBe(false);
      expect(previewNotice(h)).toContain('cannot be created or restored');
    }
    expect(hostKind('localhost')).toBe('local');
    expect(keysAllowed('localhost')).toBe(false);
    expect(previewNotice('localhost')).toBeNull();
  });

  test("the versioned origin restores keys and never creates them; its passkeys are the apex's", () => {
    vi.stubEnv('VITE_RP_ID', 'yacana.network');
    vi.stubEnv('VITE_PREVIEW_HOST_SUFFIX', SUFFIX);
    vi.stubEnv('VITE_SITE_MODE', 'production');
    vi.stubEnv('VITE_OLD_APP_ORIGIN', 'https://v5.yacana.network');
    expect(hostKind('v5.yacana.network')).toBe('versioned');
    expect(relyingParty('v5.yacana.network')).toBe('yacana.network');
    expect(keysAllowed('v5.yacana.network')).toBe(false);
    expect(keysAllowed('v5.yacana.network', 'create')).toBe(false);
    expect(keysAllowed('v5.yacana.network', 'restore')).toBe(true);
    expect(previewNotice('v5.yacana.network')).toBeNull();
    // The apex and a preview restore as they create; an unknown host does neither.
    expect(keysAllowed('yacana.network', 'restore')).toBe(true);
    expect(keysAllowed(alias, 'restore')).toBe(true);
    expect(keysAllowed('evil.example', 'restore')).toBe(false);
    vi.stubEnv('VITE_OLD_APP_ORIGIN', '');
    expect(hostKind('v5.yacana.network')).toBe('unknown');
  });

  test('no suffix, no previews; localhost may make keys outside production', () => {
    vi.stubEnv('VITE_RP_ID', 'yacana.network');
    vi.stubEnv('VITE_PREVIEW_HOST_SUFFIX', '');
    vi.stubEnv('VITE_SITE_MODE', 'e2e');
    expect(hostKind(alias)).toBe('unknown');
    expect(hostKind('localhost')).toBe('local');
    expect(keysAllowed('localhost')).toBe(true);
  });
});

describe('tab title', () => {
  test('mirrors the pill: marker · rate · claims · Yacana', () => {
    expect(tabTitle({ mark: 'mining', rate: '18/min', claims: '2/4' })).toBe('▸ · 18/min · 2/4 · Yacana');
    expect(tabTitle({ mark: 'idle', claims: '2/4' })).toBe('2/4 · Yacana');
    expect(tabTitle({ mark: 'paused' })).toBe('‖ · Yacana');
  });
});
