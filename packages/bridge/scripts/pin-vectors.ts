// Pins the bridge's cross-language vectors: every content hash, the retire secret hash, the exit
// log tag and one crossing's derived secrets, computed here once and written to
// packages/bridge/fixtures/bridge-vectors.json. The codegen turns them into Noir tests, the
// portal's Foundry suite and vectors.test.ts assert the same values. Re-run only when an
// encoding, a label or a domain changes on purpose — that orphans every crossing ever made.
import { resolve } from 'node:path';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { masterFromPrf } from '@yacana/miner-core/keys/derive';
import { hashTypedData } from 'viem';
import { claimContent, exitContent, retireContent, sendAheadContent } from '../src/content.ts';
import { inboxLeaf } from '../src/inbox.ts';
import { deriveCrossingSecrets, exitLogTag } from '../src/secrets.ts';
import { PORTAL_DOMAIN, SIGNED_TYPES } from '../src/signatures.ts';
import { outboxLeaf } from '../src/witness.ts';

const hex = (v: Fr | bigint) => `0x${(typeof v === 'bigint' ? v : v.toBigInt()).toString(16)}`;

const recipient = EthAddress.fromString('0x1e5700000000000000000000000000000000c0de');
const redeemKey = EthAddress.fromString('0x00000000000000000000000000000000000000ff');
const amount = 12_000000000000000000n;
const tag = new Fr(0x7a9n);
const secretHash = new Fr(0x5ec2e7n);
const version = 1821665230n;
const scope = {
  chainId: 31337n,
  portal: EthAddress.fromString('0x000000000000000000000000000000000000beef'),
  version,
};
const master = await masterFromPrf(new Uint8Array(32).map((_, i) => i));
const crossing = await deriveCrossingSecrets(master, scope, 3);

// The miner's messages as the rollup hashes them, and the digests the portal checks a signature
// against: pinned so the TypeScript that builds them in the browser and the Solidity that verifies
// them stay one encoding.
const miner = AztecAddress.fromStringUnsafe(`0x0a11ce${'00'.repeat(28)}01`);
const messageScope = { chainId: scope.chainId, rollupVersion: version, miner, portal: scope.portal };
const inboxIndex = 37n;
const signed = { epoch: 3n, leafId: 5n, target: version + 1n, expiry: 1_800_000_000n };
const signedDomain = PORTAL_DOMAIN(scope.chainId, scope.portal.toString());
const signedMessage = {
  version,
  epoch: signed.epoch,
  leafId: signed.leafId,
  contentHash: `0x${sendAheadContent(amount, secretHash, redeemKey).toBuffer().toString('hex')}` as const,
  expiry: signed.expiry,
};
const forwardDigest = hashTypedData({
  domain: signedDomain,
  types: SIGNED_TYPES,
  primaryType: 'Forward',
  message: { ...signedMessage, target: signed.target },
});
const redeemDigest = hashTypedData({
  domain: signedDomain,
  types: SIGNED_TYPES,
  primaryType: 'Redeem',
  message: { ...signedMessage, recipient: recipient.toString() as `0x${string}` },
});

// The edges: the largest amount, a tag and an address with their top bits set, so every side's
// word encoding is exercised at full width.
const MAX_U128 = (1n << 128n) - 1n;
const highTag = Fr.fromString('0x2000000000000000000000000000000000000000000000000000000000000001');
const highRecipient = EthAddress.fromString('0x8000000000000000000000000000000000000001');

const vectors = {
  edge: {
    recipient: highRecipient.toString(),
    amount: MAX_U128.toString(),
    tag: hex(highTag),
    exitValue: hex(exitContent(highRecipient, MAX_U128, highTag)),
    sendAheadValue: hex(sendAheadContent(MAX_U128, highTag, highRecipient)),
    claimValue: hex(claimContent(MAX_U128)),
  },
  exit: {
    recipient: recipient.toString(),
    amount: amount.toString(),
    tag: hex(tag),
    value: hex(exitContent(recipient, amount, tag)),
  },
  sendAhead: {
    amount: amount.toString(),
    secretHash: hex(secretHash),
    redeemKey: redeemKey.toString(),
    value: hex(sendAheadContent(amount, secretHash, redeemKey)),
  },
  claim: { amount: amount.toString(), value: hex(claimContent(amount)) },
  retire: { version: version.toString(), value: hex(retireContent(version)) },
  retireSecretHash: hex(await computeSecretHash(new Fr(0n))),
  exitLogTag: { hashOrTag: hex(tag), value: hex(await exitLogTag(tag)) },
  messages: {
    miner: miner.toString(),
    outboxLeaf: hex(outboxLeaf(messageScope, exitContent(recipient, amount, tag))),
    inboxIndex: inboxIndex.toString(),
    inboxLeaf: hex(inboxLeaf(messageScope, claimContent(amount), secretHash, inboxIndex)),
  },
  signed: {
    epoch: signed.epoch.toString(),
    leafId: signed.leafId.toString(),
    target: signed.target.toString(),
    expiry: signed.expiry.toString(),
    recipient: recipient.toString(),
    forwardDigest,
    redeemDigest,
  },
  crossing: {
    masterPrf: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    scope: {
      chainId: scope.chainId.toString(),
      portal: scope.portal.toString(),
      version: version.toString(),
    },
    index: crossing.index,
    secret: hex(crossing.secret),
    secretHash: hex(crossing.secretHash),
    tag: hex(crossing.tag),
    redeemKey: crossing.redeemKey,
    redeemAddress: crossing.redeemAddress.toString(),
  },
};
const out = resolve(import.meta.dir, '../fixtures/bridge-vectors.json');
await Bun.write(out, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`bridge vectors → ${out}`);
