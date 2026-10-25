import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { type Need, verdict } from './ci-status.ts';

const changes = (relevant?: string): Need => ({
  result: 'success',
  outputs: relevant === undefined ? {} : { relevant },
});
const job = (result: string): Need => ({ result });

describe('the status verdict', () => {
  test.each<[string, Record<string, Need>, boolean]>([
    ['relevant, all ran', { changes: changes('true'), test: job('success'), replay: job('success') }, true],
    ['not relevant, every job skipped', { changes: changes('false'), test: job('skipped') }, true],
    ['no change filter, the job ran', { test: job('success') }, true],
    ['a job failed', { changes: changes('true'), test: job('failure'), replay: job('success') }, false],
    ['a job was cancelled', { changes: changes('true'), test: job('cancelled') }, false],
    ['a relevant job never started', { changes: changes('true'), test: job('skipped') }, false],
    ['the filter failed', { changes: { result: 'failure' }, test: job('skipped') }, false],
    ['the filter concluded without an answer', { changes: changes(), test: job('skipped') }, false],
    ['the filter answered neither', { changes: changes('maybe'), test: job('success') }, false],
    ['an unknown result', { changes: changes('true'), test: job('neutral') }, false],
    ['a job ran though not relevant', { changes: changes('false'), test: job('success') }, false],
    ['no change filter, the job skipped', { test: job('skipped') }, false],
    ['nothing needed', {}, false],
  ])('%s', (_, needs, ok) => {
    expect(verdict(needs).ok).toBe(ok);
  });

  test('the entry exits by the verdict and names the job that broke it', () => {
    const run = (needs: Record<string, Need>) =>
      Bun.spawnSync(['bun', resolve(import.meta.dir, 'ci-status.ts')], {
        env: { ...process.env, NEEDS: JSON.stringify(needs) },
      });
    expect(run({ changes: changes('true'), test: job('success') }).exitCode).toBe(0);
    const failed = run({ changes: changes('true'), test: job('cancelled') });
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout.toString()).toContain('test: cancelled, expected success');
  });
});
