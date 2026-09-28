import type * as React from 'react';
import { cn } from '../lib/cn.ts';
import { ExternalLink } from './external-link.tsx';

/** Turns a minted line's block and transaction into explorer URLs; either may be undefined (no link). */
export type LedgerLinks = (links: { block: number; tx: string }) => { block?: string; tx?: string };

/** What a win line says after "a win": the claim's step, then its outcome; `action` is a link the ledger's `onAction` answers. */
export interface WinNote {
  text: string;
  tone: 'uv' | 'warn' | 'dim';
  action?: string;
}

/** The ledger's line grammar: ★ win · ✓ minted · ✗ failed · ── epoch; plain lines are attempts. */
export type ProofLine =
  | { kind: 'attempt'; time: string; n: number; score: number; proveMs: number; best?: boolean }
  | { kind: 'win'; time: string; n: number; score: number; proveMs: number; note?: WinNote }
  /** `text` follows the block phrase, which the renderer builds from `links.block` (linked when it can). */
  | {
      kind: 'minted';
      time: string;
      text: string;
      links?: { block: number; tx: string };
      suffix?: string;
      /** What the suffix means, on hover. */
      suffixTitle?: string;
    }
  | { kind: 'failed'; time: string; text: string }
  | { kind: 'epoch'; time: string; text: string };

export const LEDGER_WINDOW = 200;

const GLYPH: Record<ProofLine['kind'], string> = {
  attempt: '',
  win: '★',
  minted: '✓',
  failed: '✗',
  epoch: '──',
};

const TONE: Record<ProofLine['kind'], string> = {
  attempt: 'text-ink-2',
  win: 'text-uv-2 animate-pulse [animation-iteration-count:1]',
  minted: 'text-ok',
  failed: 'text-bad',
  epoch: 'text-ink-3',
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

const NOTE_TONE: Record<WinNote['tone'], string> = { uv: 'text-uv-2', warn: 'text-warn', dim: 'text-ink-3' };

function Attempt({ line, onAction }: { line: Extract<ProofLine, { n: number }>; onAction?: () => void }) {
  const note = line.kind === 'win' ? line.note : undefined;
  return (
    <>
      <span className="text-ink-2">#{line.n}</span>
      <span className={line.kind === 'attempt' ? 'text-ink' : undefined}>
        reached {line.score.toFixed(1)}
      </span>
      <span className="text-ink-2">{seconds(line.proveMs)}</span>
      {line.kind === 'attempt' && line.best && <span className="text-uv-2">best this epoch</span>}
      {line.kind === 'win' && (
        <span className="whitespace-normal">
          a win
          {note && (
            <span className={NOTE_TONE[note.tone]} data-slot="win-note">
              {' '}
              · {note.text}
              {note.action && (
                <>
                  {' '}
                  ·{' '}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-ink"
                    onClick={onAction}
                  >
                    {note.action}
                  </button>
                </>
              )}
            </span>
          )}
        </span>
      )}
    </>
  );
}

function Minted({ line, linkFor }: { line: Extract<ProofLine, { kind: 'minted' }>; linkFor?: LedgerLinks }) {
  if (!line.links) return <span>{line.text}</span>;
  const urls = linkFor?.(line.links);
  const block = `block ${line.links.block.toLocaleString('en-US')}`;
  return (
    <>
      <span>
        minted in{' '}
        {urls?.block ? (
          <ExternalLink href={urls.block} full={String(line.links.block)}>
            {block}
          </ExternalLink>
        ) : (
          block
        )}{' '}
        · {line.text}
      </span>
      {urls?.tx && (
        <span>
          ·{' '}
          <ExternalLink href={urls.tx} full={line.links.tx}>
            effects
          </ExternalLink>
        </span>
      )}
      {line.suffix && (
        <span className="text-ink-3" title={line.suffixTitle}>
          · {line.suffix}
        </span>
      )}
    </>
  );
}

function Event({ line, linkFor }: { line: Extract<ProofLine, { text: string }>; linkFor?: LedgerLinks }) {
  if (line.kind === 'minted') return <Minted line={line} linkFor={linkFor} />;
  return (
    <>
      <span>{line.text}</span>
      {line.kind === 'epoch' && <span aria-hidden>──</span>}
    </>
  );
}

function Line({
  line,
  linkFor,
  onAction,
}: {
  line: ProofLine;
  linkFor?: LedgerLinks;
  onAction?: () => void;
}) {
  return (
    <li
      data-slot="proof-line"
      data-kind={line.kind}
      className={cn(
        'flex gap-3 py-0.5 font-mono text-xs whitespace-nowrap animate-in fade-in slide-in-from-top-1 duration-[120ms] motion-reduce:animate-none',
        TONE[line.kind],
      )}
    >
      <span className="text-ink-2">{line.time}</span>
      {GLYPH[line.kind] && (
        <span>
          <span aria-hidden>{GLYPH[line.kind]}</span>
          <span className="sr-only">{line.kind}</span>
        </span>
      )}
      {'n' in line ? <Attempt line={line} onAction={onAction} /> : <Event line={line} linkFor={linkFor} />}
    </li>
  );
}

/**
 * Newest first; keeps the last LEDGER_WINDOW lines in the DOM. `linkFor` resolves a minted line's
 * explorer links; `onAction` answers a win note's link with the line's id.
 */
export function ProofLedger<Id extends string | number>({
  lines,
  linkFor,
  onAction,
  className,
  ...props
}: Omit<React.ComponentProps<'ol'>, 'onSelect'> & {
  lines: readonly (ProofLine & { id: Id })[];
  linkFor?: LedgerLinks;
  onAction?: (id: Id) => void;
}) {
  return (
    <ol data-slot="proof-ledger" className={cn('m-0 list-none p-0', className)} {...props}>
      {lines.slice(0, LEDGER_WINDOW).map((line) => (
        <Line key={line.id} line={line} linkFor={linkFor} onAction={onAction && (() => onAction(line.id))} />
      ))}
    </ol>
  );
}
