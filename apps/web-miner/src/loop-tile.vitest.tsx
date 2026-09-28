import { act, cleanup, render } from '@testing-library/react';
import type { ScoreLoopProps } from '@yacana/ui';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoopTile, PipView } from './features/LoopTile';
import { initial } from './lib/reducer';
import { difficultyCaption, epochTips, nextDifficulty } from './lib/words';
import { epochAtom, minerAtom } from './state';

// The chart itself is drawn on a canvas and tested in `ui`; here it only says what it was given.
const given: ScoreLoopProps[] = [];
vi.mock('@yacana/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@yacana/ui')>()),
  ScoreLoop: (props: ScoreLoopProps) => {
    given.push(props);
    return null;
  },
}));

// jsdom has no matchMedia; the tile's tweened numbers read it.
beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })),
);

afterEach(() => {
  cleanup();
  given.length = 0;
});

describe("the claim's band reaches both charts", () => {
  const spans = [{ id: 1, t0: 1_000, t1: null }];
  const store = () => {
    const s = createStore();
    s.set(minerAtom, { ...initial, claimSpans: spans });
    s.set(epochAtom, { epoch: 12n, seed: 7n, target: 1n << 122n, openedAt: 0n, claims: 2 });
    return s;
  };
  const controls = { controller: () => undefined, onStart: () => {} };

  test('the tile names the axis and says what the difficulty means; the pop-out draws the same spans and caption', () => {
    render(
      <Provider store={store()}>
        <LoopTile {...controls} />
        <PipView {...controls} win={window} />
      </Provider>,
    );
    const [tile, pip] = given;
    expect(tile?.spans).toBe(spans);
    expect(tile?.axisTitle).toBe('difficulty reached · log scale');
    expect(tile?.barCaption).toBe('difficulty 64.0 · reach it and you win · about 1 in 64 do');
    expect(pip?.spans).toBe(spans);
    expect(pip?.barCaption).toBe(tile?.barCaption);
    expect(pip?.height).toBe(48);
  });

  test('the pop-out is another document: its tip opens there, not in the opener', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const pip = frame.contentWindow as Window;
    render(
      <Provider store={store()}>
        <PipView {...controls} win={pip} />
      </Provider>,
      { container: pip.document.body.appendChild(pip.document.createElement('div')) },
    );
    const word = pip.document.querySelector('[data-slot=tip-trigger]') as HTMLElement;
    expect(word.textContent).toBe('difficulty');
    await act(async () => word.focus());
    expect(pip.document.querySelector('[role=tooltip]')?.textContent).toBe('About one proof in 64 wins.');
    expect(document.querySelector('[role=tooltip]')).toBeNull();
    // Unmounted while its document still exists: React removes the portal from that body.
    cleanup();
    frame.remove();
  });

  test('the odds are said only when they are odds; the tip and the next difficulty carry the live number', () => {
    expect(difficultyCaption(null)).toBeUndefined();
    expect(difficultyCaption(1.4)).toBe('difficulty 1.4 · reach it and you win');
    expect(difficultyCaption(38.4)).toBe('difficulty 38.4 · reach it and you win · about 1 in 38 do');
    const rules = { N: 4, EXPECTED_EPOCH_SECONDS: 300n, T_MAX: 1200n, REWARD: 1n };
    expect(epochTips(rules, 64).difficulty).toBe(
      'How hard a win is right now. At difficulty 64.0, about one proof in 64 wins.',
    );
    expect(epochTips(rules, 64).expected).toMatch(/^The network aims for 4 wins every 5 min\. /);
    expect(nextDifficulty(64, 2.31)).toBe('147.8 (×2.31)');
  });
});
