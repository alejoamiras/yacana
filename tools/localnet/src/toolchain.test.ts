// The proving toolchain is part of the trusted computing base: the native bb, nargo and foundry
// binaries, the bb.js WASM, the forge-std the portal's tests compile against and the Noir
// dependencies fetched by git tag are pinned to content hashes / commits in toolchain.lock.json,
// and any drift (a moved tag, a re-published binary) fails here.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import lock from '../../../toolchain.lock.json';
import { repoRoot, toolchainBin, treeDigest } from './toolchain.ts';

const pin = readFileSync(resolve(repoRoot, '.aztecrc'), 'utf8').trim();
const versionDir = join(homedir(), '.aztec', 'versions', pin);
const sha256 = (path: string) => new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex');

// Skipped where the toolchain is absent unless a workflow that installed it demands the check.
describe.skipIf(!existsSync(versionDir) && !process.env.YACANA_REQUIRE_TOOLCHAIN)('pinned toolchain', () => {
  test('.aztecrc and the lock agree', () => expect(pin).toBe(lock.aztec));

  test('native binaries match their hashes', () => {
    const platform = lock.binaries[`${process.platform}-${process.arch}` as keyof typeof lock.binaries];
    if (!platform) return; // only the platforms we ship hashes for
    for (const [file, hash] of Object.entries(platform)) expect(sha256(join(versionDir, file))).toBe(hash);
  });

  test('bb.js WASM matches its hash', () => {
    for (const [file, hash] of Object.entries(lock.bbjs)) {
      expect(sha256(join(versionDir, 'node_modules', '@aztec-foundation', 'bb.js', file))).toBe(hash);
    }
  });

  test('vendored source trees match their digests', () => {
    for (const [dir, digest] of Object.entries(lock.trees))
      expect(treeDigest(join(versionDir, dir))).toBe(digest);
  });

  test('Noir git dependencies sit at their pinned commits', () => {
    for (const [dep, commit] of Object.entries(lock.nargo)) {
      const head = join(homedir(), 'nargo', 'github.com', dep, '.git', 'HEAD');
      if (!existsSync(head)) continue; // not fetched by this workflow's compile
      expect(readFileSync(head, 'utf8').trim()).toBe(commit);
    }
  });
});

// The lookup fails closed: a root without a readable, well-formed pin never falls back to `PATH`.
describe('toolchainBin', () => {
  const root = mkdtempSync(join(tmpdir(), 'yacana-pin-'));
  const pinned = (text: string) => {
    writeFileSync(join(root, '.aztecrc'), text);
    return () => toolchainBin('bb', root);
  };
  test('a root without a pin', () => {
    expect(() => toolchainBin('bb', join(root, 'nowhere'))).toThrow(/cannot be read/);
  });
  test('an empty pin', () => expect(pinned('\n')).toThrow(/does not hold a version/));
  test('a malformed pin', () => expect(pinned('latest')).toThrow(/does not hold a version/));
  test('a pin whose toolchain is not installed', () =>
    expect(pinned('0.0.1')).toThrow(/pinned by .aztecrc but .* is missing/));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
});
