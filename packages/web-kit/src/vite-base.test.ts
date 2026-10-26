import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bbVersion } from './vite-base.ts';

test('bbVersion is the installed package’s own version, not its inner commonjs manifest’s', () => {
  const declared = (
    JSON.parse(readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    }
  ).devDependencies['@aztec-foundation/bb.js'];
  expect(bbVersion()).toBe(declared);
});
