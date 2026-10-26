import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Two interceptors and a shim sit in front of everything the SDK does in a context, and only their
// order makes them work: the Worker's globals shim before any SDK import; the fetch guard before
// the CRS interceptor (whose fall-through it is) and both before any SDK import.
const entries = ['src/main.tsx', 'src/prover.worker.ts'];

const importOrder = (file: string): string[] =>
  // A string path, not a URL object: jsdom's URL is not the one node:url expects.
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8')
    .split('\n')
    .map((l) => /^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/.exec(l)?.[1])
    .filter((s): s is string => s !== undefined);

const indexOf = (order: string[], pattern: RegExp): number => order.findIndex((s) => pattern.test(s));

describe('import order of the prover contexts', () => {
  for (const file of entries) {
    test(`${file}: the shim first, then the guard, then pinned-crs, then the SDK`, () => {
      const order = importOrder(file);
      const guard = indexOf(order, /node-guard/);
      const crs = indexOf(order, /pinned-crs/);
      const sdk = indexOf(order, /^@aztec-(labs|foundation)\//);
      const shim = indexOf(order, /shims\/node-globals/);
      expect(guard, `${file} imports the guard`).toBeGreaterThanOrEqual(0);
      expect(crs, `${file} imports pinned-crs`).toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(crs);
      if (sdk >= 0) expect(crs).toBeLessThan(sdk);
      if (shim >= 0) {
        expect(shim).toBeLessThan(guard);
        if (sdk >= 0) expect(shim).toBeLessThan(sdk);
      }
    });
  }
});
