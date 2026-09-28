// The steps are HTML over the drawing, not SVG text: their prose wraps as the ring scales.
import { Tile } from '@yacana/ui';
import { copy } from '../copy';
import { Section, SectionHeading, SectionLabel } from './Section';

const w = copy.why;

/** The ring's four arcs on the 700 × 520 drawing, clockwise from the top, each with its head as a path. */
const ARCS = [
  ['M473.1 102.4A200 200 0 0 1 537.9 191.6', 'M532.1 187.3L538.6 193.5L539.6 184.6z'],
  ['M537.9 328.4A200 200 0 0 1 473.1 417.6', 'M475.4 410.8L471.5 418.8L480.3 417.1z'],
  ['M226.9 417.6A200 200 0 0 1 162.1 328.4', 'M167.9 332.7L161.4 326.5L160.4 335.4z'],
  ['M162.1 191.6A200 200 0 0 1 226.9 102.4', 'M224.6 109.2L228.5 101.2L219.7 102.9z'],
] as const;

/** Each step's centre in percent of the drawing, so the boxes follow the ring as it scales: top, right, bottom, left. */
const CENTRES = [
  { left: '50%', top: '11.5%' },
  { left: '82.1%', top: '50%' },
  { left: '50%', top: '88.5%' },
  { left: '17.9%', top: '50%' },
];

/** The loop is one image to a screen reader; the sentence at its centre stays text, outside it. */
function Ring() {
  return (
    <div className="relative mx-auto mt-6 hidden aspect-[700/520] w-full max-w-[700px] md:block xl:mt-0">
      <div role="img" aria-label={w.loop} data-testid="why-loop" className="absolute inset-0">
        <svg viewBox="0 0 700 520" aria-hidden className="absolute inset-0 size-full">
          <circle cx="350" cy="260" r="200" fill="none" className="stroke-line" />
          {ARCS.map(([arc, head]) => (
            <g key={arc}>
              <path d={arc} fill="none" className="stroke-uv-2" strokeWidth="1.5" />
              <path d={head} className="fill-uv-2" />
            </g>
          ))}
        </svg>
        {w.steps.map((s, i) => (
          <div
            key={s.n}
            data-step={s.n}
            style={CENTRES[i]}
            className="absolute flex w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-[8px] border border-line-2 bg-raised px-3.5 py-3"
          >
            <span className="font-mono text-2xs tracking-[0.06em] text-uv-2">
              {i + 1} · {s.n}
            </span>
            <span className="text-[14px] font-semibold leading-[1.35]">{s.title}</span>
            <span className="text-xs text-ink-3">{s.body}</span>
          </div>
        ))}
      </div>
      <p className="absolute top-1/2 left-1/2 w-[30%] -translate-x-1/2 -translate-y-1/2 text-center font-mono text-label leading-[1.5] text-ink-3">
        {w.core}
      </p>
    </div>
  );
}

export function Why() {
  return (
    <Section id="why" className="px-4 py-8 md:px-9">
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,620px)] xl:items-center xl:gap-10">
        <div>
          <SectionLabel>{w.label}</SectionLabel>
          <SectionHeading>{w.heading}</SectionHeading>
          <p className="max-w-[440px] text-pretty text-ink-2">{w.lede}</p>
        </div>
        <Ring />
      </div>
      <ol className="mt-6 grid gap-4 md:hidden" data-testid="why-steps">
        {w.steps.map((s, i) => (
          <Tile key={s.n} asChild>
            <li>
              <p className="mb-2 font-mono text-xs text-uv-2">
                {i + 1} · {s.n}
              </p>
              <h3 className="text-[14px] font-semibold leading-[1.45]">{s.title}</h3>
              <p className="mt-1.5 text-pretty text-xs text-ink-3">{s.body}</p>
            </li>
          </Tile>
        ))}
      </ol>
      <p className="mt-4 font-mono text-2xs text-ink-3 md:hidden">{w.core}</p>
    </Section>
  );
}
