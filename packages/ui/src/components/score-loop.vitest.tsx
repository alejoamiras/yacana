import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ClaimSpan, Sample } from '../score-loop-model.ts';
import { ScoreLoop } from './score-loop.tsx';

// A context that records what is drawn; jsdom has no canvas. Every method is a spy, every property a slot.
const recorder = () => {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const ctx = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 6 }) } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key];
        calls[key] ??= vi.fn();
        return calls[key];
      },
      set(target, key: string, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
};

const NOW = 200_000;
const at = (t: number, n: number, score = 3, win = false): Sample => ({
  t,
  score,
  bar: 38.4,
  win,
  n,
  proveMs: 1_980,
  at: Date.UTC(2026, 8, 21, 16, 6, 41),
});
const FEW = [at(50_000, 1), at(110_000, 2, 61.2, true), at(199_000, 3, 5)];

let drawn: ReturnType<typeof recorder>;
const canvas = () => {
  drawn = recorder();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawn.ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(662);
  vi.spyOn(performance, 'now').mockReturnValue(NOW);
  // Reduced motion: the still frame is drawn synchronously, and no frame loop runs.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

describe('ScoreLoop on a canvas', () => {
  beforeEach(canvas);
  afterEach(() => vi.restoreAllMocks());

  const strokes = (samples: Sample[]) => {
    drawn = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawn.ctx as never);
    const { unmount } = render(<ScoreLoop calm difficulty={38.4} samples={samples} height={230} />);
    const count = drawn.calls.stroke?.mock.calls.length ?? 0;
    unmount();
    return count;
  };

  test('the ordinary proofs of a frame are one stroke, however many there are', () => {
    const many = Array.from({ length: 60 }, (_, i) => at(60_000 + i * 2_000, i + 1));
    expect(strokes(many)).toBe(strokes(many.slice(0, 2)));
    expect(strokes(many)).toBeGreaterThan(0);
  });

  test('a claim in view is a band laid under the ticks, with its two bars and its word', () => {
    const spans: ClaimSpan[] = [{ id: 1, t0: 110_000, t1: 140_000, outcome: 'minted' }];
    render(<ScoreLoop calm difficulty={38.4} samples={FEW} spans={spans} height={230} />);
    // 3 minutes over 600 px from x = 48: the band runs 348 → 448, with a 2 px bar at each end.
    // One frame's worth: mounting draws the still more than once.
    const rects = drawn.calls.fillRect?.mock.calls.slice(0, 3).map((c) => c.map(Math.round));
    expect(rects).toEqual([
      [348, 24, 100, 182],
      [347, 24, 2, 182],
      [447, 24, 2, 182],
    ]);
    expect(drawn.calls.fillText?.mock.calls.map((c) => c[0])).toContain('CLAIMED · 30 s');
    // A claim that did not land keeps its duration too.
    cleanup();
    render(
      <ScoreLoop
        calm
        difficulty={38.4}
        samples={FEW}
        spans={[{ ...spans[0], outcome: 'failed' }]}
        height={230}
      />,
    );
    expect(drawn.calls.fillText?.mock.calls.map((c) => c[0])).toContain("DIDN'T LAND · 30 s");
    // The band is laid before the ticks' stroke.
    const order = (name: string) => drawn.calls[name]?.mock.invocationCallOrder[0] ?? 0;
    expect(order('fillRect')).toBeLessThan(order('stroke'));
  });

  test('a proof answers the pointer and the arrow keys with no frame loop running; Escape lets go', () => {
    const { container } = render(<ScoreLoop calm difficulty={38.4} samples={FEW} height={230} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    const card = () => container.querySelector('[data-slot=score-hover]')?.textContent;
    expect(card()).toBeUndefined();
    // t = 50 000 sits at x = 148.
    fireEvent.pointerMove(canvas, { clientX: 150 });
    expect(card()).toBe('#1 · reached 3.0below the difficulty · 1.98 s · 16:06:41');
    fireEvent.pointerMove(canvas, { clientX: 300 });
    expect(card()).toBeUndefined();
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(card()).toContain('#3 · reached 5.0');
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(card()).toBe('#2 · reached 61.2a win · 1.98 s · 16:06:41');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(card()).toBeUndefined();
  });
});

describe('the proof under the pointer', () => {
  beforeEach(canvas);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('the card follows its tick through a redraw React did not ask for, and leaves with the proof', () => {
    const width = vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(662);
    // The still frame's own redraw, as the browser calls it on a resize: nothing here renders React.
    let redraw = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          redraw = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(<ScoreLoop calm difficulty={38.4} samples={FEW} height={230} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.pointerMove(canvas, { clientX: 150 });
    const card = container.querySelector('[data-slot=score-hover]') as HTMLElement;
    expect(card.style.left).toBe('158px');
    // A wider canvas: the same proof is drawn 17 px further right, and so is its card.
    width.mockReturnValue(762);
    redraw();
    expect(card.style.left).toBe('175px');
    expect(card.hidden).toBe(false);
    // Three minutes on, the proof has left the window: the card goes with it.
    vi.spyOn(performance, 'now').mockReturnValue(50_000 + 180_001);
    redraw();
    expect(card.hidden).toBe(true);
  });

  test('the strip too short for words takes neither a pointer nor a title', () => {
    const { container } = render(
      <ScoreLoop
        calm
        difficulty={38.4}
        samples={FEW}
        height={48}
        axisTitle="difficulty reached · log scale"
      />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.pointerMove(canvas, { clientX: 150 });
    expect(container.querySelector('[data-slot=score-hover]')).toBeNull();
    expect(canvas.tabIndex).toBe(-1);
    expect(drawn.calls.fillText?.mock.calls.map((c) => c[0])).not.toContain('DIFFICULTY REACHED · LOG SCALE');
  });
});
