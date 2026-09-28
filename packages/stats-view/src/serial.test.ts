import { describe, expect, test } from 'vitest';
import { createSerial } from './serial';

const { coalesced, serial } = createSerial();

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('serial', () => {
  test('runs one at a time, in order, and a rejection does not block the next', async () => {
    const log: string[] = [];
    const first = deferred();
    const a = serial(async () => {
      log.push('a');
      await first.promise;
    });
    const b = serial(async () => {
      log.push('b');
      throw new Error('b');
    });
    const c = serial(async () => {
      log.push('c');
    });
    await Promise.resolve();
    expect(log).toEqual(['a']);
    first.resolve();
    await a;
    await expect(b).rejects.toThrow('b');
    await c;
    expect(log).toEqual(['a', 'b', 'c']);
  });
});

describe('coalesced', () => {
  test('calls while one waits its turn join it; calls during the run queue exactly one more', async () => {
    let runs = 0;
    const gate = deferred();
    const blocker = serial(() => gate.promise);
    const poll = coalesced(async () => {
      runs++;
    });
    const p1 = poll();
    const p2 = poll();
    expect(p2).toBe(p1);
    gate.resolve();
    await blocker;
    await p1;
    expect(runs).toBe(1);

    const gate2 = deferred();
    const slow = coalesced(async () => {
      runs++;
      await gate2.promise;
    });
    const s1 = slow();
    await Promise.resolve();
    const s2 = slow();
    const s3 = slow();
    expect(s2).not.toBe(s1);
    expect(s3).toBe(s2);
    gate2.resolve();
    await Promise.all([s1, s2]);
    expect(runs).toBe(3);
  });
});
