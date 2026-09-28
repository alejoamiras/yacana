import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export const shortHash = (h: string): string => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

/** What the chain saw: the claim's nullifier, the mint's note hash, the claim count. Never who, how fast, how much. */
export function Marks({
  nullifier,
  noteHash,
  moreNotes = 0,
  claims,
  suffix,
  className,
}: {
  nullifier: string;
  noteHash: string;
  /** Note hashes in the transaction beyond the mint's (a first contact's handshake). */
  moreNotes?: number;
  /** Before and after the claim. */
  claims: [number, number];
  /** e.g. "epoch closed". */
  suffix?: React.ReactNode;
  className?: string;
}) {
  const chip =
    'inline-flex items-center gap-1.5 rounded-sm border border-line bg-panel px-2 py-1 font-mono text-2xs text-ink-2';
  return (
    <div
      data-slot="marks"
      className={cn(
        'flex flex-wrap items-center gap-2 animate-in fade-in duration-200 motion-reduce:animate-none',
        className,
      )}
    >
      <span className={chip}>
        <span className="text-ink-2">nullifier</span> {shortHash(nullifier)}
      </span>
      <span className={chip}>
        <span className="text-ink-2">note hash</span> {shortHash(noteHash)}
        {moreNotes > 0 && <span className="text-ink-2">+{moreNotes}</span>}
      </span>
      <span className={chip}>
        <span className="text-ink-2">wins</span> {claims[0]} → {claims[1]}
        {suffix !== undefined && <span className="text-ink-2"> · {suffix}</span>}
      </span>
    </div>
  );
}
