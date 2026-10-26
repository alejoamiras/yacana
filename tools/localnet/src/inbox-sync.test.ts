import { afterAll, expect, test } from 'bun:test';
import { untilInboxSynced } from './inbox-sync.ts';

const stalled = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Promise<Response>(() => {}) });
afterAll(() => stalled.stop(true));

test('a node that never answers ends the wait at its deadline', async () => {
  const url = `http://127.0.0.1:${stalled.port}`;
  const started = Date.now();
  await expect(untilInboxSynced(url, url, 200)).rejects.toThrow('has not synced its Inbox after 0.2 s');
  expect(Date.now() - started).toBeLessThan(2_000);
});
