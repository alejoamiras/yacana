import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Tip } from './tooltip.tsx';

afterEach(cleanup);

test('the word is dotted and focusable; focus opens the tip, blur closes it; no provider needed', async () => {
  render(
    <p>
      <Tip tip="About one proof in 38 wins.">difficulty</Tip> 38.4
    </p>,
  );
  const word = screen.getByText('difficulty');
  expect(word.getAttribute('data-slot')).toBe('tip-trigger');
  expect(word.tabIndex).toBe(0);
  expect(word.className).toContain('decoration-dotted');
  expect(screen.queryByRole('tooltip')).toBeNull();
  await act(async () => word.focus());
  expect(screen.getByRole('tooltip').textContent).toBe('About one proof in 38 wins.');
  await act(async () => word.blur());
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('in a second document the tip is portalled to the given container, never to the opener', async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const other = frame.contentDocument as Document;
  const host = other.body.appendChild(other.createElement('div'));
  render(
    <Tip tip="About one proof in 38 wins." container={other.body}>
      difficulty
    </Tip>,
    { container: host },
  );
  const word = other.querySelector('[data-slot=tip-trigger]') as HTMLElement;
  await act(async () => word.focus());
  expect(other.querySelector('[role=tooltip]')?.textContent).toBe('About one proof in 38 wins.');
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  await act(async () => word.blur());
  expect(other.querySelector('[role=tooltip]')).toBeNull();
  // A click there never reaches the opener's `pointerup`: focus must still open the tip afterwards.
  await act(async () => {
    fireEvent.pointerDown(word);
    fireEvent.pointerUp(word);
  });
  await act(async () => word.focus());
  expect(other.querySelector('[role=tooltip]')).not.toBeNull();
  cleanup();
  frame.remove();
});
