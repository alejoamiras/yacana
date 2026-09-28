import { describe, expect, test } from 'bun:test';
import { EXPECTED_PROOFS, type ProofMeter, proofShortfall } from '../e2e/proof-inventory.ts';
import {
  breakdown,
  coverageGap,
  executedTitles,
  type JsonReport,
  type SpecRow,
  shardJobMinutes,
  specRows,
} from '../e2e/report.ts';

const meter = (m: ProofMeter) => Buffer.from(JSON.stringify(m)).toString('base64');
const spec = (file: string, title: string, duration: number, m?: ProofMeter) => ({
  title,
  file,
  tests: [
    {
      results: [
        {
          status: 'passed',
          duration,
          attachments: m ? [{ name: 'proofs.json', body: meter(m) }] : [],
        },
      ],
    },
  ],
});

describe('the proof inventory', () => {
  const none: ProofMeter = { proofs: [], sends: [] };
  const one: ProofMeter = {
    proofs: [{ durationMs: 41_000, at: 1 }],
    sends: [{ startedAt: 1, endedAt: 900 }],
  };

  test('a title outside the inventory fails, a shortfall fails, a malformed event fails', () => {
    expect(proofShortfall('a test nobody listed', none)).toMatch(/not in the proof inventory/);
    expect(proofShortfall('a poisoned CRS cache is purged before proving', none)).toMatch(
      /0 browser proof event/,
    );
    expect(
      proofShortfall('a poisoned CRS cache is purged before proving', {
        proofs: [{ durationMs: Number.NaN, at: 1 }],
        sends: [],
      }),
    ).toMatch(/without a positive duration/);
  });

  test('what is expected passes, more than expected passes, and a zero entry passes on nothing', () => {
    expect(proofShortfall('a poisoned CRS cache is purged before proving', one)).toBeNull();
    expect(
      proofShortfall('a prover crash surfaces as an error and mining restarts on the next start', {
        proofs: [
          one.proofs[0] as ProofMeter['proofs'][number],
          one.proofs[0] as ProofMeter['proofs'][number],
        ],
        sends: [],
      }),
    ).toBeNull();
    expect(
      proofShortfall('a prover crash surfaces as an error and mining restarts on the next start', none),
    ).toBeNull();
    expect(Object.values(EXPECTED_PROOFS).filter((n) => n > 0).length).toBeGreaterThanOrEqual(6);
  });
});

describe('the proof inventory under a proverless build', () => {
  const one: ProofMeter = { proofs: [{ durationMs: 20_000, at: 1 }], sends: [] };
  test('no events pass despite a floor; any event fails, malformed included; an unknown title still fails', () => {
    const claimTitle = 'a poisoned CRS cache is purged before proving';
    expect(proofShortfall(claimTitle, { proofs: [], sends: [] }, true)).toBeNull();
    expect(proofShortfall(claimTitle, one, true)).toMatch(/from a build that was to skip proving/);
    expect(
      proofShortfall(claimTitle, { proofs: [{ durationMs: Number.NaN, at: 1 }], sends: [] }, true),
    ).toMatch(/from a build that was to skip proving/);
    expect(proofShortfall('a test nobody listed', { proofs: [], sends: [] }, true)).toMatch(
      /not in the proof inventory/,
    );
  });
});

describe('the breakdown', () => {
  test('sums proving per spec from the attached meters and reconciles the clocks', () => {
    const report: JsonReport = {
      stats: { startTime: '2026-09-10T00:00:00Z', duration: 100_000 },
      suites: [
        {
          suites: [
            {
              specs: [
                spec('miner.e2e.ts', 'first', 60_000, {
                  proofs: [
                    { durationMs: 20_000, at: 1 },
                    { durationMs: 10_000, at: 2 },
                    { durationMs: Number.NaN, at: 3 },
                  ],
                  sends: [
                    { startedAt: 0, endedAt: 500 },
                    { startedAt: 0, endedAt: 700 },
                  ],
                }),
                spec('words.e2e.ts', 'second', 30_000),
              ],
            },
          ],
        },
      ],
    };
    const b = breakdown(
      report,
      { steps: [{ name: 'deploy', ms: 20_000 }] },
      { outerMs: 200_000, nodeReadyMs: 30_000, prebuildMs: 5_000, playwrightMs: 150_000 },
    );
    expect(b.specs.map((r) => [r.proofs, r.provingMs, r.submissionMs])).toEqual([
      [2, 30_000, 1_200],
      [0, 0, 0],
    ]);
    expect(b.testsMs).toBe(90_000);
    expect(b.provingMs).toBe(30_000);
    expect(b.provingShareOfTests).toBeCloseTo(1 / 3);
    expect(b.provingShareOfRun).toBeCloseTo(0.15);
    expect(b.playwrightOverheadMs).toBe(150_000 - 20_000 - 90_000);
    expect(b.unattributedMs).toBe(200_000 - 30_000 - 5_000 - 150_000);
  });

  test('a skipped or never-run test is not executed; the gap names both directions', () => {
    const row = (title: string, status: string): SpecRow => ({
      file: 'x.e2e.ts',
      title,
      status,
      ms: 0,
      proofs: 0,
      prestoProofs: 0,
      prestoMs: 0,
      provingMs: 0,
      submissionMs: 0,
    });
    const executed = executedTitles([
      row('a', 'passed'),
      row('b', 'failed'),
      row('c', 'skipped'),
      row('d', 'missing'),
      row('e', 'timedOut'),
    ]);
    expect(executed).toEqual(['a', 'b', 'e']);
    expect(coverageGap(executed, ['a', 'b', 'c', 'd'])).toEqual({ missing: ['c', 'd'], unexpected: ['e'] });
    expect(coverageGap(['a'], ['a'])).toEqual({ missing: [], unexpected: [] });
  });

  test('a retried spec charges every attempt to the run and keeps the last verdict', () => {
    const attempt = (status: string, duration: number, m: ProofMeter) => ({
      status,
      duration,
      attachments: [{ name: 'proofs.json', body: meter(m) }],
    });
    const failed = attempt('failed', 20_000, { proofs: [{ durationMs: 9_000, at: 1 }], sends: [] });
    const passed = attempt('passed', 10_000, { proofs: [{ durationMs: 8_000, at: 2 }], sends: [] });
    const [row] = specRows({
      stats: { startTime: '', duration: 0 },
      suites: [{ specs: [{ title: 't', file: 'x.e2e.ts', tests: [{ results: [failed, passed] }] }] }],
    });
    expect(row).toMatchObject({ status: 'passed', ms: 30_000, proofs: 2, provingMs: 17_000 });
  });

  test('shard job minutes count only the named, completed shard jobs', () => {
    const jobs = [
      {
        name: 'web-miner · cockpit',
        status: 'completed',
        startedAt: '2026-09-10T19:04:30Z',
        completedAt: '2026-09-10T19:17:40Z',
      },
      {
        name: 'web-miner · chain',
        status: 'in_progress',
        startedAt: '2026-09-10T19:04:31Z',
        completedAt: '0001-01-01T00:00:00Z',
      },
      {
        name: 'web-miner · the whole suite',
        status: 'in_progress',
        startedAt: '2026-09-10T19:19:16Z',
        completedAt: '0001-01-01T00:00:00Z',
      },
      {
        name: 'web-stats on an isolated network',
        status: 'completed',
        startedAt: '2026-09-10T19:04:23Z',
        completedAt: '2026-09-10T19:10:01Z',
      },
    ];
    expect(shardJobMinutes(jobs, ['cockpit', 'chain'])).toEqual([{ name: 'cockpit', minutes: 13 + 10 / 60 }]);
  });

  test('outside the isolated runner the outer clock is unknown, not zero', () => {
    const b = breakdown({ stats: { startTime: '', duration: 0 }, suites: [] }, null, {
      outerMs: null,
      nodeReadyMs: null,
      prebuildMs: 1,
      playwrightMs: 2,
    });
    expect(b.unattributedMs).toBeNull();
    expect(b.provingShareOfRun).toBeNull();
  });
});
