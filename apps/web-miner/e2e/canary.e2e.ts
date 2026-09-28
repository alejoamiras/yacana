// A claim whose proof no longer matches one of its bound public inputs is refused at proving:
// simulation cannot tell (the recursive verifier is a black box to the ACVM), and a proverless build
// would send it for the local network, which verifies nothing, to mint. The same claim with the
// input restored then mints, so nothing but the tamper explains the refusal.
import { expect, pruneAnchorOnce, test } from './fixtures.ts';
import { bootPage, pageUrl, run } from './helpers.ts';

/** What the embedded PXE says when ClientIVC refuses the claim's proof; nothing else counts. */
const REFUSED_AT_PROVING = /Failed to verify the generated proof/;

test('a claim with a bound public input altered is refused at proving before it is sent; restored, the same claim mints', async ({
  page,
}) => {
  const r = run();
  let sends = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && (req.postData() ?? '').includes('aztec_sendTx')) sends += 1;
  });
  await bootPage(page, pageUrl(r));
  expect(await page.evaluate(() => window.yacana?.proverless)).toBe(false);
  await page.evaluate(() => window.yacana?.tamperNextClaim());
  await page.getByTestId('start').click();
  // Stop during the claim: the chip says the claim finishes, Stop is spent; mining will not resume after it.
  const chip = page.getByTestId('claim-chip');
  await expect(chip).toContainText(/claiming · proving · \d+ s/, { timeout: 10 * 60_000 });
  await page.getByTestId('stop').click();
  await expect(chip).toContainText(/stopping · claim finishing · \d+ s/);
  await expect(page.getByTestId('stop')).toBeDisabled();
  const retry = page.getByTestId('ledger').getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByTestId('ledger')).toContainText(/a win · claim failed: .+ · mining paused/);
  const log = await page.evaluate(() => window.yacana?.log() ?? []);
  const failure = log.find((l) => l.includes('claim failed'));
  console.log(`[canary] ${failure}`);
  expect(log.some((l) => l.includes('a bound public input altered'))).toBe(true);
  expect(failure).toMatch(/claim failed \(other, attempt 1\)/);
  expect(failure).toMatch(REFUSED_AT_PROVING);
  expect(failure).not.toMatch(
    /Circuit execution failed|assertion failed|epoch is not open|ticket above target|reverted|expired/,
  );
  expect(sends).toBe(0);
  await expect(page.getByTestId('claims')).toHaveText('0');

  // Retry on the line: the same ticket, its input restored, mints — and the Stop pressed earlier holds.
  await retry.click();
  await expect(page.getByTestId('claims')).toHaveText('1', { timeout: 10 * 60_000 });
  await expect(page.getByTestId('balance')).toHaveText('4');
  expect(sends).toBe(1);
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('ledger')).toContainText(
    /minted in block [\d,]+↗ \(opens in a new tab\) · 4 tYACA, privately/,
  );
});

// The pruned anchor fails the first attempt at simulation, before anything is proved: the one claim
// proof and the one send are the retry's.
test('a pruned anchor under the real prover: the win is proved again, sent once, mints, and mining resumes', async ({
  page,
  proofMeter,
}) => {
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
  await expect(page.getByTestId('balance')).toHaveText('4');
  await expect(ledger).toContainText(/minted in block [\d,]+↗ \(opens in a new tab\) · 4 tYACA, privately/);
  await expect(page.getByTestId('phase')).toHaveText(/^mining/);
  await page.getByTestId('stop').click();
});
