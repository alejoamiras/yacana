// The floor as the components read it: with a nonzero first epoch the strip stops paging at it, the
// map's slider starts there and the table counts the chain from it. The modules are imported after
// the env is stubbed: `FIRST` is read once, at import.
import { cleanup, render, screen } from '@testing-library/react';
import type { EpochRow } from '@yacana/miner-core/reader';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { IDLE } from '../history-fill';
import { windowFor } from '../window';

const row = (e: number, open: number): EpochRow => ({
  epoch: e,
  target: 1n << 122n,
  openedAt: e * 300,
  claims: e === open ? 1 : 4,
  duration: e === open ? null : 300,
  retarget: e === open ? null : 1,
  closedBy: e === open ? null : 'claims',
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('a continuation in the components', () => {
  test('the strip cannot page below the first epoch; the map and the table start there', async () => {
    vi.stubEnv('VITE_FIRST_EPOCH', '25');
    vi.resetModules();
    const [{ Strip }, { Table }] = await Promise.all([import('./Strip'), import('./Table')]);
    const open = 100;
    const all = Array.from({ length: open - 25 + 1 }, (_, i) => row(25 + i, open));
    const win = windowFor(25, open, 25);
    const rows = all.filter((r) => r.epoch >= win.from && r.epoch <= win.to);
    render(
      <Strip
        rows={rows}
        all={all}
        open={open}
        window={win}
        selected={null}
        onSelect={() => {}}
        now={open * 300 + 10}
        launchAt={25 * 300}
        onWindow={() => {}}
        fill={IDLE}
      />,
    );
    expect(screen.getByTestId('window-older').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('window-newer').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('map-window').getAttribute('aria-valuemin')).toBe('25');
    render(<Table rows={rows} open={open} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId('table-count').textContent).toBe(`${rows.length} of 76`);
  });
});
