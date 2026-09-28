// One page of history through the real SDK client against a counting JSON-RPC server: the method
// count is the reader's contract (48 × 3 + 3); the HTTP count is what the node's rate limit sees,
// and it is measured here rather than assumed (the client batches concurrent methods).

import { describe, expect, test } from 'bun:test';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { CHUNK, type SlotTable } from '@yacana/miner-core/reader';
import type { Reader } from '../src/chain';
import { readWindowRows } from '../src/read-window';

interface Call {
  jsonrpc: string;
  id: number | string;
  method: string;
}

const ONE = `0x${'0'.repeat(63)}1`;

describe('a page of history on the wire', () => {
  test('147 methods; the HTTP requests carrying them are counted through the SDK client', async () => {
    let http = 0;
    let methods = 0;
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        http++;
        const body = (await req.json()) as Call | Call[];
        const calls = Array.isArray(body) ? body : [body];
        methods += calls.length;
        const out = calls.map((c) => ({
          jsonrpc: '2.0',
          id: c.id,
          result: c.method === 'aztec_getPublicStorageAt' ? ONE : null,
        }));
        return Response.json(Array.isArray(body) ? out : out[0]);
      },
    });
    const url = `http://127.0.0.1:${server.port}`;
    // Another suite in this process may have installed the fetch guard, which has no uninstall.
    const release = (await import('@yacana/web-kit/browser/node-guard')).allowCandidate(url, 60_000);
    try {
      const node = createAztecNodeClient(url);
      const table: SlotTable = {
        first: 0,
        epochs: Array.from({ length: CHUNK }, (_, e) => new Fr(1000 + e)),
        claims: Array.from({ length: CHUNK }, (_, e) => new Fr(5000 + e)),
      };
      const r = {
        node,
        miner: AztecAddress.fromBigIntUnsafe(1n),
        load: async () => table,
      } as unknown as Reader;
      const rows = await readWindowRows(r, 100, 147, 1000);
      expect(rows).toHaveLength(49);
      expect(methods).toBe(48 * 3 + 3);
      expect(http).toBeGreaterThan(0);
      expect(http).toBeLessThanOrEqual(methods);
      console.log(`one page of history: ${methods} methods in ${http} HTTP requests`);
    } finally {
      release();
      server.stop(true);
    }
  });
});
