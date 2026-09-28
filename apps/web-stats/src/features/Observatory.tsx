import { PARAMS } from '@yacana/miner-core/generated/params';
import {
  claimsPerHour,
  difficulty,
  escapeHatchIn,
  networkRate,
  scheduledClaimsPerHour,
} from '@yacana/miner-core/metrics';
import type { EpochRow } from '@yacana/miner-core/reader';
import { Button, difficultyLabel, Kpi, Tile, TileBoundary } from '@yacana/ui';
import { amount, clockMinutes } from '@yacana/web-kit/browser/format';
import { useState } from 'react';
import type { Fixed } from '../state';
import { Calculator } from './Calculator';
import { EpochRing } from './EpochRing';
import { SinceOpened } from './SinceOpened';
import { SK_SUB, SK_VALUE, Sk } from './Sk';
import { Tweened } from './Tweened';

const RULES = { N: PARAMS.N, EXPECTED_EPOCH_SECONDS: PARAMS.EXPECTED_EPOCH_SECONDS, T_MAX: PARAMS.T_MAX };
const CELL = 'md:col-span-2 xl:col-span-1';
const EXPECTED = Number(PARAMS.EXPECTED_EPOCH_SECONDS);

type Rows = readonly EpochRow[] | null;
const openRow = (rows: Rows, open: number | null) => rows?.find((r) => r.epoch === open);

/** Minted (beat one): the supply, gliding from 0 the first time it lands. */
function MintedTile({ fixed }: { fixed: Fixed | null }) {
  const unit = Number(PARAMS.REWARD / 10n ** BigInt(PARAMS.DECIMALS));
  return (
    <Kpi
      label="minted"
      value={
        <span data-testid="minted">
          <Tweened id="minted" value={fixed ? Number(amount(fixed.supply, PARAMS.DECIMALS, 0)) : null} />
        </span>
      }
      unit={PARAMS.TOKEN_SYMBOL}
      sub={
        fixed ? (
          `${amount(fixed.supply / PARAMS.REWARD, 0)} wins × ${unit} · no premine`
        ) : (
          <Sk className={SK_SUB} />
        )
      }
    />
  );
}

/** The open epoch's tile: its number at beat one, the ring and the counter at beat two, or the honest placeholder. */
function OpenEpoch({ open, rows, nowSec }: { open: number | null; rows: Rows; nowSec: number }) {
  const label = open === null ? 'epoch' : `epoch ${open}`;
  const row = openRow(rows, open);
  if (rows === null)
    return <Kpi label={label} value={<Sk className={SK_VALUE} />} sub={<Sk className={SK_SUB} />} />;
  if (!row)
    return (
      <Kpi
        label={label}
        value={<span data-testid="open-claims">—</span>}
        unit={`of ${PARAMS.N} wins`}
        sub={rows.length ? 'this epoch not read yet' : 'history unavailable'}
      />
    );
  const elapsed = Math.max(0, nowSec - row.openedAt);
  const hatch = Number(escapeHatchIn(BigInt(row.openedAt), PARAMS.T_MAX, BigInt(nowSec)));
  return (
    <Kpi
      label={label}
      value={<span data-testid="open-claims">{row.claims}</span>}
      unit={`of ${PARAMS.N} wins`}
      sub={
        <span className="inline-flex items-center gap-1.5">
          <EpochRing elapsed={elapsed} expected={EXPECTED} hatch={hatch} />
          <span data-testid="open-for">
            open {clockMinutes(elapsed)} · expected {clockMinutes(EXPECTED)}
          </span>
        </span>
      }
    />
  );
}

function DifficultyTile({ open, rows }: { open: number | null; rows: Rows }) {
  if (rows === null)
    return <Kpi label="difficulty" value={<Sk className={SK_VALUE} />} sub={<Sk className={SK_SUB} />} />;
  const row = openRow(rows, open);
  const lastClosed = open === null ? undefined : rows.find((r) => r.epoch === open - 1);
  return (
    <Kpi
      label="difficulty"
      value={<span data-testid="difficulty">{row ? difficultyLabel(difficulty(row.target)) : '—'}</span>}
      sub={
        lastClosed?.retarget ? `×${(1 / lastClosed.retarget).toFixed(2)} at the last close` : 'no close yet'
      }
    />
  );
}

function ClaimsPerHour({ rows, nowSec }: { rows: Rows; nowSec: number }) {
  return (
    <Kpi
      label="wins / hour"
      value={
        <span data-testid="claims-per-hour">
          <Tweened id="claims-per-hour" value={rows ? claimsPerHour(rows, nowSec) : null} />
        </span>
      }
      unit={`of ${scheduledClaimsPerHour(RULES)}`}
      sub={rows ? 'an estimate from epoch counts' : <Sk className={SK_SUB} />}
    />
  );
}

function NetworkTile({ open, rows }: { open: number | null; rows: Rows }) {
  const [calc, setCalc] = useState(false);
  const rate = rows ? networkRate(rows, PARAMS.N) : null;
  const row = openRow(rows, open);
  return (
    <>
      <Kpi
        label="network"
        value={
          rows === null ? (
            <Sk className={SK_VALUE} />
          ) : (
            <span data-testid="network-rate">{rate === null ? '—' : `≈ ${rate.toFixed(2)}`}</span>
          )
        }
        unit="proofs/s"
        sub={rows === null ? <Sk className={SK_SUB} /> : rate === null ? 'no closed epoch yet' : undefined}
      />
      <Button
        size="sm"
        variant="link"
        className="mt-1 h-auto px-0 text-xs"
        disabled={rate === null || !row}
        onClick={() => setCalc(true)}
        data-testid="calculator"
      >
        what would my rate earn?
      </Button>
      {rate !== null && row && (
        <Calculator open={calc} onOpenChange={setCalc} network={rate} target={row.target} />
      )}
    </>
  );
}

/** Six KPI tiles, placed by the page's grid (`contents`), each behind its own boundary; each fills at its own beat. */
export function Observatory({ fixed, rows, now }: { fixed: Fixed | null; rows: Rows; now: number }) {
  const nowSec = Math.max(fixed?.block.timestamp ?? 0, Math.floor(now / 1000));
  const open = fixed?.open ?? null;
  return (
    <div className="contents" data-testid="observatory">
      <TileBoundary name="kpi-minted" className={CELL}>
        <Tile className={CELL}>
          <MintedTile fixed={fixed} />
        </Tile>
      </TileBoundary>
      <TileBoundary name="kpi-open-epoch" className={CELL}>
        <Tile className={CELL}>
          <OpenEpoch open={open} rows={rows} nowSec={nowSec} />
        </Tile>
      </TileBoundary>
      <TileBoundary name="kpi-difficulty" className={CELL}>
        <Tile className={CELL}>
          <DifficultyTile open={open} rows={rows} />
        </Tile>
      </TileBoundary>
      <TileBoundary name="kpi-claims-per-hour" className={CELL}>
        <Tile className={CELL}>
          <ClaimsPerHour rows={rows} nowSec={nowSec} />
        </Tile>
      </TileBoundary>
      <TileBoundary name="kpi-network" className={CELL}>
        <Tile className={CELL}>
          <NetworkTile open={open} rows={rows} />
        </Tile>
      </TileBoundary>
      <TileBoundary name="kpi-since-opened" className={CELL}>
        <Tile className={CELL}>
          <SinceOpened supply={fixed?.supply ?? null} now={now} />
        </Tile>
      </TileBoundary>
    </div>
  );
}
