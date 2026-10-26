import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NodeProbe } from '@yacana/web-kit/browser/node';
import {
  markDeployment,
  markRead,
  nodeHealth,
  recordL1,
  recordTip,
  resetNodeHealth,
  setHealthForTests,
  setTransportForTests,
} from '@yacana/web-kit/browser/node-health';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SwitchFailed } from '../boot';
import type { Session } from '../session';
import { NodeTile } from './NodeTile';

const probe: NodeProbe = {
  chainId: 31337n,
  rollupVersion: 5n,
  rollupAddress: '0xab',
  block: 73164,
  blockAgeS: 3,
  latencyMs: 210,
};
const IN_USE = 'https://node.example/rpc';
const OTHER = 'https://other.example/rpc';

const session = (over: Partial<Session> = {}) =>
  ({
    nodeUrl: IN_USE,
    probeNode: vi.fn(async (url: string) => (url === OTHER ? { ...probe, latencyMs: 640 } : probe)),
    switchNode: vi.fn(async () => {}),
    ...over,
  }) as unknown as Session;

/** A healthy node as the pollers would report it: the deployment checked, a tip, a fresh L1 sample. */
const healthy = () => {
  markDeployment(true);
  recordTip({ block: 73164, checkpoint: 10, timestamp: Date.now() / 1000 - 12 });
  recordL1({ pendingCheckpoint: 11, head: 100 });
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
  resetNodeHealth();
});

const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('the node row', () => {
  test('healthy: the chip, the host with its default marker, the block and its age; no probe on mount', () => {
    vi.stubEnv('VITE_AZTEC_NODE_URL', IN_USE);
    const s = session();
    act(healthy);
    render(<NodeTile session={s} nodeUrl={IN_USE} onSwitched={() => {}} />);
    expect(text('node-chip')).toBe('healthy');
    expect(text('node-in-use')).toBe('node.example');
    expect(screen.getByTestId('node-row').textContent).toContain('· default');
    // The row's clock is the page's ticking atom; the suite's may be seconds behind the tip's stamp.
    expect(text('node-line')).toMatch(/^block 73,164 · \d+ s ago$/);
    expect(s.probeNode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('node-retry')).toBeNull();
  });

  test('the default in either spelling reads as the default, with no way back to it; another node is custom', () => {
    vi.stubEnv('VITE_AZTEC_NODE_URL', 'https://node.example');
    const { rerender } = render(
      <NodeTile session={session()} nodeUrl="https://node.example/" onSwitched={() => {}} />,
    );
    expect(screen.getByTestId('node-row').textContent).toContain('· default');
    expect(screen.queryByTestId('node-default')).toBeNull();
    rerender(<NodeTile session={session()} nodeUrl={OTHER} onSwitched={() => {}} />);
    expect(screen.getByTestId('node-row').textContent).toContain('· custom');
    expect(screen.getByTestId('node-default')).toBeTruthy();
  });

  test('behind and silent: the chip names the lag or the quiet, the line says what is paused, Retry when silent', () => {
    render(<NodeTile session={session()} nodeUrl={IN_USE} onSwitched={() => {}} />);
    act(() => {
      healthy();
      setHealthForTests({
        behind: true,
        tip: { block: 73101, checkpoint: 8, timestamp: Date.now() / 1000 - 240, observedAt: Date.now() },
      });
    });
    expect(text('node-chip')).toBe('behind · 4 min');
    expect(text('node-line')).toBe('block 73,101 · 4 min ago · the node answers, but its chain is old');
    act(() => {
      markRead(Date.UTC(2026, 0, 1, 14, 2));
      setTransportForTests({
        kind: 'silent',
        since: Date.now() - 120_000,
        retryAt: Date.now() + 60_000,
        backoffMs: 60_000,
      });
    });
    expect(text('node-chip')).toBe('no answer · 2 min');
    expect(text('node-line')).toBe('your view is from 14:02');
    fireEvent.click(screen.getByTestId('node-retry'));
    // Retry brings the cooldown's deadline to now: the next request goes to the network.
    const t = nodeHealth().transport;
    expect(t.kind === 'silent' && t.retryAt <= Date.now()).toBe(true);
  });
});

describe('the node row’s edit', () => {
  test('Change → Save probes then switches under the stepper; the row follows the node in use; Use the default switches back', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'e2e');
    vi.stubEnv('VITE_AZTEC_NODE_URL', IN_USE);
    const s = session();
    let inUse = IN_USE;
    const onSwitched = vi.fn(() => {
      inUse = OTHER;
    });
    const { rerender } = render(<NodeTile session={s} nodeUrl={inUse} onSwitched={onSwitched} />);
    fireEvent.click(screen.getByTestId('node-change'));
    expect(screen.getByTestId('node-edit').textContent).toContain('Any https node on this deployment.');
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: OTHER } });
    await act(() => fireEvent.click(screen.getByTestId('node-save')));
    await waitFor(() => expect(s.switchNode).toHaveBeenCalledWith(OTHER));
    expect(s.probeNode).toHaveBeenCalledWith(OTHER);
    expect(JSON.parse(localStorage.getItem('yacana.connection') ?? '{}')).toEqual({ nodeUrl: OTHER });
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
    rerender(<NodeTile session={s} nodeUrl={inUse} onSwitched={onSwitched} />);
    await waitFor(() => expect(text('node-in-use')).toBe('other.example'));
    expect(screen.getByTestId('node-row').textContent).toContain('· custom');
    await act(() => fireEvent.click(screen.getByTestId('node-default')));
    await waitFor(() => expect(s.switchNode).toHaveBeenLastCalledWith(IN_USE));
    // The default is saved as no choice, so a later default reaches this visitor too.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('yacana.connection') ?? 'null')).toEqual({}));
  });

  test('the stepper while a save runs: reachable with its latency, this deployment, switching with its sentence', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'e2e');
    let finish: () => void = () => {};
    const s = session({
      switchNode: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    } as Partial<Session>);
    render(<NodeTile session={s} nodeUrl={IN_USE} onSwitched={() => {}} />);
    fireEvent.click(screen.getByTestId('node-change'));
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: OTHER } });
    fireEvent.click(screen.getByTestId('node-save'));
    await waitFor(() => expect(s.switchNode).toHaveBeenCalled());
    const stepper = screen.getByTestId('node-stepper');
    const steps = Array.from(stepper.querySelectorAll('[data-slot=step]')).map((li) =>
      li.getAttribute('data-state'),
    );
    expect(steps).toEqual(['done', 'done', 'active']);
    expect(stepper.textContent).toContain('0.6 s');
    expect(stepper.textContent).toContain(
      "Rebuilding your view of the chain from the new node. Mining pauses until it's done.",
    );
    expect((screen.getByTestId('node-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('node-url') as HTMLInputElement).disabled).toBe(true);
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByTestId('node-stepper')).toBeNull());
  });
});

describe('the node row’s failures', () => {
  test('a refused probe and a failed rebuild stay under the field, the old node kept; a refused write is said', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'e2e');
    const s = session({
      probeNode: vi.fn(async (url: string) => {
        if (url === 'https://wrong.example/')
          throw new Error('node serves rollup 0x17, this build expects 0x05');
        return probe;
      }),
      switchNode: vi.fn(async (url: string) => {
        if (url === 'https://dead.example/') throw new SwitchFailed('it stopped answering', true);
      }),
    } as Partial<Session>);
    render(<NodeTile session={s} nodeUrl={IN_USE} onSwitched={() => {}} />);
    fireEvent.click(screen.getByTestId('node-change'));
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: 'http://not-local.example' } });
    await act(() => fireEvent.click(screen.getByTestId('node-save')));
    await waitFor(() =>
      expect(text('node-error')).toBe('a node must be reached over https. Kept node.example.'),
    );
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: 'https://wrong.example' } });
    await act(() => fireEvent.click(screen.getByTestId('node-save')));
    await waitFor(() =>
      expect(text('node-error')).toBe(
        "Not this deployment's node (it serves rollup 0x17). Kept node.example.",
      ),
    );
    expect((screen.getByTestId('node-url') as HTMLInputElement).value).toBe('https://wrong.example/');
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: 'https://dead.example' } });
    await act(() => fireEvent.click(screen.getByTestId('node-save')));
    await waitFor(() =>
      expect(text('node-error')).toBe(
        "Couldn't rebuild your view from dead.example: it stopped answering. Kept node.example.",
      ),
    );
    expect(localStorage.getItem('yacana.connection')).toBeNull();
    // The switch lands before the save: a storage write the browser refuses is said, node in use.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    fireEvent.change(screen.getByTestId('node-url'), { target: { value: OTHER } });
    await act(() => fireEvent.click(screen.getByTestId('node-save')));
    await waitFor(() => expect(text('node-error')).toMatch(/Now in use, but .*refused to save/));
    expect(s.switchNode).toHaveBeenLastCalledWith(OTHER);
  });
});
