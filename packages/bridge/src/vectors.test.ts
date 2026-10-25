// The bridge against its pinned cross-language vectors; the Noir crate's generated tests and the
// portal's Foundry suite assert the same values, so a drift on any side fails its own tests.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { computeSecretHash } from '@aztec-labs/stdlib/hash';
import { masterFromPrf } from '@yacana/miner-core/keys/derive';
import { type Hex, hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { claimContent, exitContent, MAX_AMOUNT, retireContent, sendAheadContent } from './content.ts';
import { INBOX_BUCKET_GAS, inboxLeaf } from './inbox.ts';
import { deriveCrossingSecrets, exitLogTag } from './secrets.ts';
import { PORTAL_DOMAIN, SIGNED_TYPES, signForward } from './signatures.ts';
import { outboxLeaf } from './witness.ts';

const v = (await Bun.file(resolve(import.meta.dir, '../fixtures/bridge-vectors.json')).json()) as {
  edge: {
    recipient: string;
    amount: string;
    tag: string;
    exitValue: string;
    sendAheadValue: string;
    claimValue: string;
  };
  exit: { recipient: string; amount: string; tag: string; value: string };
  sendAhead: { amount: string; secretHash: string; redeemKey: string; value: string };
  claim: { amount: string; value: string };
  retire: { version: string; value: string };
  retireSecretHash: string;
  exitLogTag: { hashOrTag: string; value: string };
  messages: { miner: string; outboxLeaf: string; inboxIndex: string; inboxLeaf: string };
  signed: {
    epoch: string;
    leafId: string;
    target: string;
    expiry: string;
    recipient: string;
    forwardDigest: Hex;
    redeemDigest: Hex;
  };
  crossing: {
    masterPrf: string;
    scope: { chainId: string; portal: string; version: string };
    index: number;
    secret: string;
    secretHash: string;
    tag: string;
    redeemKey: string;
    redeemAddress: string;
  };
};
const fr = (h: string) => Fr.fromString(h);
const eth = (h: string) => EthAddress.fromString(h);

describe('bridge vectors', () => {
  test('the four contents, the retire secret hash and the exit log tag', async () => {
    expect(exitContent(eth(v.exit.recipient), BigInt(v.exit.amount), fr(v.exit.tag)).toString()).toBe(
      fr(v.exit.value).toString(),
    );
    const s = v.sendAhead;
    expect(sendAheadContent(BigInt(s.amount), fr(s.secretHash), eth(s.redeemKey)).toString()).toBe(
      fr(s.value).toString(),
    );
    expect(claimContent(BigInt(v.claim.amount)).toString()).toBe(fr(v.claim.value).toString());
    expect(retireContent(BigInt(v.retire.version)).toString()).toBe(fr(v.retire.value).toString());
    expect((await computeSecretHash(new Fr(0n))).toString()).toBe(fr(v.retireSecretHash).toString());
    expect((await exitLogTag(fr(v.exitLogTag.hashOrTag))).toString()).toBe(fr(v.exitLogTag.value).toString());
  });

  test('the edges: max u128, a high-bit tag, a high-bit address', () => {
    const e = v.edge;
    expect(exitContent(eth(e.recipient), BigInt(e.amount), fr(e.tag)).toString()).toBe(
      fr(e.exitValue).toString(),
    );
    expect(sendAheadContent(BigInt(e.amount), fr(e.tag), eth(e.recipient)).toString()).toBe(
      fr(e.sendAheadValue).toString(),
    );
    expect(claimContent(BigInt(e.amount)).toString()).toBe(fr(e.claimValue).toString());
  });

  test('one crossing derives to the pinned secrets, tag and redeem key', async () => {
    const c = v.crossing;
    const master = await masterFromPrf(Uint8Array.from(Buffer.from(c.masterPrf, 'hex')));
    const scope = {
      chainId: BigInt(c.scope.chainId),
      portal: eth(c.scope.portal),
      version: BigInt(c.scope.version),
    };
    const d = await deriveCrossingSecrets(master, scope, c.index);
    expect(d.secret.toString()).toBe(fr(c.secret).toString());
    expect(d.secretHash.toString()).toBe(fr(c.secretHash).toString());
    expect(d.tag.toString()).toBe(fr(c.tag).toString());
    expect(d.redeemKey).toBe(c.redeemKey as `0x${string}`);
    expect(d.redeemAddress.toString()).toBe(eth(c.redeemAddress).toString());
    // Another index, version or portal is another key: nothing links two crossings.
    const other = await deriveCrossingSecrets(master, scope, c.index + 1);
    expect(other.redeemAddress.equals(d.redeemAddress)).toBe(false);
    const elsewhere = await deriveCrossingSecrets(master, { ...scope, version: scope.version + 1n }, c.index);
    expect(elsewhere.secretHash.equals(d.secretHash)).toBe(false);
  });

  test('the message leaves and the signed digests, and a forward signature recovers to its key', async () => {
    const scope = {
      chainId: BigInt(v.crossing.scope.chainId),
      rollupVersion: BigInt(v.retire.version),
      miner: AztecAddress.fromStringUnsafe(v.messages.miner),
      portal: eth(v.crossing.scope.portal),
    };
    const content = exitContent(eth(v.exit.recipient), BigInt(v.exit.amount), fr(v.exit.tag));
    expect(outboxLeaf(scope, content).toString()).toBe(fr(v.messages.outboxLeaf).toString());
    const leaf = inboxLeaf(
      scope,
      claimContent(BigInt(v.claim.amount)),
      fr(v.sendAhead.secretHash),
      BigInt(v.messages.inboxIndex),
    );
    expect(leaf.toString()).toBe(fr(v.messages.inboxLeaf).toString());

    const s = v.signed;
    const message = {
      version: scope.rollupVersion,
      epoch: BigInt(s.epoch),
      leafId: BigInt(s.leafId),
      contentHash: `0x${fr(v.sendAhead.value).toBuffer().toString('hex')}` as Hex,
      expiry: BigInt(s.expiry),
    };
    const domain = PORTAL_DOMAIN(scope.chainId, v.crossing.scope.portal as Hex);
    expect(
      hashTypedData({
        domain,
        types: SIGNED_TYPES,
        primaryType: 'Forward',
        message: { ...message, target: BigInt(s.target) },
      }),
    ).toBe(s.forwardDigest);
    expect(
      hashTypedData({
        domain,
        types: SIGNED_TYPES,
        primaryType: 'Redeem',
        message: { ...message, recipient: s.recipient as Hex },
      }),
    ).toBe(s.redeemDigest);
    const key = `0x${'42'.repeat(32)}` as Hex;
    const args = {
      kind: 2 as const,
      amount: BigInt(v.sendAhead.amount),
      aux: `0x${fr(v.sendAhead.secretHash).toBuffer().toString('hex')}` as Hex,
      recipientOrRedeemKey: v.sendAhead.redeemKey as Hex,
      epoch: BigInt(s.epoch),
      numCheckpointsInEpoch: 1n,
      leafIndex: 1n,
      path: [`0x${'00'.repeat(32)}` as Hex, `0x${'00'.repeat(32)}` as Hex],
      sig: '0x' as Hex,
      expiry: BigInt(s.expiry),
    };
    const signature = await signForward(
      key,
      {
        chainId: scope.chainId,
        portal: v.crossing.scope.portal as Hex,
        version: scope.rollupVersion,
        expiry: BigInt(s.expiry),
      },
      args,
      BigInt(s.target),
    );
    expect(
      await recoverTypedDataAddress({
        domain,
        types: SIGNED_TYPES,
        primaryType: 'Forward',
        message: { ...message, target: BigInt(s.target) },
        signature,
      }),
    ).toBe(privateKeyToAccount(key).address);
  });

  test('fails closed: a bad master, a negative index, an amount past u128', async () => {
    const scope = { chainId: 1n, portal: eth(v.crossing.scope.portal), version: 1n };
    await expect(deriveCrossingSecrets(new Uint8Array(16), scope, 0)).rejects.toThrow(/expected 32/);
    await expect(deriveCrossingSecrets(new Uint8Array(32), scope, -1)).rejects.toThrow(/index/);
    expect(() => claimContent(MAX_AMOUNT + 1n)).toThrow(/u128/);
    expect(claimContent(MAX_AMOUNT)).toBeInstanceOf(Fr);
  });
});

test("the portal's gas suite holds the clients' Inbox margin: a costlier Inbox fails there, not on a wallet", async () => {
  const suite = await Bun.file(resolve(import.meta.dir, '../../../protocol/portal/test/Gas.t.sol')).text();
  expect(/INBOX_BUCKET_GAS = ([\d_]+);/.exec(suite)?.[1]?.replaceAll('_', '')).toBe(
    INBOX_BUCKET_GAS.toString(),
  );
});
