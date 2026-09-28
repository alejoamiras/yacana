import { closePreview, difficulty, escapeHatchIn, proofsPerMinute } from '@yacana/miner-core/metrics';
import { cn, difficultyLabel, EpochRail, PowerSlider, PrestoCard, Tile, TileHeader, Tip } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import type { MinerController } from '../controller';
import { duration } from '../lib/format';
import { epochTips, nextDifficulty } from '../lib/words';
import { PRESTO_SITE } from '../presto';
import { useSettings } from '../settings';
import { bootAtom, claimsAtom, epochAtom, minerAtom, nowAtom, rulesAtom } from '../state';
import type { PrestoView } from './use-presto';

const cores = () => navigator.hardwareConcurrency || 2;

export function RailTile({
  controller,
  presto,
  className,
}: {
  controller: () => MinerController | undefined;
  presto: PrestoView;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-[14px]', className)} data-testid="rail">
      <EpochTile controller={controller} presto={presto} />
    </div>
  );
}

/**
 * Under the epoch rail: the slider, and Presto's card where this build looks for it. While Presto
 * decides (found, remembered, proving) the card stands alone; in every other standing the slider
 * governs and the card is the offer, the look, or the fix.
 */
function PowerAndPresto({
  controller,
  presto,
}: {
  controller: () => MinerController | undefined;
  presto: PrestoView;
}) {
  return (
    <>
      {(!presto.configured || !presto.decides) && <PowerRow controller={controller} />}
      {presto.configured && (
        <PrestoCard
          standing={presto.standing}
          needsLook={presto.needsLook}
          onLook={presto.look}
          onUseBrowser={presto.chooseBrowser}
          site={PRESTO_SITE}
        />
      )}
    </>
  );
}

/** The slider and its line; a change is stored and applied at the next browser build (`reconfigure`). */
function PowerRow({ controller }: { controller: () => MinerController | undefined }) {
  const miner = useAtomValue(minerAtom);
  const boot = useAtomValue(bootAtom);
  const [settings, setSettings] = useSettings();
  const threads = settings.threads ?? Math.max(1, cores() - 1);
  const setThreads = (t: number) => {
    setSettings({ threads: t });
    controller()?.reconfigure(t);
  };
  return (
    <>
      <PowerSlider
        cores={cores()}
        threads={threads}
        onChange={setThreads}
        readout={
          miner.phase === 'mining' ? `${proofsPerMinute(miner.recent).toFixed(1)} proofs/min` : undefined
        }
      />
      <p className="text-xs text-ink-2" data-testid="power-caption">
        {cores()} cores, one stays with the page. A change applies at the next proof; the rate readout follows
        within a minute.{boot.phase === 'ready' ? ` Prover started with ${boot.threads} threads.` : ''}
      </p>
    </>
  );
}

function EpochTile({
  controller,
  presto,
}: {
  controller: () => MinerController | undefined;
  presto: PrestoView;
}) {
  const epoch = useAtomValue(epochAtom);
  const rules = useAtomValue(rulesAtom);
  const now = useAtomValue(nowAtom);
  const claims = useAtomValue(claimsAtom);
  const [closing, setClosing] = useState(false);
  const nowSec = BigInt(Math.floor(now / 1000));
  const hatch = epoch && rules ? escapeHatchIn(epoch.openedAt, rules.T_MAX, nowSec) : 0n;
  const d = epoch ? difficulty(epoch.target) : null;
  const tips = rules ? epochTips(rules, d) : null;
  return (
    <Tile className="flex flex-col gap-5">
      {epoch && rules ? (
        <EpochRail
          epoch={Number(epoch.epoch)}
          claims={epoch.claims}
          n={rules.N}
          mine={claims.filter((c) => c.epoch === epoch.epoch).map((_, i) => i)}
          aside={`opened ${new Date(Number(epoch.openedAt) * 1000).toISOString().slice(11, 19)}`}
          epochTip={tips?.epoch}
          hatchSeconds={Number(hatch)}
          closing={closing}
          onClose={() => {
            setClosing(true);
            void controller()
              ?.roll()
              .finally(() => setClosing(false));
          }}
          rows={[
            {
              label: <Tip tip={tips?.wins}>wins this epoch</Tip>,
              value: (
                <span data-testid="epoch-claims">
                  {epoch.claims} of {rules.N}
                </span>
              ),
            },
            {
              label: <Tip tip={tips?.difficulty}>difficulty</Tip>,
              value: difficultyLabel(difficulty(epoch.target)),
            },
            { label: 'open for', value: duration(Math.max(0, Number(nowSec - epoch.openedAt))) },
            {
              label: <Tip tip={tips?.expected}>expected epoch time</Tip>,
              value: duration(Number(rules.EXPECTED_EPOCH_SECONDS)),
            },
            {
              label: <Tip tip={tips?.next}>next difficulty, if closed now</Tip>,
              value: nextDifficulty(
                difficulty(epoch.target),
                closePreview(epoch.target, nowSec - epoch.openedAt, rules),
              ),
            },
            {
              label: <Tip tip={tips?.reset}>reset if stuck</Tip>,
              value: hatch > 0n ? `in ${duration(Number(hatch))}` : 'now',
            },
          ]}
        />
      ) : (
        <TileHeader>epoch</TileHeader>
      )}
      <span className="sr-only" data-testid="epoch">
        {epoch?.epoch.toString() ?? ''}
      </span>
      <PowerAndPresto controller={controller} presto={presto} />
    </Tile>
  );
}
