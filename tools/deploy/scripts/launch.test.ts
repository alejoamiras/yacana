// The lottery secret on disk: private to this user under a permissive umask, and never written over.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLaunchSecret } from './launch.ts';

const dir = mkdtempSync(join(tmpdir(), 'yacana-launch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('mode 0600 under umask 002, and a second write is refused', () => {
  const path = join(dir, '.launch-testnet.json');
  const first = { account: '0x01', preimage: '0x02' };
  const umask = process.umask(0o002);
  try {
    writeLaunchSecret(path, first);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(first);
    expect(() => writeLaunchSecret(path, { account: '0x03', preimage: '0x04' })).toThrow(/EEXIST/);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(first);
  } finally {
    process.umask(umask);
  }
});
