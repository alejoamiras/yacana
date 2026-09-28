import { describe, expect, test } from 'vitest';
import { siteTabs, statsTabs } from './site-tabs.ts';

const href = (t: string) => `/${t}`;

describe('the site tabs', () => {
  test('Mine · Wallet · Stats in that order, with their icons and ids; only the tabs given one select in-app', () => {
    let selected = '';
    const tabs = siteTabs({
      current: 'stats',
      href,
      onSelect: { stats: () => (selected = 'stats') },
      waiting: 2,
    });
    expect(tabs.map((t) => [t.label, t.icon, t.testId, t.href, t.current])).toEqual([
      ['Mine', 'mine', 'nav-mine', '/mine', false],
      ['Wallet', 'wallet', 'nav-wallet', '/wallet', false],
      ['Stats', 'stats', 'nav-stats', '/stats', true],
    ]);
    expect(tabs.map((t) => t.external ?? false)).toEqual([false, false, false]);
    expect(tabs[1]?.count).toBe(2);
    expect([tabs[0]?.onSelect, tabs[1]?.onSelect]).toEqual([undefined, undefined]);
    tabs[2]?.onSelect?.();
    expect(selected).toBe('stats');
  });

  test('Overview · Bridge · Verify under the bar: no icons, the current page, in-app where asked', () => {
    const picked: string[] = [];
    const go = (p: string) => () => void picked.push(p);
    const tabs = statsTabs({
      current: 'bridge',
      href,
      onSelect: { stats: go('stats'), bridge: go('bridge'), verify: go('verify') },
    });
    expect(tabs.map((t) => [t.label, t.icon, t.testId, t.href, t.current])).toEqual([
      ['Overview', undefined, 'sub-stats', '/stats', false],
      ['Bridge', undefined, 'sub-bridge', '/bridge', true],
      ['Verify', undefined, 'sub-verify', '/verify', false],
    ]);
    for (const t of tabs) t.onSelect?.();
    expect(picked).toEqual(['stats', 'bridge', 'verify']);
    expect(statsTabs({ current: null, href }).some((t) => t.current)).toBe(false);
  });
});
