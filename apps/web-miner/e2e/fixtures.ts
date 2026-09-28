// The specs' `test`: Playwright's, with the page metered — the prover's proof events and every
// `aztec_sendTx` — and the meter attached to the result and held to the inventory on a pass.
// E2E_DELAY_SENDTX_MS holds every submission that long first: proving must not move with it.
import { test as base, type ConsoleMessage, type Page, type Request } from '@playwright/test';
import { type ProofEvent, type ProofMeter, proofShortfall } from './proof-inventory.ts';

const PROOF_EVENT = 'client-ivc-proof-generation';

/**
 * The page's pino logs `console.info(bindings, data, message)`: the event's fields are in the data
 * object, so every object argument is read until one names the event.
 */
const eventOf = (value: object): Omit<ProofEvent, 'at'> | null => {
  const { eventName, duration, prover, phases } = value as {
    eventName?: unknown;
    duration?: unknown;
    prover?: unknown;
    phases?: unknown;
  };
  if (eventName !== PROOF_EVENT) return null;
  return {
    durationMs: typeof duration === 'number' ? duration : Number.NaN,
    prover: typeof prover === 'string' ? prover : undefined,
    phases: typeof phases === 'object' && phases !== null ? (phases as Record<string, number>) : undefined,
  };
};

async function proofEvent(msg: ConsoleMessage): Promise<Omit<ProofEvent, 'at'> | null> {
  if (msg.type() !== 'info') return null;
  for (const arg of msg.args()) {
    let value: unknown;
    try {
      value = await arg.jsonValue();
    } catch {
      return null; // the page went away under the handle
    }
    if (typeof value !== 'object' || value === null) continue;
    const event = eventOf(value);
    if (event) return event;
  }
  return null;
}

const isSendTx = (req: Request) => req.method() === 'POST' && (req.postData() ?? '').includes('aztec_sendTx');

function meterPage(page: Page, meter: ProofMeter): { settled: () => Promise<unknown> } {
  const pending: Promise<void>[] = [];
  page.on('console', (msg) => {
    pending.push(
      proofEvent(msg).then((event) => {
        if (event !== null) meter.proofs.push({ ...event, at: Date.now() });
      }),
    );
  });
  const open = new Map<Request, number>();
  page.on('request', (req) => {
    if (isSendTx(req)) open.set(req, Date.now());
  });
  const done = (req: Request) => {
    const startedAt = open.get(req);
    if (startedAt === undefined) return;
    open.delete(req);
    meter.sends.push({ startedAt, endedAt: Date.now() });
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { settled: () => Promise.allSettled(pending) };
}

export const test = base.extend<{ proofMeter: ProofMeter }>({
  proofMeter: [
    async ({ page }, use, testInfo) => {
      const meter: ProofMeter = { proofs: [], sends: [] };
      const { settled } = meterPage(page, meter);
      const delayMs = Number(process.env.E2E_DELAY_SENDTX_MS ?? 0);
      if (delayMs > 0) {
        // The node and the proxies answer on 127.0.0.1; the page itself is served from localhost.
        await page.route(
          (url) => url.hostname === '127.0.0.1',
          async (route) => {
            if (isSendTx(route.request())) await new Promise((r) => setTimeout(r, delayMs));
            await route.fallback();
          },
        );
      }
      await use(meter);
      await settled();
      await testInfo.attach('proofs.json', { body: JSON.stringify(meter), contentType: 'application/json' });
      // A failed or skipped test reports its own reason; the inventory judges the ones that passed.
      if (testInfo.status !== 'passed') return;
      const shortfall = proofShortfall(testInfo.title, meter, process.env.E2E_PROVERLESS === '1');
      if (shortfall) throw new Error(shortfall);
    },
    { auto: true },
  ],
});

/** One call of a JSON-RPC batch the page sent, and the answer to it. */
interface RpcCall {
  id: number;
  method: string;
  params: unknown[];
}
interface RpcAnswer {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const callsIn = (body: string | null): RpcCall[] => {
  try {
    const parsed = JSON.parse(body ?? '') as unknown;
    return Array.isArray(parsed) ? (parsed as RpcCall[]) : [];
  } catch {
    return [];
  }
};

/**
 * The node's answer to the first call `pick` selects, rewritten on the wire, once: the page's client
 * batches its calls, so the batch reaches the node as sent and only that call's answer changes.
 */
export async function faultOnce(
  page: Page,
  pick: (call: RpcCall) => boolean,
  rewrite: (answer: RpcAnswer, call: RpcCall) => RpcAnswer,
): Promise<{ fired: () => number }> {
  let fired = 0;
  await page.route(
    (url) => url.hostname === '127.0.0.1',
    async (route) => {
      const calls = callsIn(route.request().postData());
      const i = fired ? -1 : calls.findIndex(pick);
      if (i < 0) return route.fallback();
      fired++;
      const response = await route.fetch();
      const answers = (await response.json()) as RpcAnswer[];
      answers[i] = rewrite(answers[i] as RpcAnswer, calls[i] as RpcCall);
      await route.fulfill({ response, json: answers });
    },
  );
  return { fired: () => fired };
}

/**
 * The first public-data read pinned to a block hash — the claim's, against its anchor — answered as a
 * node that pruned that block answers it (`node_world_state_queries.js` of the pinned node).
 */
export const pruneAnchorOnce = (page: Page) =>
  faultOnce(
    page,
    (c) =>
      c.method === 'aztec_getPublicDataWitness' &&
      typeof c.params[0] === 'string' &&
      /^0x[0-9a-f]{64}$/i.test(c.params[0]),
    (a, c) => ({
      jsonrpc: '2.0',
      id: a.id,
      error: {
        code: -32000,
        message: `Block hash ${String(c.params[0])} not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred.`,
      },
    }),
  );

export { expect, type Page } from '@playwright/test';
