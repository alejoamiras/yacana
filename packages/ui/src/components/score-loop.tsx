import * as React from 'react';
import { useDocumentHidden, useReducedMotion } from '../hooks/use-reduced-motion.ts';
import { cn } from '../lib/cn.ts';
import {
  axis,
  axisTo,
  axisTop,
  type BarSegment,
  barSegments,
  type ClaimSpan,
  calmTicks,
  clearOf,
  difficultyLabel,
  flash,
  type LabelBox,
  labelsCollide,
  nearestSample,
  type PlotGeometry,
  plotGeometry,
  rise,
  type Sample,
  type SpanBox,
  spanBoxes,
  stepSample,
  TITLE_COLUMN,
  won,
  xAt,
} from '../score-loop-model.ts';
import { DARK, ink } from '../tokens.ts';

export interface ScoreLoopProps {
  /** The bar; null before the epoch is read, when no bar is drawn and the caption says so. */
  difficulty: number | null;
  /** Centred over an empty window once the bar is known; two lines when a pair is given. */
  placeholder?: string | readonly [string, string];
  /** Every attempt of the window, oldest first, on the performance.now() clock. */
  samples: readonly Sample[];
  /** The last win's time, for the bar flash. */
  winAt?: number | null;
  /** Calm: the claims of the window, on the samples' clock, drawn as bands under the ticks. */
  spans?: readonly ClaimSpan[];
  /** Calm: the axis's name, set vertically in the left margin. */
  axisTitle?: string;
  /** Calm: what the difficulty line means, written at its left end. */
  barCaption?: string;
  spanMs?: number;
  /**
   * Calm: when mining started, on the samples' clock. The window grows from it (a minute at least)
   * until it reaches `spanMs`, so the first proofs spread across the width instead of crowding "now".
   */
  since?: number;
  /** Calm: the line under the plot's left edge ("3.6 s per proof · 12 proofs"), shown once proofs exist. */
  footer?: React.ReactNode;
  height?: number;
  /** The landing hero draws larger type and margins. */
  hero?: boolean;
  /**
   * The calm rendering: no grid, the bar as the only line labelled once, proofs as dim ticks, the win bright
   * with its score; the axis ceiling follows the bar and the best score in view instead of a fixed 1000.
   */
  calm?: boolean;
  /** Padding and type size, for a strip too short for the defaults (the pop-out's 48 px). */
  geometry?: { pad: number; fontPx: number };
  /** The window whose frames and visibility drive the drawing (the pop-out's, when drawn there); sample ages stay on the opener's clock. */
  win?: Window;
  className?: string;
}

interface Palette {
  uv: string;
  uv2: string;
  ink: string;
  ink3: string;
  line: string;
  warn: string;
}

// The canvas cannot use Tailwind classes; it reads the same variables theme.css sets on :root.
const palette = (el: HTMLElement): Palette => {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    uv: v('--uv', DARK.uv),
    uv2: v('--uv-2', DARK.uv2),
    ink: v('--ink', DARK.ink),
    ink3: v('--ink-3', ink(0.5)),
    line: v('--line', ink(0.1)),
    warn: v('--warn', DARK.warn),
  };
};

interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  pad: number;
  left: number;
  p: Palette;
  hero: boolean;
  fontPx: number;
  /** Score → 0…1 on the axis in force (fixed 1–1000, or the calm ceiling). */
  scale: (score: number) => number;
  /** The window drawn, in ms: the fixed span, or the calm window grown from `since`. */
  span: number;
  /** The x axis of this frame: what is drawn and what a pointer is hit-tested against are one mapping. */
  g: PlotGeometry;
  /** The win labels drawn this frame, so the next one steps clear of them. */
  labels: LabelBox[];
}

const CALM_SPAN_MS = 180_000;
const CALM_SPAN_MIN_MS = 60_000;

/** The window in force: fixed, or the calm one grown from `since` between a minute and the span. */
export function spanFor(props: Pick<ScoreLoopProps, 'calm' | 'spanMs' | 'since'>, now: number): number {
  const cap = props.spanMs ?? (props.calm ? CALM_SPAN_MS : 60_000);
  if (!props.calm || props.since === undefined) return cap;
  return Math.min(cap, Math.max(CALM_SPAN_MIN_MS, now - props.since));
}

const yOf = (f: Frame, fraction: number) => f.h - f.pad - fraction * (f.h - f.pad * 2);

/** One x mapping for everything drawn: the window's fraction (0 = span ago, 1 = now) to a pixel. */
const xOf = (f: Frame, right: number, fraction: number) => f.left + fraction * (right - f.left);

function strokeBar(f: Frame, right: number, segments: readonly BarSegment[]) {
  const { ctx } = f;
  ctx.beginPath();
  for (const seg of segments) {
    const y = yOf(f, f.scale(seg.bar));
    ctx.lineTo(xOf(f, right, seg.x0), y);
    ctx.lineTo(xOf(f, right, seg.x1), y);
  }
  ctx.stroke();
}

function drawGrid(f: Frame, right: number) {
  const { ctx } = f;
  ctx.font = `${f.fontPx}px "JetBrains Mono Variable", monospace`;
  ctx.textBaseline = 'middle';
  for (const g of [1, 10, 100, 1000]) {
    const y = yOf(f, f.scale(g));
    ctx.strokeStyle = f.p.line;
    ctx.beginPath();
    ctx.moveTo(f.left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = f.p.ink3;
    ctx.textAlign = 'right';
    ctx.fillText(String(g), f.left - 10, y);
  }
}

function drawBar(f: Frame, right: number, props: ScoreLoopProps, now: number, glow: number) {
  const difficulty = props.difficulty;
  if (difficulty === null) return;
  const { ctx } = f;
  const y = yOf(f, f.scale(difficulty));
  ctx.strokeStyle = glow > 0 ? f.p.uv2 : f.p.uv;
  ctx.lineWidth = 1.5 + glow * 1.5;
  strokeBar(f, right, barSegments(props.samples, difficulty, now, f.span));
  ctx.lineWidth = 1;
  ctx.fillStyle = f.p.uv2;
  ctx.textAlign = 'left';
  ctx.fillText(`difficulty ${difficultyLabel(difficulty)}`, f.left + 6, y - 10);
}

/** One attempt of the grid rendering: a stem from the baseline and a dot, ringed for a win. */
function drawDot(f: Frame, x: number, y: number, base: number, win: boolean, age: number) {
  const { ctx } = f;
  ctx.strokeStyle = win ? f.p.uv2 : f.p.line;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = win ? f.p.uv2 : f.p.ink;
  ctx.globalAlpha = win ? 1 : 0.85 - age * 0.6;
  ctx.beginPath();
  ctx.arc(x, y, win ? 4 : 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (!win) return;
  ctx.strokeStyle = f.p.uv;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDots(f: Frame, right: number, props: ScoreLoopProps, now: number, reduced: boolean) {
  const base = f.h - f.pad;
  for (const s of props.samples) {
    const age = (now - s.t) / f.span;
    if (age > 1 || age < 0) continue;
    const x = xOf(f, right, 1 - age);
    const y = base - (base - yOf(f, f.scale(s.score))) * rise(now, s.t, reduced);
    drawDot(f, x, y, base, won(s, props.difficulty), age);
  }
}

function drawLabels(f: Frame, right: number, props: ScoreLoopProps) {
  const { ctx } = f;
  const last = props.samples[props.samples.length - 1];
  if (last) {
    const win = won(last, props.difficulty);
    ctx.fillStyle = win ? f.p.uv2 : f.p.ink;
    ctx.textAlign = 'right';
    const y = Math.max(f.pad - 6, yOf(f, f.scale(last.score)) - 12);
    ctx.fillText(`reached ${last.score.toFixed(1)}${win ? ' · a win' : ''}`, right, y);
  }
  ctx.fillStyle = f.p.ink3;
  ctx.textAlign = 'left';
  ctx.fillText(`−${Math.round(f.span / 1000)} s`, f.left, f.h - 9);
  ctx.textAlign = 'right';
  ctx.fillText('now', right, f.h - 9);
}

/** Calm: the bars that changed inside the window, each labelled on the axis when it has room there. */
function drawOldBars(f: Frame, segments: readonly BarSegment[], yBar: number, yBase: number) {
  const { ctx } = f;
  ctx.fillStyle = f.p.ink3;
  ctx.textAlign = 'right';
  const drawn = [yBar, yBase];
  for (const seg of segments) {
    const y = yOf(f, f.scale(seg.bar));
    if (drawn.some((d) => labelsCollide(y, d, f.fontPx))) continue;
    drawn.push(y);
    ctx.fillText(difficultyLabel(seg.bar), f.left - 8, y);
  }
}

/** Calm: a dashed tick on the top edge where the bar stepped, named after the epoch that opened there. */
function drawSteps(f: Frame, right: number, segments: readonly BarSegment[]) {
  const { ctx } = f;
  for (let i = 1; i < segments.length; i++) {
    const from = segments[i - 1] as BarSegment;
    const to = segments[i] as BarSegment;
    const x = xOf(f, right, to.x0);
    ctx.strokeStyle = f.p.warn;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, f.pad);
    ctx.lineTo(x, f.h - f.pad);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (f.h <= 80) continue;
    const epoch = to.epoch === undefined ? '' : `epoch ${to.epoch} · `;
    const text = `${epoch}difficulty ${difficultyLabel(from.bar)} → ${difficultyLabel(to.bar)}`;
    const width = ctx.measureText(text).width;
    const flip = x + 6 + width > right;
    const x0 = flip ? x - 6 - width : x + 6;
    const box = { x0, x1: x0 + width, y: f.pad + f.fontPx / 2 };
    f.labels.push(box);
    ctx.fillStyle = f.p.warn;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(text, flip ? x - 6 : x + 6, box.y);
  }
}

/** Calm: the baseline at score 1 and the bar, each labelled once on the axis; no grid. */
function drawCalmLines(f: Frame, right: number, props: ScoreLoopProps, now: number, glow: number) {
  const { ctx } = f;
  const difficulty = props.difficulty;
  ctx.font = `${f.fontPx}px "JetBrains Mono Variable", monospace`;
  ctx.textBaseline = 'middle';
  const base = f.h - f.pad;
  ctx.strokeStyle = f.p.line;
  ctx.beginPath();
  ctx.moveTo(f.left, base);
  ctx.lineTo(right, base);
  ctx.stroke();
  ctx.textAlign = 'right';
  if (difficulty === null) {
    ctx.fillStyle = f.p.ink3;
    ctx.fillText('1', f.left - 8, base);
    ctx.textAlign = 'center';
    ctx.fillText('reading the epoch…', (f.left + right) / 2, (f.pad + base) / 2);
    return;
  }
  const y = yOf(f, f.scale(difficulty));
  // A bar on the floor would print its label over the baseline's: the baseline's steps aside.
  if (!labelsCollide(y, base, f.fontPx)) {
    ctx.fillStyle = f.p.ink3;
    ctx.fillText('1', f.left - 8, base);
  }
  const segments = barSegments(props.samples, difficulty, now, f.span);
  ctx.strokeStyle = glow > 0 ? f.p.uv2 : f.p.uv;
  ctx.lineWidth = 2 + glow * 1.5;
  strokeBar(f, right, segments);
  ctx.lineWidth = 1;
  drawOldBars(f, segments, y, base);
  ctx.fillStyle = f.p.uv2;
  ctx.textAlign = 'right';
  ctx.fillText(difficultyLabel(difficulty), f.left - 8, y);
  // Wins sit just above the bar by definition, and almost no proof ends just under it: the caption goes
  // under the line, unless the bar is on the floor.
  const under = base - y >= 2.4 * f.fontPx;
  if (f.h > 80)
    drawCaption(
      f,
      props.barCaption ?? `difficulty ${difficultyLabel(difficulty)} · reach it and you win`,
      under ? y + f.fontPx : y - f.fontPx,
    );
  drawSteps(f, right, segments);
}

/** At the bar's left end; registered so a win's own label steps clear of it. */
function drawCaption(f: Frame, text: string, y: number) {
  const { ctx } = f;
  const x0 = f.left + 8;
  f.labels.push({ x0, x1: x0 + ctx.measureText(text).width, y });
  ctx.textAlign = 'left';
  ctx.fillText(text, x0, y);
}

/** Calm: the axis's name, read bottom to top in the margin's own column. */
function drawAxisTitle(f: Frame, title: string) {
  const { ctx } = f;
  ctx.save();
  ctx.translate(TITLE_COLUMN - 4, f.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `${f.fontPx - 1}px "JetBrains Mono Variable", monospace`;
  ctx.letterSpacing = '0.14em';
  ctx.fillStyle = f.p.ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 0, 0);
  ctx.restore();
}

const spanLabel = (b: SpanBox): string => {
  if (b.live) return 'CLAIMING';
  return `${b.outcome === 'failed' ? "DIDN'T LAND" : 'CLAIMED'} · ${Math.round(b.ms / 1000)} s`;
};

/** The band's word: inside when it fits, else above the band against its right edge. */
function drawSpanLabel(f: Frame, b: SpanBox, color: string, now: number, reduced: boolean) {
  const { ctx } = f;
  const text = spanLabel(b);
  ctx.save();
  ctx.letterSpacing = '0.14em';
  const width = ctx.measureText(text).width;
  const inside = width + 12 <= b.x1 - b.x0;
  ctx.fillStyle = color;
  ctx.globalAlpha = b.live && !reduced ? 0.75 + 0.25 * Math.sin(now / 450) : b.live ? 1 : 0.75;
  ctx.textAlign = inside ? 'center' : 'right';
  const x = inside ? (b.x0 + b.x1) / 2 : Math.max(b.x1, f.left + width);
  ctx.fillText(text, x, inside ? f.pad + (f.h - 2 * f.pad) * 0.62 : f.pad - 8);
  ctx.restore();
}

/**
 * Calm: a claim is a band between two bars, from the win to its end. Mining pauses for it, and without the
 * band the window just goes empty. Drawn under the ticks; amber when the claim did not land.
 */
function drawSpans(f: Frame, spans: readonly ClaimSpan[], now: number, reduced: boolean) {
  const { ctx } = f;
  const top = f.pad;
  const height = f.h - 2 * f.pad;
  for (const b of spanBoxes(spans, f.g)) {
    const failed = b.outcome === 'failed';
    ctx.fillStyle = failed ? f.p.warn : f.p.uv;
    ctx.globalAlpha = b.live ? 0.2 : 0.09;
    ctx.fillRect(b.x0, top, b.x1 - b.x0, height);
    ctx.globalAlpha = b.live ? 1 : 0.55;
    if (b.opened) ctx.fillRect(b.x0 - 1, top, 2, height);
    ctx.fillRect(b.x1 - 1, top, 2, height);
    ctx.globalAlpha = 1;
    if (f.h > 80) drawSpanLabel(f, b, failed ? f.p.warn : f.p.uv2, now, reduced);
  }
}

function tick(f: Frame, x: number, y0: number, y1: number, color: string, width: number, alpha = 1) {
  const { ctx } = f;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

/**
 * Calm: a win is the ringed dot with a short drop that ends above its own bar — never a stem from the
 * baseline, which would cover a step drawn at the same x — and its score beside it when there is room.
 */
function drawCalmWin(f: Frame, right: number, x: number, y: number, s: Sample, yOwnBar: number) {
  const { ctx } = f;
  const tall = f.h > 80;
  const r = tall ? 5 : 3.5;
  if (yOwnBar - 5 > y + r + 2) tick(f, x, y + r + 2, yOwnBar - 5, f.p.uv2, 1.5);
  ctx.fillStyle = f.p.uv2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = f.p.uv2;
  ctx.beginPath();
  ctx.arc(x, y, tall ? 9 : 6.5, 0, Math.PI * 2);
  ctx.stroke();
  if (!tall) return;
  const flip = x > right - 90;
  const text = `★ ${s.score.toFixed(1)} · a win`;
  const width = ctx.measureText(text).width;
  const x0 = flip ? x - 14 - width : x + 14;
  // The bar's caption and the steps' names are placed already: the label steps down clear of them.
  const box = {
    x0,
    x1: x0 + width,
    y: clearOf(f.labels, { x0, x1: x0 + width, y: y - 4 }, f.fontPx, f.h - f.pad),
  };
  f.labels.push(box);
  ctx.fillStyle = f.p.ink;
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillText(text, flip ? x - 14 : x + 14, box.y);
}

/**
 * Calm: every ordinary proof of the frame is one path, stroked once. Stroked one by one at 55 %, ticks a
 * pixel apart add up to a bright bar that no proof earned.
 */
function drawTicks(f: Frame, props: ScoreLoopProps, now: number, reduced: boolean, hover: Sample | null) {
  const { ctx } = f;
  const base = f.h - f.pad;
  const top = (s: Sample) => base - (base - yOf(f, f.scale(s.score))) * rise(now, s.t, reduced);
  ctx.strokeStyle = f.p.ink3;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const k of calmTicks(props.samples, props.difficulty, f.g)) {
    ctx.moveTo(k.x, base);
    ctx.lineTo(k.x, top(k.s));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  const x = hover ? xAt(f.g, hover.t) : Number.NaN;
  if (hover && !won(hover, props.difficulty) && x >= f.g.left) tick(f, x, base, top(hover), f.p.ink, 2);
}

/** Calm: ordinary proofs are dim ticks from the baseline; wins are drawn bright; an empty plot says why. */
function drawCalmDots(
  f: Frame,
  right: number,
  props: ScoreLoopProps,
  now: number,
  reduced: boolean,
  hover: Sample | null,
) {
  const { ctx } = f;
  const base = f.h - f.pad;
  drawTicks(f, props, now, reduced, hover);
  for (const s of props.samples) {
    const age = (now - s.t) / f.span;
    if (age > 1 || age < 0 || !won(s, props.difficulty)) continue;
    const y = base - (base - yOf(f, f.scale(s.score))) * rise(now, s.t, reduced);
    const own = s.bar ?? props.difficulty;
    drawCalmWin(f, right, xAt(f.g, s.t), y, s, own === null ? base : yOf(f, f.scale(own)));
  }
  if (f.h <= 80 || props.samples.length || !props.placeholder || props.difficulty === null) return;
  const lines = typeof props.placeholder === 'string' ? [props.placeholder] : props.placeholder;
  ctx.textAlign = 'center';
  const middle = (f.pad + base) / 2;
  lines.forEach((text, i) => {
    ctx.fillStyle = i === 0 ? f.p.ink : f.p.ink3;
    ctx.fillText(text, (f.left + right) / 2, middle + (i - (lines.length - 1) / 2) * (f.fontPx + 8));
  });
}

/** The axis is named, and a proof answers a pointer, only where there is room: never on the pop-out's strip. */
const roomy = (props: ScoreLoopProps): boolean => Boolean(props.calm) && (props.height ?? 200) > 80;
const titled = (props: ScoreLoopProps): boolean => roomy(props) && Boolean(props.axisTitle);

function layout(props: ScoreLoopProps): { pad: number; fontPx: number; left: number } {
  if (props.geometry) return { ...props.geometry, left: 28 };
  return props.hero ? { pad: 30, fontPx: 12, left: 58 } : { pad: 24, fontPx: 11, left: 48 };
}

/** The score axis in force: the fixed 1–1000 log, or the calm ceiling over what this window shows. */
function scaleFor(props: ScoreLoopProps, now: number, span: number): (score: number) => number {
  if (!props.calm) return axis;
  // The ceiling is computed from what this window shows, not from everything the store retains.
  const top = axisTop(
    props.difficulty ?? 1,
    props.samples.filter((s) => now - s.t <= span && now - s.t >= 0),
  );
  return (score) => axisTo(score, top);
}

/** Sizes the backing store to the element and the device, and builds the frame the drawing functions share. */
function frame(canvas: HTMLCanvasElement, props: ScoreLoopProps, now: number): Frame | undefined {
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  if (!ctx || w < 2) return undefined;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const h = props.height ?? 200;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const { pad, fontPx, left: floor } = layout(props);
  // The font before the measurement: the margin is the widest label the axis will carry.
  ctx.font = `${fontPx}px "JetBrains Mono Variable", monospace`;
  const widest = props.calm ? (props.difficulty === null ? '1' : difficultyLabel(props.difficulty)) : '1000';
  const span = spanFor(props, now);
  const g = plotGeometry({
    width: w,
    labelWidth: ctx.measureText(widest).width,
    floor,
    now,
    spanMs: span,
    titled: titled(props),
  });
  return {
    ctx,
    w,
    h,
    pad,
    left: g.left,
    g,
    p: palette(canvas),
    hero: props.hero ?? false,
    fontPx,
    scale: scaleFor(props, now, span),
    span,
    labels: [],
  };
}

/** The fixed text a drawing error leaves behind; the error itself went to the console. */
function drawFailure(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '11px "JetBrains Mono Variable", monospace';
  ctx.fillStyle = palette(canvas).ink3;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('This tile hit an error. Reload the page.', canvas.clientWidth / 2, canvas.clientHeight / 2);
}

/** What one frame drew, kept whole: a pointer is resolved against it, not against a frame that may never come. */
interface Drawn {
  g: PlotGeometry;
  width: number;
  yOf: (score: number) => number;
}

function draw(
  canvas: HTMLCanvasElement,
  props: ScoreLoopProps,
  now: number,
  reduced: boolean,
  hover: Sample | null = null,
): Drawn | undefined {
  const f = frame(canvas, props, now);
  if (!f) return undefined;
  const right = f.g.right;
  const glow = flash(now, props.winAt ?? null);
  if (props.calm) {
    if (titled(props)) drawAxisTitle(f, props.axisTitle ?? '');
    drawSpans(f, props.spans ?? [], now, reduced);
    drawCalmLines(f, right, props, now, glow);
    drawCalmDots(f, right, props, now, reduced, hover);
  } else {
    drawGrid(f, right);
    drawBar(f, right, props, now, glow);
    drawDots(f, right, props, now, reduced);
    drawLabels(f, right, props);
  }
  return { g: f.g, width: f.w, yOf: (score) => yOf(f, f.scale(score)) };
}

/** The pop-out's visibility when the loop is drawn there, else the page's. */
function useHidden(win: Window | undefined): boolean {
  const pageHidden = useDocumentHidden();
  const [winHidden, setWinHidden] = React.useState(false);
  React.useEffect(() => {
    if (!win) return;
    const onVis = () => setWinHidden(win.document.hidden);
    onVis();
    win.document.addEventListener('visibilitychange', onVis);
    return () => win.document.removeEventListener('visibilitychange', onVis);
  }, [win]);
  return win ? winHidden : pageHidden;
}

/** A still frame is only right for the size and palette it was drawn with. */
function watchStill(canvas: HTMLCanvasElement, w: Window, still: () => void): () => void {
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(still);
  resize?.observe(canvas);
  const theme = new MutationObserver(still);
  theme.observe(w.document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    resize?.disconnect();
    theme.disconnect();
  };
}

/**
 * Draws on requestAnimationFrame while visible in a foreground tab; a still frame under reduced motion. When
 * `win` is another window (the pop-out), its frames and visibility drive the loop; sample ages stay on the
 * opener's clock, which is the one the samples carry. Every frame drawn is left in `drawn`.
 */
function useDrawing(
  ref: React.RefObject<HTMLCanvasElement | null>,
  drawn: React.RefObject<Drawn | null>,
  props: ScoreLoopProps,
  hover: Sample | null,
  reduced: boolean,
  after: (d: Drawn) => void,
): void {
  const hidden = useHidden(props.win);
  const win = props.win;
  const latest = React.useRef({ props, hover, after });
  latest.current = { props, hover, after };
  const keep = React.useCallback(
    (d: Drawn | undefined) => {
      drawn.current = d ?? null;
      if (d) latest.current.after(d);
    },
    [drawn],
  );

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || hidden) return;
    const w = win ?? window;
    // Samples carry the opener's performance.now(); a pop-out's rAF timestamps run on its own, later
    // time origin, so frames are scheduled on `w` but every age is measured on the page's clock.
    // A throw inside a frame reaches no React boundary: the loop stops and the canvas says so.
    const frameOnce = (still: boolean): boolean => {
      try {
        keep(draw(canvas, latest.current.props, performance.now(), still, latest.current.hover));
        return true;
      } catch (e) {
        console.error(e);
        drawFailure(canvas);
        return false;
      }
    };
    if (reduced) {
      frameOnce(true);
      return watchStill(canvas, w, () => void frameOnce(true));
    }
    let raf = 0;
    const tick = () => {
      if (frameOnce(false)) raf = w.requestAnimationFrame(tick);
    };
    raf = w.requestAnimationFrame(tick);
    return () => w.cancelAnimationFrame(raf);
  }, [ref, keep, reduced, hidden, win]);

  // No loop runs under reduced motion: new props or another proof under the pointer redraw the still.
  React.useEffect(() => {
    const canvas = ref.current;
    if (canvas && reduced && !hidden) keep(draw(canvas, props, performance.now(), true, hover));
  }, [ref, keep, props, hover, reduced, hidden]);
}

type HoverHandlers = Pick<
  React.ComponentProps<'canvas'>,
  'onPointerMove' | 'onPointerLeave' | 'onKeyDown' | 'onBlur' | 'tabIndex'
>;

/**
 * The proof under the pointer, resolved on `pointermove` against the last frame drawn — never inside the
 * frame loop, which does not run under reduced motion. The arrow keys walk the proofs, so the card is not
 * pointer-only; Escape or leaving lets go.
 */
function useScoreHover(enabled: boolean, samples: readonly Sample[], drawn: React.RefObject<Drawn | null>) {
  const [hover, setHover] = React.useState<Sample | null>(null);
  const live = React.useRef(samples);
  live.current = samples;
  const handlers = React.useMemo<HoverHandlers>(() => {
    if (!enabled) return {};
    const pick = (next: Sample | null) => setHover((was) => (was?.t === next?.t ? was : next));
    return {
      tabIndex: 0,
      onPointerMove: (e) => {
        const d = drawn.current;
        if (d)
          pick(nearestSample(live.current, d.g, e.clientX - e.currentTarget.getBoundingClientRect().left));
      },
      onPointerLeave: () => pick(null),
      onBlur: () => pick(null),
      onKeyDown: (e) => {
        const d = drawn.current;
        if (e.key === 'Escape') return pick(null);
        if (!d || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        setHover((was) => stepSample(live.current, d.g, was, e.key === 'ArrowLeft' ? -1 : 1));
      },
    };
  }, [enabled, drawn]);
  return { hover: enabled ? hover : null, handlers };
}

const CARD_WIDTH = 212;

const hoverLines = (s: Sample, difficulty: number | null): [string, string] => {
  const head = `${s.n === undefined ? '' : `#${s.n} · `}reached ${s.score.toFixed(1)}`;
  const tail = [
    won(s, difficulty) ? 'a win' : 'below the difficulty',
    s.proveMs === undefined ? null : `${(s.proveMs / 1000).toFixed(2)} s`,
    s.at === undefined ? null : new Date(s.at).toISOString().slice(11, 19),
  ];
  return [head, tail.filter(Boolean).join(' · ')];
};

/** Beside its tick as that frame drew it; gone once the proof has left the window. */
function placeCard(el: HTMLElement, sample: Sample, d: Drawn) {
  const x = xAt(d.g, sample.t);
  el.hidden = x < d.g.left;
  const left = x + 10 + CARD_WIDTH > d.width ? x - 10 - CARD_WIDTH : x + 10;
  el.style.left = `${Math.round(Math.max(0, left))}px`;
  el.style.top = `${Math.round(Math.max(0, d.yOf(sample.score) - 30))}px`;
}

/**
 * One proof, said in words beside its tick. React renders the words; every frame drawn places the card,
 * because the tick moves (the window scrolls, the canvas resizes) without React rendering anything.
 */
function ScoreHoverCard({
  ref,
  sample,
  drawn,
  difficulty,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  sample: Sample;
  drawn: React.RefObject<Drawn | null>;
  difficulty: number | null;
}) {
  React.useLayoutEffect(() => {
    if (ref.current && drawn.current) placeCard(ref.current, sample, drawn.current);
  });
  const [head, tail] = hoverLines(sample, difficulty);
  return (
    <div
      ref={ref}
      data-slot="score-hover"
      role="status"
      className="pointer-events-none absolute z-10 rounded-md border border-line-2 bg-panel px-2.5 py-1.5 font-mono text-2xs text-ink-3"
      style={{ width: CARD_WIDTH }}
    >
      <span className="block text-ink">{head}</span>
      <span className="block">{tail}</span>
    </div>
  );
}

export function ScoreLoop(props: ScoreLoopProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const drawn = React.useRef<Drawn | null>(null);
  const card = React.useRef<HTMLDivElement>(null);
  const { hover, handlers } = useScoreHover(roomy(props), props.samples, drawn);
  useDrawing(ref, drawn, props, hover, reduced, (d) => {
    if (card.current && hover) placeCard(card.current, hover, d);
  });

  const span = props.spanMs ?? (props.calm ? CALM_SPAN_MS : 60_000);
  const height = props.height ?? 200;
  // The calm plot's bottom line lives in the DOM: the footer at the axis's left, "now" at the right edge.
  // The row's height is reserved from the first paint: the tile must not grow when proofs arrive.
  const row = props.calm && height > 80;
  const filled = props.samples.length > 0;
  const left = layout(props).left + (titled(props) ? TITLE_COLUMN : 0);
  return (
    <div className={cn('relative flex flex-col', props.className)}>
      <canvas
        ref={ref}
        data-slot="score-loop"
        data-reduced={reduced || undefined}
        data-calm={props.calm || undefined}
        role="img"
        aria-label={`${props.samples.length} proofs in the last ${Math.round(span / 1000)} seconds, difficulty ${props.difficulty === null ? 'not read yet' : difficultyLabel(props.difficulty)}`}
        className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ height }}
        {...handlers}
      />
      {hover && <ScoreHoverCard ref={card} sample={hover} drawn={drawn} difficulty={props.difficulty} />}
      {row && (
        <div
          data-slot="score-loop-footer"
          data-filled={filled || undefined}
          className="flex min-h-[1.3em] items-baseline justify-between gap-3 font-mono text-2xs text-ink-3"
          style={{ paddingLeft: left, paddingRight: 14 }}
        >
          <span>{filled ? props.footer : null}</span>
          <span>{filled ? 'now' : null}</span>
        </div>
      )}
    </div>
  );
}
