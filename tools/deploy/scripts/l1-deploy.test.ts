// A node that prices a contract creation above forge's own EVM, as Sepolia has priced code deposit since its
// 2026-10-06 fork, must get the creation at its own quote: at forge's simulated gas it runs out of gas there.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPublicClient, type Hex, http, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// `l1-deploy.ts` resolves the pinned forge on import, and lanes without the toolchain run this folder's
// tests: they skip; the portal lane sets YACANA_REQUIRE_TOOLCHAIN, and there an absent toolchain fails.
const pin = readFileSync(resolve(import.meta.dir, '../../../.aztecrc'), 'utf8').trim();
const absent =
  !existsSync(join(homedir(), '.aztec', 'versions', pin)) && !process.env.YACANA_REQUIRE_TOOLCHAIN;
const { ANVIL_KEY, deployL1, startAnvil } = absent
  ? ({} as typeof import('./l1-deploy.ts'))
  : await import('./l1-deploy.ts');

/** Sepolia's quote for the portal's creation over forge's simulated gas, 28,088,860 / 3,980,712, rounded up. */
const SEPOLIA_PRICE = 8n;

describe.skipIf(absent)('the creation on a node that prices it above forge', () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>> | undefined;
  let node: ReturnType<typeof Bun.serve> | undefined;
  const quotes: bigint[] = [];

  beforeAll(async () => {
    // Room for the quote below × 1.3 (41.4 M), past anvil's 30 M default.
    const chain = await startAnvil(['--gas-limit', '60000000']);
    anvil = chain;
    node = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { method?: string; params?: [{ to?: Hex | null }] };
        const res = await fetch(chain.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { result?: unknown };
        // A batch has no `method`, so it goes unpriced and the test fails rather than passes.
        if (body.method === 'eth_estimateGas' && !body.params?.[0]?.to && typeof json.result === 'string') {
          const quote = BigInt(json.result) * SEPOLIA_PRICE;
          quotes.push(quote);
          json.result = toHex(quote);
        }
        return Response.json(json);
      },
    });
  }, 90_000);

  afterAll(async () => {
    node?.stop(true);
    await anvil?.stop();
  });

  test("goes out at the node's quote, never at forge's simulation", async () => {
    if (!anvil || !node) throw new Error('the chain did not start');
    const operators = privateKeyToAccount(ANVIL_KEY).address;
    // The constructor only stores the Registry, so any address stands in for one.
    const bridge = await deployL1({
      rpcUrl: `http://127.0.0.1:${node.port}`,
      key: ANVIL_KEY,
      registry: operators,
      operators,
    });
    if (!bridge.deployBlock) throw new Error('the record has no deploy block');
    const chain = createPublicClient({ transport: http(anvil.rpcUrl) });
    const block = await chain.getBlock({
      blockNumber: BigInt(bridge.deployBlock),
      includeTransactions: true,
    });
    const creation = block.transactions.find((tx) => tx.to === null);
    if (!creation) throw new Error(`block ${bridge.deployBlock} holds no creation`);
    const receipt = await chain.getTransactionReceipt({ hash: creation.hash });
    expect(receipt.status).toBe('success');
    expect(receipt.contractAddress?.toLowerCase()).toBe(bridge.portal.toLowerCase());

    expect(quotes.length).toBeGreaterThan(0);
    const quote = quotes.reduce((a, b) => (a > b ? a : b));
    // forge's simulated limit must fall short of the quote, or the test cannot tell the two apart.
    expect((receipt.gasUsed * 13n) / 10n).toBeLessThan(quote);
    expect(creation.gas).toBeGreaterThanOrEqual(quote);
  }, 60_000);
});
