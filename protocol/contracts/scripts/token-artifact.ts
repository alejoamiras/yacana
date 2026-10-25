// The TXE looks up every contract a test deploys under target/, including git dependencies it
// never compiled; the aztec-standards token artifact ships in its npm package at the pinned version.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(import.meta.dir, '..', 'target');
mkdirSync(target, { recursive: true });
copyFileSync(
  Bun.resolveSync(
    '@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json',
    import.meta.dir,
  ),
  resolve(target, 'token_contract-Token.json'),
);
