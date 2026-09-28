import * as Plot from '@observablehq/plot';
import { cn, useReducedMotion } from '@yacana/ui';
import { type ComponentProps, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChartInput, Spec } from './specs';

const FADE_MS = 240;
type Figure = HTMLElement | SVGSVGElement;

/** The container's width through a ResizeObserver: 0 until measured; 640 where there is no observer (jsdom). */
export function useWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return typeof ResizeObserver === 'undefined' ? 640 : width;
}

/** The outgoing figures fade under the incoming one, inert and hidden from assistive tech, then go. */
function crossFade(next: Figure, previous: Figure[]): () => void {
  next.style.opacity = '0';
  next.style.transition = `opacity ${FADE_MS}ms ease`;
  for (const p of previous) {
    p.setAttribute('aria-hidden', 'true');
    p.style.pointerEvents = 'none';
    p.style.transition = `opacity ${FADE_MS}ms ease`;
    p.style.opacity = '0';
  }
  const frame = requestAnimationFrame(() => {
    next.style.opacity = '1';
  });
  const timer = setTimeout(() => {
    for (const p of previous) p.remove();
  }, FADE_MS + 20);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    for (const p of previous) p.remove();
  };
}

/**
 * Plot re-creates its nodes: a fresh figure on every change of rows, selection or width, a
 * cross-fade only when the set of epochs changed (a close or an open), instant under reduced motion.
 */
export function Chart({
  spec,
  input,
  height,
  className,
  ...props
}: { spec: Spec; input: Omit<ChartInput, 'width' | 'height'>; height: number } & ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const reduced = useReducedMotion();
  const epochs = input.rows.map((r) => r.epoch).join(',');
  const drawn = useRef<string | null>(null);
  const { rows, selected, rules, open } = input;
  useEffect(() => {
    const el = ref.current;
    if (!el || !width) return;
    const figure = Plot.plot(spec({ rows, selected, rules, open, width, height }));
    figure.style.position = 'absolute';
    figure.style.inset = '0';
    const previous = Array.from(el.children) as Figure[];
    const animate = !reduced && drawn.current !== null && drawn.current !== epochs;
    drawn.current = epochs;
    el.append(figure);
    if (!animate) {
      for (const p of previous) p.remove();
      return;
    }
    return crossFade(figure, previous);
  }, [spec, rows, selected, rules, open, width, height, epochs, reduced]);
  return (
    <div
      ref={ref}
      className={cn('relative w-full', className)}
      style={{ height }}
      data-slot="chart"
      {...props}
    />
  );
}
