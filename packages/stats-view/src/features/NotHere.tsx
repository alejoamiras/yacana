import { cn, Tile, TileHeader } from '@yacana/ui';

export function NotHere({ className }: { className?: string }) {
  return (
    <Tile className={cn('border-uv/50', className)} data-testid="not-here">
      <TileHeader className="text-uv-2">what is not here, because the chain does not have it</TileHeader>
      <p className="text-pretty text-xs text-ink-3">
        How many miners there are. How fast any of them is. Which account claimed which epoch. What an account
        holds in private notes. The chain records a nullifier, a note hash and a counter per claim (an
        account's first claim also carries Aztec's delivery handshake, which someone who already knows that
        address can match), and the sponsor paid the fee; a public send shows its amount and address by
        choice. A site that shows a miner count or a leaderboard is guessing.
      </p>
    </Tile>
  );
}
