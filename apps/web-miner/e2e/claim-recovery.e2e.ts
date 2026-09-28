// A claim that did not land recovers by itself. One answer of the node is rewritten on the wire, once:
// the read pinned to the claim's anchor answers as a node that pruned that block, or the claim's
// receipt comes back without its effects, as it does when its block is pruned between two reads.
// Everything after is the page's own doing against the real node.
import { expect, faultOnce, pruneAnchorOnce, test } from './fixtures.ts';
import { bootPage, pageUrl, run } from './helpers.ts';

test('a pruned anchor: the same win is proved again, sent once, and minted', async ({ page, proofMeter }) => {
  await bootPage(page, pageUrl(run()));
  const fault = await pruneAnchorOnce(page);
  await page.getByTestId('start').click();
  const ledger = page.getByTestId('ledger');
  await expect(ledger).toContainText(
    'a win · the node dropped the block it was reading · proving again, try 2 of 3',
    { timeout: 10 * 60_000 },
  );
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 10 * 60_000 });
  expect([fault.fired(), proofMeter.sends.length]).toEqual([1, 1]);
  await expect(ledger).toContainText(/minted in block/);
  await page.getByTestId('stop').click();
});

test('a claim whose receipt comes back without its effects is found in its block: adopted, never sent again', async ({
  page,
  proofMeter,
}) => {
  await bootPage(page, pageUrl(run()));
  const fault = await faultOnce(
    page,
    (c) =>
      c.method === 'aztec_getTxReceipt' &&
      (c.params[1] as { includeTxEffect?: boolean } | undefined)?.includeTxEffect === true,
    (a) => ({ ...a, result: { ...(a.result as object), txEffect: undefined } }),
  );
  await page.getByTestId('start').click();
  const ledger = page.getByTestId('ledger');
  await expect(ledger).toContainText(
    'a win · the node lost sight of it · checking the chain for your claim',
    {
      timeout: 10 * 60_000,
    },
  );
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 5 * 60_000 });
  expect([fault.fired(), proofMeter.sends.length]).toEqual([1, 1]);
  await expect(ledger).toContainText(/minted in block/);
  await page.getByTestId('stop').click();
});
