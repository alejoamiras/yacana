import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AccountChip, Brand, Gear, Header } from './header.tsx';
import { Icon } from './icons.tsx';

afterEach(cleanup);

describe('Header', () => {
  test('the brand links home with the version tag; tabs carry icons, the current one, and ↗ in a new tab', () => {
    const onSelect = vi.fn();
    render(
      <Header
        version="V5"
        homeHref="/mine/"
        mark="mining"
        navLabel="miner"
        tabs={[
          { label: 'Mine', icon: 'mine', href: '/mine/', current: true, onSelect },
          { label: 'Wallet', icon: 'wallet', href: '/mine/wallet' },
          { label: 'Stats', icon: 'stats', href: '/stats/', external: true, testId: 'nav-stats' },
        ]}
        right={<span data-testid="right">right</span>}
      />,
    );
    const brand = screen.getByRole('link', { name: /Yacana V5/ });
    expect(brand).toHaveAttribute('href', '/mine/');
    expect(screen.getByTestId('brand-version')).toHaveTextContent('V5');
    expect(brand.querySelector('[data-slot=mark]')).toHaveAttribute('data-state', 'mining');

    const nav = screen.getByRole('navigation', { name: 'miner' });
    const mine = screen.getByRole('link', { name: 'Mine' });
    expect(mine).toHaveAttribute('aria-current', 'page');
    expect(mine.querySelector('[data-icon=mine]')).toHaveClass('lucide-pickaxe');
    expect(screen.getByRole('link', { name: 'Wallet' }).querySelector('svg')).toHaveClass('lucide-wallet');
    expect(screen.getByTestId('nav-stats').querySelector('svg')).toHaveClass('lucide-chart-column');
    fireEvent.click(mine);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // A modified click is the browser's (a new tab): not intercepted, not routed.
    expect(fireEvent.click(mine, { ctrlKey: true })).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Wallet' })).not.toHaveAttribute('aria-current');

    const stats = screen.getByTestId('nav-stats');
    expect(stats).toHaveAttribute('target', '_blank');
    expect(stats).toHaveAttribute('rel', 'noopener noreferrer');
    expect(stats).toHaveTextContent('Stats ↗');
    expect(nav.querySelectorAll('a')).toHaveLength(3);
    expect(screen.getByTestId('right')).toBeInTheDocument();
  });

  test('Brand alone, the account chip and the gear', () => {
    const onHome = vi.fn();
    const onSelect = vi.fn();
    render(
      <>
        <Brand version="V6" homeHref="#hero" mark="idle" onHome={onHome} />
        <AccountChip address="0x22a9…612a" href="/mine/wallet" onSelect={onSelect} data-testid="account" />
        <Gear href="/mine/settings" />
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: /Yacana V6/ }));
    expect(onHome).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('account'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('account')).toHaveTextContent('0x22a9…612a');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/mine/settings');
  });

  test('each name draws its Lucide glyph at stroke 1.5, out of the accessibility tree', () => {
    const glyphs = {
      mine: 'pickaxe',
      wallet: 'wallet',
      stats: 'chart-column',
      verify: 'shield-check',
      settings: 'settings',
      finger: 'fingerprint-pattern',
    } as const;
    for (const [name, glyph] of Object.entries(glyphs)) {
      const { container } = render(<Icon name={name as keyof typeof glyphs} size={15} />);
      const svg = container.querySelector('svg') as SVGElement;
      expect(svg).toHaveClass(`lucide-${glyph}`);
      expect(svg).toHaveAttribute('data-icon', name);
      expect(svg).toHaveAttribute('stroke-width', '1.5');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('width', '15');
      cleanup();
    }
  });
});
