import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { type EpochRow, linkRows, rowsFromJson } from '@yacana/miner-core/reader';
import { Skeleton } from '@yacana/ui';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { hosted } from '../../tests/host';
import { Difficulty, Duration, Emission, Retarget } from '../charts/index.tsx';
import { span } from '../charts/specs';
import { IDLE } from '../history-fill';
import { Stats } from '../pages/Stats';
import { type Fixed, fixedAtom, historyAtom, sinceOpenedAtom, slowAtom, unsettledAtom } from '../state';
import { selectedFromSearch } from '../url-state';
import { type EpochWindow, windowFor, windowRowsOf } from '../window';
import { Detail } from './Detail';
import { Observatory } from './Observatory';
import { Strip, type StripProps, step } from './Strip';
import { Table } from './Table';

const fixture = await import('@yacana/miner-core/fixtures/epochs.testnet.json?raw');
const rows: EpochRow[] = rowsFromJson(fixture.default);
const RULES = {
  N: PARAMS.N,
  EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS,
  T_MAX: PARAMS.T_MAX,
  REWARD: PARAMS.REWARD,
  DECIMALS: PARAMS.DECIMALS,
  TOKEN_SYMBOL: PARAMS.TOKEN_SYMBOL,
};

afterEach(cleanup);

const OPEN = rows.length - 1;
const texts = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((t) => t.textContent);

describe('charts on the captured history', () => {
  test('duration: one bar per closed epoch from the 10 s floor, the escape-hatch closes amber, the selection haloed', () => {
    const { container } = render(<Duration rows={rows} selected={3} rules={RULES} open={OPEN} />);
    expect(container.querySelectorAll('g.claims rect[aria-label]')).toHaveLength(27);
    const roll = container.querySelectorAll('g.roll rect[aria-label]');
    expect(roll).toHaveLength(3);
    expect(roll[0]?.getAttribute('aria-label')).toBe('epoch 0: 26136 s, closed by the escape hatch');
    // A constant fill sits on the mark's group; the theme's variable reaches every rect from there.
    expect(container.querySelector('g.roll')?.getAttribute('fill')).toBe('var(--warn)');
    expect(container.querySelectorAll('g.halo rect')).toHaveLength(1);
    expect(container.querySelectorAll('g.rule line')).toHaveLength(2);
    // The two rules by their words, the y axis in the three units.
    const labels = texts(container, 'text');
    expect(labels).toContain('expected 5 min');
    expect(labels).toContain('20 min · anyone may close it after this');
    expect(texts(container, '[aria-label="y-axis tick label"] text')).toEqual(['10 s', '1000 s', '1 d']);
    expect(screen.getByRole('figure', { name: /30 closed epochs/ })).toBeTruthy();
    cleanup();
    // The open epoch has no duration: nothing to halo on a closed-only chart.
    const open = render(<Duration rows={rows} selected={OPEN} rules={RULES} open={OPEN} />).container;
    expect(open.querySelectorAll('g.halo rect')).toHaveLength(0);
  });

  test('retarget bars grow from 1, violet harder and grey easier; emission and difficulty count their marks', () => {
    const { container } = render(<Retarget rows={rows} selected={null} rules={RULES} open={OPEN} />);
    const easier = container.querySelectorAll('g.easier rect[aria-label]');
    const harder = container.querySelectorAll('g.harder rect[aria-label]');
    expect(easier.length + harder.length).toBe(30);
    expect(easier[0]?.getAttribute('aria-label')).toBe('epoch 0: retarget ×4.00');
    expect(container.querySelector('g.easier')?.getAttribute('fill')).toBe('var(--ink-3)');
    expect(container.querySelector('g.harder')?.getAttribute('fill')).toBe('var(--uv)');
    expect(texts(container, '[aria-label="y-axis tick label"] text')).toEqual(['×0.25', '×1', '×4']);
    // A ratio outside the contract's clamp is a node lying or a wrong slot: marked at the baseline, never a bar.
    const bad = [...rows.slice(0, 2).map((r, i) => ({ ...r, retarget: i ? 100 : 0 })), ...rows.slice(2)];
    const guarded = render(<Retarget rows={bad} selected={null} rules={RULES} open={OPEN} />).container;
    expect(guarded.querySelectorAll('g.invalid circle[aria-label]')).toHaveLength(2);
    expect(guarded.querySelectorAll('g.harder rect, g.easier rect')).toHaveLength(28);
    const emission = render(<Emission rows={rows} selected={null} rules={RULES} open={OPEN} />).container;
    expect(emission.querySelectorAll('g.point circle[aria-label]')).toHaveLength(30);
    expect(emission.querySelectorAll('g.minted path')).toHaveLength(1);
    expect(emission.querySelector('[data-testid=chart-emission]')).toBeTruthy();
  });

  test('the lead chart: log-2 ticks, every third epoch and "N · open", the escape-hatch closes labelled by name', () => {
    const { container } = render(<Difficulty rows={rows} selected={OPEN} rules={RULES} open={OPEN} />);
    expect(container.querySelectorAll('g.point circle[aria-label]')).toHaveLength(31);
    expect(container.querySelectorAll('g.halo rect')).toHaveLength(1);
    expect(container.querySelectorAll('g.roll line')).toHaveLength(3);
    expect(texts(container, '[aria-label="y-axis tick label"] text')).toEqual(['1', '4', '16', '64']);
    const x = texts(container, '[aria-label="x-axis tick label"] text');
    expect(x.at(-1)).toBe('30 · open');
    expect(x.slice(0, -1).every((t) => Number(t) % 3 === 0)).toBe(true);
    // 27 sits 3 epochs (≈ 55 px of 580) before the open tick: suppressed.
    expect(x).not.toContain('27');
    const labels = texts(container, 'text').filter((t) => t?.startsWith('escape hatch closed'));
    expect(labels).toContain('escape hatch closed epoch 0 · ÷4');
    expect(labels).toContain('escape hatch closed epoch 25 · ÷4');
    // Epoch 29's close sits in the right 30 %: its label reads leftward, so it ends before the frame does.
    const late = Array.from(container.querySelectorAll('text')).find((t) =>
      t.textContent?.startsWith('escape hatch closed epoch 29'),
    );
    expect(late?.parentElement?.getAttribute('text-anchor')).toBe('end');
    cleanup();
    // A history that stopped before the chain's open epoch: its last row is not called open, on the axis or in the tip.
    const stale = render(<Difficulty rows={rows} selected={null} rules={RULES} open={OPEN + 1} />).container;
    expect(texts(stale, '[aria-label="x-axis tick label"] text').at(-1)).toBe('30');
    const openRow = rows[OPEN] as EpochRow;
    expect(span(openRow, OPEN)).toBe('open');
    expect(span(openRow, OPEN + 1)).toBe('closed · not read yet');
    expect(span(rows[3] as EpochRow, OPEN)).toBe('144 s');
  });

  test('emission ticks read in the unit of their step: seconds, minutes or hours, never twice alike', () => {
    const labels = (subset: EpochRow[]) => {
      const c = render(<Emission rows={subset} selected={null} rules={RULES} open={OPEN} />).container;
      const x = texts(c, '[aria-label="x-axis tick label"] text');
      cleanup();
      expect(x.length).toBeGreaterThan(1);
      expect(new Set(x).size).toBe(x.length);
      return x;
    };
    // One 72-second epoch and the open one; epochs 1–4, eleven minutes; the whole history, two days.
    const e27 = rows[27] as EpochRow;
    const opened = { ...(rows[28] as EpochRow), duration: null, closedBy: null, retarget: null };
    expect(labels([e27, opened]).every((t) => /^\+\d+ s$/.test(t ?? ''))).toBe(true);
    expect(labels(rows.slice(1, 5)).every((t) => /^\+\d+ min$/.test(t ?? ''))).toBe(true);
    expect(labels(rows).every((t) => /^\+\d+ h$/.test(t ?? ''))).toBe(true);
  });
});

const stripWindow = windowFor(null, OPEN);
const renderStrip = (over: Partial<StripProps> = {}) =>
  render(
    <Strip
      rows={rows}
      all={rows}
      open={OPEN}
      window={stripWindow}
      selected={null}
      onSelect={() => {}}
      now={rows[OPEN]?.openedAt ?? 0}
      launchAt={rows[0]?.openedAt ?? 0}
      onWindow={() => {}}
      fill={IDLE}
      {...over}
    />,
  );

describe('the strip', () => {
  test('one option per epoch, the open one on the right and selected by default; a click selects', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(rows.length);
    expect(options[OPEN]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(options[2] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(2);
    // Clicking the open epoch clears the selection (null = "follow the open one").
    fireEvent.click(options[OPEN] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test('← → step through the window; at epoch 0 of the newest window there is nothing older', () => {
    expect(step(rows, 3, -1, OPEN)).toBe(2);
    expect(step(rows, 3, 1, OPEN)).toBe(4);
    expect(step(rows, OPEN - 1, 1, OPEN)).toBeNull();
    expect(step(rows, OPEN, 1, OPEN)).toBeNull();
    expect(step(rows, 0, -1, OPEN)).toBe('older');
    const onSelect = vi.fn();
    const onWindow = vi.fn();
    renderStrip({ selected: 0, onSelect, onWindow });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onWindow).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

/** A 1000-epoch chain with the newest 200 held: the boot window and three pages of the fill. */
const LONG_OPEN = 999;
const LONG_LAUNCH = 1_700_000_000;
const mk = (e: number): EpochRow => ({
  epoch: e,
  target: 1n << 122n,
  openedAt: LONG_LAUNCH + e * 300,
  claims: 4,
  duration: null,
  retarget: null,
  closedBy: null,
});
const longHeld = new Map(Array.from({ length: 200 }, (_, i) => [800 + i, mk(800 + i)]));
const longAll = linkRows([...longHeld.values()]);
const at = (from: number | null) => windowFor(from, LONG_OPEN);
const renderLong = (w: EpochWindow, over: Partial<StripProps> = {}) =>
  renderStrip({
    rows: windowRowsOf(longHeld, w),
    all: longAll,
    open: LONG_OPEN,
    window: w,
    now: LONG_LAUNCH + LONG_OPEN * 300,
    launchAt: LONG_LAUNCH,
    ...over,
  });
const rect = {
  left: 0,
  top: 0,
  width: 1000,
  height: 26,
  right: 1000,
  bottom: 26,
  x: 0,
  y: 0,
  toJSON: () => {},
};

describe('the strip over a long chain', () => {
  test('the map draws one bar per held epoch at its cell and the window box over the 48 shown', () => {
    renderLong(at(900), { fill: { phase: 'filling', readTo: 800 } });
    expect(screen.getByTestId('map-bars').querySelectorAll('rect')).toHaveLength(200);
    const box = screen.getByTestId('map-window');
    expect(box.style.left).toBe('90%');
    expect(box.style.width).toBe('4.8%');
    expect(box.className).toContain('min-w-[3px]');
    expect(screen.getByTestId('strip-from').textContent).toContain('epoch 900');
    expect(screen.getByTestId('fill-note')).toBeTruthy();
    cleanup();
    // Before the fill's first tick, and once it reached epoch 0, there is nothing to say.
    renderLong(at(900));
    expect(screen.queryByTestId('fill-note')).toBeNull();
    cleanup();
    renderLong(at(900), { fill: { phase: 'stopped', reason: 'complete', readTo: 0 } });
    expect(screen.queryByTestId('fill-note')).toBeNull();
  });

  test('‹ › page by 48 and are disabled at the ends', () => {
    const onWindow = vi.fn();
    renderLong(at(900), { onWindow });
    fireEvent.click(screen.getByTestId('window-older'));
    expect(onWindow).toHaveBeenLastCalledWith(852);
    fireEvent.click(screen.getByTestId('window-newer'));
    expect(onWindow).toHaveBeenLastCalledWith(948);
    cleanup();
    renderLong(at(948), { onWindow });
    fireEvent.click(screen.getByTestId('window-newer'));
    expect(onWindow).toHaveBeenLastCalledWith(null);
    cleanup();
    renderLong(at(null));
    expect((screen.getByTestId('window-newer') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('window-older') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    renderLong(at(0), { rows: null });
    expect((screen.getByTestId('window-older') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('strip').hasAttribute('data-skeleton')).toBe(true);
  });

  test('a click on the map centres the window on the epoch under the pointer', () => {
    const onWindow = vi.fn();
    renderLong(at(900), { onWindow });
    const rail = screen.getByTestId('map-rail');
    rail.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.pointerDown(rail, { clientX: 500, button: 0 });
    expect(onWindow).toHaveBeenCalledWith(476);
    fireEvent.pointerDown(rail, { clientX: 5, button: 0 });
    expect(onWindow).toHaveBeenLastCalledWith(0);
    fireEvent.pointerDown(rail, { clientX: 999, button: 0 });
    expect(onWindow).toHaveBeenLastCalledWith(null);
  });

  test('keyboard stepping at a historical window pages at its edges and steps in from the open epoch', () => {
    const onSelect = vi.fn();
    const onWindow = vi.fn();
    renderLong(at(900), { selected: 947, onSelect, onWindow });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onWindow).toHaveBeenLastCalledWith(948);
    expect(onSelect).toHaveBeenLastCalledWith(948);
    cleanup();
    renderLong(at(900), { selected: 900, onSelect, onWindow });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onWindow).toHaveBeenLastCalledWith(852);
    expect(onSelect).toHaveBeenLastCalledWith(899);
    cleanup();
    // Nothing selected: the open epoch is current and outside the window; ← lands on the window's last row.
    renderLong(at(900), { selected: null, onSelect, onWindow });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(947);
    expect(screen.getByTestId('strip-selected').textContent).toBe('epoch 999');
  });
});

describe('the observatory', () => {
  const last = rows[rows.length - 1] as EpochRow;
  const fixedOf = (open: number, supply = 0n): Fixed => ({
    open,
    supply,
    genesis: { target: 0n, seed: 0n, launchAt: 0 },
    block: { number: 1, timestamp: last.openedAt + 60 },
    readAt: 0,
  });

  test('the open epoch tile shows the row of the open epoch, or a dash when a close outran the history', () => {
    render(<Observatory fixed={fixedOf(last.epoch)} rows={rows} now={(last.openedAt + 312) * 1000} />);
    expect(screen.getByTestId('open-claims').textContent).toBe(String(last.claims));
    // The ring is 312 s into an expected 300: full, still violet (the escape hatch opens at 1200 s).
    expect(screen.getByTestId('open-for').textContent).toBe('open 5:12 · expected 5:00');
    expect(screen.getByTestId('epoch-ring').getAttribute('data-past-hatch')).toBe('0');
    expect(screen.getByText('an estimate from epoch counts')).toBeTruthy();
    expect(screen.getByText('×0.30 at the last close')).toBeTruthy();
    cleanup();
    render(<Observatory fixed={fixedOf(last.epoch)} rows={rows} now={(last.openedAt + 1201) * 1000} />);
    expect(screen.getByTestId('epoch-ring').getAttribute('data-past-hatch')).toBe('1');
    cleanup();
    render(<Observatory fixed={fixedOf(last.epoch + 1)} rows={rows} now={(last.openedAt + 60) * 1000} />);
    expect(screen.getByTestId('open-claims').textContent).toBe('—');
    expect(screen.getByText(/this epoch not read yet/)).toBeTruthy();
    expect((screen.getByTestId('calculator') as HTMLButtonElement).disabled).toBe(true);
  });

  test('since you opened counts from the first read: a second poll with more supply shows the delta', async () => {
    const store = createStore();
    const first = fixedOf(last.epoch);
    store.set(sinceOpenedAtom, { supply: first.supply, at: last.openedAt * 1000 });
    const view = render(
      <Provider store={store}>
        <Observatory fixed={first} rows={rows} now={(last.openedAt + 60) * 1000} />
      </Provider>,
    );
    expect(screen.getByTestId('since-opened').textContent).toBe('+0');
    view.rerender(
      <Provider store={store}>
        <Observatory
          fixed={{ ...first, supply: 3n * PARAMS.REWARD }}
          rows={rows}
          now={(last.openedAt + 420) * 1000}
        />
      </Provider>,
    );
    // The number glides there: the page reports itself unsettled until the tween lands, then settled.
    expect(store.get(unsettledAtom).has('since-opened')).toBe(true);
    expect(screen.getByText('12 tYACA minted · 7 min')).toBeTruthy();
    await waitFor(() => expect(store.get(unsettledAtom).size).toBe(0));
    expect(screen.getByTestId('since-opened').textContent).toBe('+3');
    // A supply below the first read is said, never a negative count.
    view.rerender(
      <Provider store={store}>
        <Observatory
          fixed={{ ...first, supply: -PARAMS.REWARD }}
          rows={rows}
          now={(last.openedAt + 420) * 1000}
        />
      </Provider>,
    );
    expect(screen.getByTestId('since-opened').textContent).toBe('—');
    expect(screen.getByText('the supply read lower than at the first read')).toBeTruthy();
  });
});

describe('the page', () => {
  const last = rows[rows.length - 1] as EpochRow;
  const fixedOf = (open: number, supply = 0n): Fixed => ({
    open,
    supply,
    genesis: { target: 0n, seed: 0n, launchAt: 0 },
    block: { number: 1, timestamp: last.openedAt + 60 },
    readAt: 0,
  });

  test('the A grid: six KPI cells, the strip beside the detail, the lead chart alone, three small tiles, the table', () => {
    const store = createStore();
    store.set(fixedAtom, fixedOf(last.epoch));
    store.set(historyAtom, {
      rows: new Map(rows.map((r) => [r.epoch, r])),
      lottery: { mix: 0n, reveals: 0 },
    });
    const { container } = render(
      <Provider store={store}>{hosted(<Stats onWindow={() => {}} nodeUrl="http://node.test" />)}</Provider>,
    );
    const grid = container.querySelector('[data-testid=stats]') as HTMLElement;
    expect(grid.className).toContain('md:grid-cols-6');
    const cells = Array.from(
      grid.querySelectorAll(
        ':scope > [data-slot=tile], :scope > [data-testid=observatory] > [data-slot=tile], :scope > [data-testid=small-multiples]',
      ),
    );
    const spans = cells.map((c) => c.className.match(/(?:md|xl):col-span-\d|md:grid-cols-3/g)?.join(' '));
    expect(spans.slice(0, 6).every((s) => s === 'md:col-span-2 xl:col-span-1')).toBe(true);
    expect(spans[6]).toBe('md:col-span-6 xl:col-span-4');
    expect(spans[7]).toBe('md:col-span-6 xl:col-span-2');
    expect(spans[8]).toBe('md:col-span-6');
    expect(cells[8]?.className).toContain('border-line-2');
    expect(spans[9]).toBe('md:col-span-6 md:grid-cols-3');
    expect(cells[9]?.querySelectorAll('[data-slot=tile]')).toHaveLength(3);
    expect(spans[10]).toBe('md:col-span-6');
    expect(spans.slice(11)).toEqual(['md:col-span-3', 'md:col-span-3']);
    const charts = Array.from(grid.querySelectorAll('[data-slot=chart]')) as HTMLElement[];
    expect(charts.map((c) => c.style.height)).toEqual(['200px', '110px', '110px', '110px']);
    expect(screen.getByTestId('strip-selected').textContent).toBe(`epoch ${last.epoch}`);
    expect(screen.getByTestId('reproduce-command').textContent).toContain(
      "AZTEC_NODE_URL='http://node.test'",
    );
    // The Verify chips link the explorer's pages for the deployment.
    expect(screen.getByTestId('chip-miner').getAttribute('href')).toBe(
      'https://testnet.aztecscan.xyz/contracts/instances/0x0000000000000000000000000000000000000000000000000000000000000001',
    );
  });

  test('the table scrolls under a sticky head, counts its rows, names the escape hatch', () => {
    render(<Table rows={rows} open={OPEN} selected={null} onSelect={() => {}} className="" />);
    const scroll = screen.getByTestId('table-scroll');
    expect(scroll.className).toContain('max-h-[460px]');
    expect(scroll.className).toContain('overflow-auto');
    const table = screen.getByTestId('table');
    expect(table.className).toContain('border-separate');
    expect(table.querySelector('thead')?.className).toContain('sticky');
    expect(screen.getByTestId('table-count').textContent).toBe(`${rows.length} of ${rows.length}`);
    const closedBy = Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.children[6]?.textContent);
    expect(closedBy.filter((t) => t === 'the escape hatch')).toHaveLength(3);
    expect(closedBy).not.toContain('roll()');
    expect(screen.getByText("↕ scrolls · header stays · the strip's window, newest first")).toBeTruthy();
  });

  test('a row without closing facts is "open" only when it is the open epoch; open for counts in m:ss', () => {
    render(<Detail row={last} open now={last.openedAt + 312} />);
    expect(screen.getByTestId('detail-closed-by').textContent).toBe('open');
    expect(screen.getByTestId('detail-open-for').textContent).toBe('5:12');
    expect(screen.getByTestId('sentence').textContent).toMatch(/^Open with/);
    cleanup();
    render(<Detail row={rows[25] as EpochRow} open={false} now={0} />);
    expect(screen.getByTestId('detail-closed-by').textContent).toBe('closed by the escape hatch');
    expect(screen.getByTestId('sentence').textContent).toContain('through the escape hatch');
    cleanup();
    render(<Detail row={last} open={false} now={last.openedAt + 60} />);
    expect(screen.getByTestId('detail-closed-by').textContent).toBe('closed · not read yet');
    expect(screen.getByTestId('sentence').textContent).toMatch(/not been read yet/);
  });
});

describe('the two beats on the page', () => {
  const last = rows[rows.length - 1] as EpochRow;
  const fixedOf = (open: number): Fixed => ({
    open,
    supply: 448n * 10n ** 18n,
    genesis: { target: 0n, seed: 0n, launchAt: 0 },
    block: { number: 1, timestamp: last.openedAt + 60 },
    readAt: 0,
  });
  const page = (store = createStore()) =>
    render(
      <Provider store={store}>{hosted(<Stats onWindow={() => {}} nodeUrl="http://node.test" />)}</Provider>,
    );

  test('before any beat every tile is on the page, as its skeleton', () => {
    const { container } = page();
    expect(
      container.querySelector('[data-testid=observatory]')?.querySelectorAll('[data-slot=tile]'),
    ).toHaveLength(6);
    expect(screen.getByTestId('strip').hasAttribute('data-skeleton')).toBe(true);
    expect(screen.getByTestId('detail').hasAttribute('data-skeleton')).toBe(true);
    expect(screen.getByTestId('table').querySelectorAll('tbody tr[data-skeleton]')).toHaveLength(8);
    expect(screen.getByTestId('table-count').textContent).toBe('— of —');
    expect(container.querySelectorAll('[data-slot=chart]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(10);
  });

  test('beat one fills minted and the epoch number while the window is still a skeleton', async () => {
    const store = createStore();
    store.set(fixedAtom, fixedOf(last.epoch));
    page(store);
    await waitFor(() => expect(store.get(unsettledAtom).size).toBe(0));
    expect(screen.getByTestId('minted').textContent).toBe('448');
    expect(screen.getAllByText(`epoch ${last.epoch}`).length).toBeGreaterThan(0);
    expect(screen.getByTestId('detail').textContent).toContain(`epoch ${last.epoch}`);
    expect(screen.queryByTestId('open-claims')).toBeNull();
    expect(screen.getByTestId('strip').hasAttribute('data-skeleton')).toBe(true);
  });

  test('fast first, slow second: the window skeleton is quiet until the timer, then shimmers; minted never blinks', async () => {
    const store = createStore();
    store.set(fixedAtom, fixedOf(last.epoch));
    page(store);
    const box = screen.getByTestId('strip').querySelector('[data-slot=skeleton]') as HTMLElement;
    expect(box.hasAttribute('data-quiet')).toBe(true);
    expect(screen.getByTestId('minted').querySelector('[data-slot=skeleton]')).toBeNull();
    store.set(slowAtom, true);
    await waitFor(() => expect(box.hasAttribute('data-quiet')).toBe(false));
    expect(screen.getByTestId('minted').querySelector('[data-slot=skeleton]')).toBeNull();
  });
});

describe('the pieces with nothing in them', () => {
  test('the skeleton shimmers, not under reduced motion; quiet is the bare box', () => {
    const { container } = render(
      <>
        <Skeleton className="h-2" />
        <Skeleton className="h-2" quiet />
      </>,
    );
    const [loud, quiet] = Array.from(container.querySelectorAll('[data-slot=skeleton]')) as HTMLElement[];
    expect(loud?.className).toContain('motion-reduce:animate-none');
    expect(loud?.className).toContain('skeleton-shimmer');
    expect(quiet?.hasAttribute('data-quiet')).toBe(true);
    expect(quiet?.className).not.toContain('skeleton-shimmer');
  });

  test('a chart with no rows draws its axes and a band, nothing else', () => {
    const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('text')).map((t) => t.textContent);
    const difficulty = render(<Difficulty rows={[]} selected={null} rules={RULES} open={0} />).container;
    expect(labels(difficulty)).toEqual(expect.arrayContaining(['1', '4', '16', '64']));
    expect(difficulty.querySelectorAll('g.skeleton-band rect')).toHaveLength(1);
    expect(difficulty.querySelectorAll('g.point circle')).toHaveLength(0);
    cleanup();
    const duration = render(<Duration rows={[]} selected={null} rules={RULES} open={0} />).container;
    expect(labels(duration)).toEqual(expect.arrayContaining(['10 s', '1000 s', '1 d']));
    cleanup();
    const retarget = render(<Retarget rows={[]} selected={null} rules={RULES} open={0} />).container;
    expect(labels(retarget)).toEqual(expect.arrayContaining(['×0.25', '×1', '×4']));
    cleanup();
    const emission = render(<Emission rows={[]} selected={null} rules={RULES} open={0} />).container;
    expect(labels(emission)).toEqual(expect.arrayContaining(['0', '5k', '10k']));
  });
});

describe('the URL selection', () => {
  test('?epoch=N selects; anything else follows the open epoch', () => {
    expect(selectedFromSearch('?epoch=14')).toBe(14);
    expect(selectedFromSearch('?epoch=0')).toBe(0);
    expect(selectedFromSearch('')).toBeNull();
    expect(selectedFromSearch('?epoch=-1')).toBeNull();
    expect(selectedFromSearch('?epoch=abc')).toBeNull();
  });
});
