import { PARAMS } from '@yacana/miner-core/generated/params';
import { Button, ExternalLink, Kpi, Skeleton, Tile, TileHeader, Tip, useTweenedNumber } from '@yacana/ui';
import { useAtomValue, useSetAtom } from 'jotai';
import { links } from '../explorer';
import { amount, shortAddress } from '../lib/format';
import { MINTED_FRESH_MS } from '../lib/reducer';
import { navigate } from '../routes';
import { balanceAtom, bootAtom, claimsAtom, nowAtom, signInAtom } from '../state';

/** The header's word on both balance tiles, saying what it promises. */
export function PrivateTip() {
  return (
    <Tip tip="Nothing about this balance is public: the chain holds encrypted notes that only this account can read.">
      private
    </Tip>
  );
}

/**
 * Under the number, reserved whether or not a mint is fresh: the tile never changes height for it.
 * Read off the device's last recorded win, not the miner's `minted`: the next claim clears that one
 * (the pill's ✓ must go), and a visit to the Wallet must not end the ten seconds either.
 */
function MintLine() {
  const claims = useAtomValue(claimsAtom);
  const now = useAtomValue(nowAtom);
  const last = claims[claims.length - 1];
  const fresh = last !== undefined && now - last.at < MINTED_FRESH_MS;
  return (
    <span className="block min-h-[1.4em] font-mono text-[11.5px] text-ok" data-testid="mint-line">
      {fresh ? `+${amount(PARAMS.REWARD, PARAMS.DECIMALS)} ${PARAMS.TOKEN_SYMBOL} · just now` : ''}
    </span>
  );
}

/** The amount, "private", Send and Wallet →; signed out, the way in. */
export function BalanceCard({ className }: { className?: string }) {
  const boot = useAtomValue(bootAtom);
  const balance = useAtomValue(balanceAtom);
  const claims = useAtomValue(claimsAtom);
  const ready = boot.phase === 'ready';
  const opening = boot.phase === 'opening';
  const openSignIn = useSetAtom(signInAtom);
  // The tween is display only; anything that sends reads the store's bigint.
  const shown = useTweenedNumber(balance === null ? 0 : Number(amount(balance, PARAMS.DECIMALS, 2)));
  return (
    <Tile className={className}>
      <TileHeader aside={<PrivateTip />}>balance</TileHeader>
      <div className="flex flex-col gap-3">
        {opening ? (
          // The account is coming up: the shape of the balance and its line, not a number.
          <div className="flex flex-col gap-2" data-testid="balance-skeleton">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-2.5 w-[180px]" />
          </div>
        ) : (
          <Kpi
            size="lg"
            label={<span className="sr-only">private balance</span>}
            value={
              <span
                data-testid="balance"
                data-exact={balance === null ? undefined : amount(balance, PARAMS.DECIMALS)}
              >
                {!ready ? '—' : balance === null ? '…' : shown.toFixed(2).replace(/\.?0+$/, '')}
              </span>
            }
            unit={PARAMS.TOKEN_SYMBOL}
            sub={<MintLine />}
          />
        )}
        {!ready && <p className="text-xs text-ink-2">Your balance shows once you log in.</p>}
        <div className={opening ? 'flex gap-2 opacity-50' : 'flex gap-2'}>
          {ready ? (
            <Button variant="primary" size="sm" onClick={() => navigate('wallet', 'send')} data-testid="send">
              Send
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={opening}
              onClick={() => openSignIn(true)}
              data-testid="sign-in-balance"
            >
              Log in
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!ready} onClick={() => navigate('wallet')}>
            Wallet →
          </Button>
        </div>
        {ready && (
          // For assistive tech and the specs: the account this balance belongs to and this device's wins.
          <p className="sr-only">
            account{' '}
            <ExternalLink
              href={links.address(boot.account)}
              full={boot.account}
              tabIndex={-1}
              data-testid="account"
            >
              {shortAddress(boot.account)}
            </ExternalLink>{' '}
            · <span data-testid="claims">{claims.length}</span> {claims.length === 1 ? 'win' : 'wins'} from
            this device
          </p>
        )}
      </div>
    </Tile>
  );
}
