import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INVENTORY, MOVED_TO_REPLAY, REPLAYED, RIG_ONLY, SPEC_FILES } from '../e2e/proof-inventory.ts';

const e2e = resolve(import.meta.dir, '../e2e');
const allOnDisk = readdirSync(e2e)
  .filter((f) => f.endsWith('.e2e.ts'))
  .sort();
/** The sharded specs: everything on disk the rig does not own. */
const onDisk = allOnDisk.filter((f) => !(f in RIG_ONLY));
const source = (f: string) => readFileSync(resolve(e2e, f), 'utf8');

/** Top-level `test('…'` titles in a spec, the way Playwright will report them. */
const titlesIn = (f: string): string[] =>
  [...source(f).matchAll(/^test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)].map((m) => m[2] as string);

describe('the shard lists and the inventory follow the spec files', () => {
  const shards = JSON.parse(readFileSync(resolve(e2e, 'shards.json'), 'utf8')) as Record<string, string[]>;

  test('every spec file is in exactly one shard, and no shard names a file that is not there', () => {
    const listed = Object.values(shards).flat();
    expect([...listed].sort()).toEqual(onDisk);
    expect(new Set(listed).size).toBe(listed.length);
    for (const files of Object.values(shards)) expect(files.length).toBeGreaterThan(0);
  });

  test('the canary shard, the one CI runs with the real prover, holds the canary and the transfers', () => {
    expect(shards.canary).toEqual(expect.arrayContaining(['canary.e2e.ts', 'withdraw.e2e.ts']));
  });

  test('the inventory names every spec file and exactly the titles its source declares', () => {
    expect([...SPEC_FILES].sort()).toEqual(onDisk);
    for (const f of onDisk) expect(Object.keys(INVENTORY[f] ?? {}).sort(), f).toEqual(titlesIn(f).sort());
  });

  test('the rig-only specs exist, declare their titles, and sit in no shard', () => {
    for (const f of Object.keys(RIG_ONLY)) {
      expect(allOnDisk, f).toContain(f);
      expect(Object.keys(RIG_ONLY[f] ?? {}).sort(), f).toEqual(titlesIn(f).sort());
      expect(Object.values(shards).flat(), f).not.toContain(f);
    }
  });

  test('titles are unique across files: the coverage check and the floors key on them', () => {
    const titles = [...Object.values(INVENTORY), ...Object.values(RIG_ONLY)].flatMap((t) => Object.keys(t));
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('no spec is narrowed with .only', () => {
    for (const f of [...allOnDisk, ...replayOnDisk.map((f) => `replay/${f}`)])
      expect(source(f), f).not.toMatch(/\b(test|describe)\.only\(/);
  });
});

const replayOnDisk = readdirSync(resolve(e2e, 'replay'))
  .filter((f) => f.endsWith('.replay.ts'))
  .sort();

describe('the replay lane took exactly the tests it was given', () => {
  test('its files and titles are the declared ones', () => {
    expect(Object.keys(REPLAYED).sort()).toEqual(replayOnDisk);
    for (const f of replayOnDisk)
      expect([...(REPLAYED[f] ?? [])].sort(), f).toEqual(titlesIn(`replay/${f}`).sort());
  });

  test('the sharded suite plus the moved tests are the original nineteen, the moved ones by name', () => {
    const sharded = Object.values(INVENTORY).flatMap((t) => Object.keys(t));
    const replayed = Object.values(REPLAYED).flat();
    for (const title of MOVED_TO_REPLAY) {
      expect(sharded, title).not.toContain(title);
      expect(replayed, title).toContain(title);
    }
    // Every original test is somewhere, exactly once; the canary, the bridge shard's test, the node's
    // behind case, the refused node, Presto cut mid-proof, the three consent titles and the three claim
    // recoveries are the additions.
    expect(sharded.length + MOVED_TO_REPLAY.length).toBe(19 + 1 + 1 + 2 + 1 + 3 + 3);
    expect(new Set([...sharded, ...replayed]).size).toBe(sharded.length + replayed.length);
  });
});
