// A continuation's start is read from the source's node through the real SDK client, against a
// JSON-RPC stub serving one source miner's public storage, and must match the operator's own read.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { fixedSlot } from '@yacana/miner-core/reader';
import { deriveSlotTable, loadLayouts } from '@yacana/miner-core/slots';
import { type Announced, announcedFromEnv, continuationOf } from './deploy.ts';

interface Call {
  id: number | string;
  method: string;
  params: unknown[];
}

const OPEN = 7;
const TARGET = 1n << 120n;
const SEED = 0x5eedn;
const truth: Announced = { firstEpoch: BigInt(OPEN + 1), sourceSeed: new Fr(SEED), sourceTarget: TARGET };

let server: ReturnType<typeof Bun.serve>;
let dir: string;
let record: string;
let requests = 0;

beforeAll(async () => {
  const layout = (await loadLayouts()).miner;
  const base = ((await deriveSlotTable(layout, 0)).epochs[OPEN] as Fr).toBigInt();
  const storage = new Map<string, bigint>([
    [fixedSlot(layout, 'open_epoch').toString(), BigInt(OPEN)],
    [new Fr(base).toString(), TARGET],
    [new Fr(base + 1n).toString(), SEED],
    [new Fr(base + 2n).toString(), 1_790_000_000n],
  ]);
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      requests++;
      const body = (await req.json()) as Call | Call[];
      const out = (Array.isArray(body) ? body : [body]).map((c) => ({
        jsonrpc: '2.0',
        id: c.id,
        result:
          c.method === 'aztec_getPublicStorageAt'
            ? new Fr(storage.get(Fr.fromString(String(c.params[2])).toString()) ?? 0n).toString()
            : null,
      }));
      return Response.json(Array.isArray(body) ? out : out[0]);
    },
  });
  dir = mkdtempSync(join(tmpdir(), 'yacana-continuation-'));
  record = join(dir, 'source.json');
  writeFileSync(
    record,
    JSON.stringify({ nodeUrl: `http://127.0.0.1:${server.port}`, miner: new Fr(7n).toString() }),
  );
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe('continuationOf', () => {
  test("the node's start, when the operator's read agrees; node-only reads the same", async () => {
    const before = requests;
    const agreed = await continuationOf(record, truth);
    expect(requests).toBeGreaterThan(before);
    expect(agreed.firstEpoch).toBe(truth.firstEpoch);
    expect(agreed.sourceSeed.toBigInt()).toBe(SEED);
    expect(agreed.sourceTarget).toBe(TARGET);
    expect(agreed.source).toBe(record);
    expect(await continuationOf(record, 'node-only')).toEqual(agreed);
  });

  test.each([
    ['FIRST_EPOCH', { firstEpoch: truth.firstEpoch - 1n }],
    ['SEED', { sourceSeed: new Fr(SEED + 1n) }],
    ['TARGET', { sourceTarget: TARGET * 4n }],
  ] as const)('refuses a %s the node does not confirm', async (field, wrong) => {
    const refused = continuationOf(record, { ...truth, ...wrong });
    await expect(refused).rejects.toThrow(new RegExp(`disagree: ${field} node`));
  });
});

describe('announcedFromEnv', () => {
  const env = {
    YACANA_CONTINUE_FIRST_EPOCH: '8',
    YACANA_CONTINUE_SEED: '0x5eed',
    YACANA_CONTINUE_TARGET: TARGET.toString(),
  };

  test('reads the three keys', () => {
    const a = announcedFromEnv(env);
    expect([a.firstEpoch, a.sourceSeed.toBigInt(), a.sourceTarget]).toEqual([8n, SEED, TARGET]);
  });

  test('refuses a read missing its target', () => {
    expect(() => announcedFromEnv({ ...env, YACANA_CONTINUE_TARGET: undefined })).toThrow(/needs/);
  });
});
