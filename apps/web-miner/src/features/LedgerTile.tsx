import { difficulty } from '@yacana/miner-core/metrics';
import { Button, ProofLedger, type ProofLine, Tile, TileHeader } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import type { MinerController } from '../controller';
import { ledgerLinks } from '../explorer';
import { settlementSuffix, settlementTitle, winNote } from '../lib/claim-copy';
import type { LedgerLine } from '../lib/reducer';
import { epochOpened } from '../lib/words';
import type { ProverKind } from '../presto';
import { type ClaimRecord, claimsAtom, epochAtom, minerAtom, nowAtom } from '../state';
import { useTxProver } from './dialogs/use-tx-prover';
import { WinsDialog } from './dialogs/Wins';

/** The lines as the ledger draws them: the win's note as of `now`, the minted line's settlement by its transaction. */
export const shownLines = (
  lines: readonly LedgerLine[],
  claims: readonly ClaimRecord[],
  nowMs: number,
  prover: ProverKind = 'wasm',
): (ProofLine & { id: number })[] =>
  lines.map((l) => {
    if (l.kind === 'win') return { ...l, note: winNote(l.claim, nowMs, prover) };
    if (l.kind === 'minted' && l.links) {
      const settled = claims.find((c) => c.txHash === l.links?.tx)?.settled;
      const suffix = settlementSuffix(settled);
      return suffix ? { ...l, suffix, suffixTitle: settlementTitle(settled) } : l;
    }
    return l;
  });

export function LedgerTile({
  controller,
  className,
}: {
  controller: () => MinerController | undefined;
  className?: string;
}) {
  const miner = useAtomValue(minerAtom);
  const epoch = useAtomValue(epochAtom);
  const claims = useAtomValue(claimsAtom);
  const now = useAtomValue(nowAtom);
  const txProver = useTxProver();
  const [wins, setWins] = useState(false);
  // Before any proof the ledger still has one true line: when the open epoch opened.
  const lines: LedgerLine[] = miner.ledger.length
    ? miner.ledger
    : epoch
      ? [
          {
            id: 0,
            kind: 'epoch',
            time: new Date(Number(epoch.openedAt) * 1000).toISOString().slice(11, 19),
            text: epochOpened(epoch.epoch, difficulty(epoch.target)),
          },
        ]
      : [];
  return (
    <Tile className={className}>
      <TileHeader aside="★ win · ✓ minted · ✗ failed · ── epoch">proofs, newest first</TileHeader>
      {lines.length ? (
        <ProofLedger
          lines={shownLines(lines, claims, now, txProver)}
          linkFor={ledgerLinks}
          onAction={() => void controller()?.retryPendingClaim()}
          className="max-h-80 overflow-y-auto"
          data-testid="ledger"
        />
      ) : (
        <p className="text-xs text-ink-2">nothing yet</p>
      )}
      {claims.length > 0 && (
        // The ledger is this session's; the device's wins outlive it, so their count and list live here too.
        <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-line pt-2.5 font-mono text-xs text-ink-3">
          <span data-testid="wins-count">
            {claims.length} {claims.length === 1 ? 'win' : 'wins'} on this device
          </span>
          <Button
            variant="link"
            className="font-mono text-[11px] no-underline"
            onClick={() => setWins(true)}
            data-testid="all-wins"
          >
            all wins <span className="text-ink-4">›</span>
          </Button>
        </div>
      )}
      <WinsDialog wins={claims} open={wins} onOpenChange={setWins} />
    </Tile>
  );
}
