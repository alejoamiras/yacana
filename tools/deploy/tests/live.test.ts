// Runs against an isolated local network: bun run e2e:agent -- bun test packages/miner-core
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpus } from 'node:os';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { BackendType, Barretenberg } from '@aztec/bb.js';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { poseidon2Hash } from '@aztec/foundation/crypto/poseidon';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import type { Gas } from '@aztec/stdlib/gas';
import { computePublicDataTreeLeafSlot, deriveStorageSlotInMap, siloNullifier } from '@aztec/stdlib/hash';
import { deriveMasterMessageSigningSecretKey } from '@aztec/stdlib/keys';
import type { PrivateCallExecutionResult, TxReceipt } from '@aztec/stdlib/tx';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { TokenContract } from '@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js';
import { loadMinerArtifact, loadWorkArtifact } from '@yacana/miner-core/artifacts';
import { buildClaim, claimGasLimits } from '@yacana/miner-core/claim';
import { classifyClaimFailure } from '@yacana/miner-core/claim-failure';
import { readOpenEpoch, readRules } from '@yacana/miner-core/epoch';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { mineEpoch, type Winner } from '@yacana/miner-core/miner';
import { DOM_NULL, deployDomain } from '@yacana/miner-core/proof';
import { newEpochSecret } from '@yacana/miner-core/secret';
import { BbJsWorkProver, type WorkProver } from '@yacana/miner-core/work';
import { type Deployment, deployYacana, TEST_PORTAL } from '../src/deploy.ts';
import { effectView, exampleClaimFromEffect, sponsorFeeLeaf } from '../src/example-claim.ts';

const nodeUrl = process.env.AZTEC_NODE_URL ?? '';
const EASY_TARGET = 1n << 127n; // every other proof wins

describe.skipIf(!nodeUrl)('miner-core against a live node', () => {
  let wallet: EmbeddedWallet;
  let from: AztecAddress;
  let fee: { paymentMethod: SponsoredFeePaymentMethod; gasSettings: { gasLimits: Gas } };
  let deployment: Deployment;
  let miner: Contract;
  let prover: WorkProver;
  let chainId: bigint;
  let rollupVersion: bigint;
  const node = createAztecNodeClient(nodeUrl);

  const mine = async (
    m: Contract,
    secret = newEpochSecret(),
    recipient: AztecAddress = from,
  ): Promise<{ winner: Winner; secret: Fr }> => {
    const view = await readOpenEpoch(m, from);
    const domain = await deployDomain(chainId, rollupVersion, m.address.toField(), PARAMS.VERSION);
    const winner = await mineEpoch(prover, {
      domain,
      seed: new Fr(view.params.seed),
      epoch: view.epoch,
      secret,
      recipient: recipient.toField(),
      target: view.params.target,
    });
    if (!winner) throw new Error('mining stopped without a winner');
    return { winner, secret };
  };
  const send = (interaction: ReturnType<typeof buildClaim>) =>
    interaction.send({ from, fee, wait: { timeout: 900 } }).then(
      (r) => ({ ok: true as const, receipt: (r as unknown as { receipt?: unknown }).receipt ?? r }),
      (e: Error) => ({ ok: false as const, error: e.message.split('\n')[0] ?? '' }),
    );

  const newWallet = () => EmbeddedWallet.create(nodeUrl, { ephemeral: true, pxe: { proverEnabled: true } });
  const registerFpc = async (w: EmbeddedWallet) => {
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(SPONSORED_FPC_SALT),
    });
    await w.registerContract(fpc, SponsoredFPCContract.artifact);
    return { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) };
  };
  const newAccount = async (w: EmbeddedWallet, secret = Fr.random()) =>
    (
      await w.createSchnorrInitializerlessAccount(
        secret,
        Fr.ZERO,
        deriveMasterMessageSigningSecretKey(secret),
      )
    ).address;
  // A wallet needs both instances of a deployment (the claim calls the token's mint).
  const registerDeployment = async (d: Deployment, w = wallet): Promise<Contract> => {
    const artifact = await loadMinerArtifact();
    for (const [address, art] of [
      [AztecAddress.fromStringUnsafe(d.miner), artifact],
      [AztecAddress.fromStringUnsafe(d.token), TokenContract.artifact],
    ] as const) {
      const instance = await node.getContract(address);
      if (!instance) throw new Error(`${address} is not on the node`);
      await w.registerContract(instance, art);
    }
    return Contract.at(AztecAddress.fromStringUnsafe(d.miner), artifact, w);
  };

  beforeAll(async () => {
    wallet = await newWallet();
    fee = { ...(await registerFpc(wallet)), gasSettings: { gasLimits: await claimGasLimits(node) } };
    const secret = Fr.random();
    from = await newAccount(wallet, secret);
    deployment = await deployYacana(nodeUrl, secret, Fr.random(), {
      initialTarget: EASY_TARGET,
      portal: TEST_PORTAL,
    });
    miner = await registerDeployment(deployment);
    chainId = BigInt(await node.getChainId());
    rollupVersion = BigInt((await node.getNodeInfo()).rollupVersion);
    const api = await Barretenberg.new({
      threads: Math.max(1, cpus().length - 1),
      backend: BackendType.WasmWorker,
    });
    prover = new BbJsWorkProver(await loadWorkArtifact(), api);
  }, 600_000);

  afterAll(async () => {
    await prover?.destroy();
    await wallet?.stop();
  });

  type Footprint = {
    nullifiers: Fr[];
    noteHashes: unknown[];
    publicDataWrites: { leafSlot: Fr; value: Fr }[];
  };
  const footprint = async (r: Awaited<ReturnType<typeof send>>): Promise<Footprint> => {
    if (!r.ok) throw new Error(`tx failed: ${r.error}`);
    const effect = await node.getTxEffect((r.receipt as { txHash: never }).txHash);
    if (!effect) throw new Error('no tx effect');
    return (effect as unknown as { data: Footprint }).data;
  };

  test('a mined ticket claims REWARD into the private balance and its public effects reveal only the digest', async () => {
    // Baseline: the same account and fee path sending a trivial call, so protocol-level effects
    // (the tx-hash nullifier, the fee-juice write) are measured, not assumed, and the claim's own
    // footprint is asserted as an exact delta.
    const base = await footprint(await send(miner.methods.constants() as ReturnType<typeof buildClaim>));
    const { winner, secret } = await mine(miner);
    const claim = buildClaim(miner, {
      epoch: 0n,
      nonce: winner.nonce,
      out: winner.out,
      secret,
      proofFields: winner.proofFields,
      recipient: from,
    });
    // Every private-side nullifier, attributed to the contract that pushed it.
    const sim = await wallet.simulateTx(await claim.request({ fee: { paymentMethod: fee.paymentMethod } }), {
      from,
      skipFeeEnforcement: true,
    });
    const pushed: { contract: AztecAddress; inner: Fr }[] = [];
    const notes: AztecAddress[] = [];
    const walk = (c: PrivateCallExecutionResult) => {
      const pi = c.publicInputs;
      for (const n of pi.nullifiers.array.slice(0, pi.nullifiers.claimedLength))
        pushed.push({ contract: pi.callContext.contractAddress, inner: n.value });
      for (let i = 0; i < pi.noteHashes.claimedLength; i++) notes.push(pi.callContext.contractAddress);
      for (const nested of c.nestedExecutionResults) walk(nested);
    };
    walk(sim.privateExecutionResult.entrypoint);
    // The claim caps its own lifetime: an expired claim is dropped, never reverted at the sponsor's cost.
    const anchorTs =
      sim.privateExecutionResult.entrypoint.publicInputs.anchorBlockHeader.globalVariables.timestamp;
    expect(sim.publicInputs.expirationTimestamp).toBe(anchorTs + PARAMS.CLAIM_TTL_SECONDS);
    const r = await send(claim);
    expect(r.ok).toBe(true);
    const token = TokenContract.at(AztecAddress.fromStringUnsafe(deployment.token), wallet);
    const balance = ((await token.methods.balance_of_private(from).simulate({ from })) as { result: bigint })
      .result;
    expect(balance).toBe(PARAMS.REWARD);
    expect((await readOpenEpoch(miner, from)).claims).toBe(1);
    // Public effects: the tx's effect on chain, as any observer sees it.
    const receipt = (r as unknown as { receipt: { txHash: { toString(): string } } }).receipt;
    const effect = await node.getTxEffect(receipt.txHash as never);
    expect(effect).toBeTruthy();
    const json = JSON.stringify(effect, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(json.includes(from.toString().slice(2))).toBe(false); // recipient not visible
    expect(json.includes(secret.toString().slice(2))).toBe(false); // secret not visible
    const data = (
      effect as unknown as {
        data: { nullifiers: Fr[]; noteHashes: unknown[]; publicDataWrites: { leafSlot: Fr; value: Fr }[] };
      }
    ).data;
    // Beyond the baseline the claim adds exactly: the miner's ticket nullifier, the token's
    // note-delivery sequence nullifier, the message registry's handshake nullifier and note (a
    // first delivery from this token to this recipient), the minted note, and three storage
    // writes — claims[0] = 1, last_digest[0] = digest, the token's total supply = REWARD (first
    // mint on this deployment). The account and the FPC push nothing.
    const tokenAddress = AztecAddress.fromStringUnsafe(deployment.token);
    const by = (contract: AztecAddress) => pushed.filter((p) => p.contract.equals(contract));
    expect(by(miner.address).map((p) => p.inner.toBigInt())).toEqual([
      (await poseidon2Hash([new Fr(DOM_NULL), winner.digest])).toBigInt(),
    ]);
    expect(by(tokenAddress)).toHaveLength(1);
    expect(by(from)).toHaveLength(0);
    expect(pushed).toHaveLength(3);
    expect(data.nullifiers).toHaveLength(base.nullifiers.length + pushed.length);
    // The delivery nullifiers derive from the execution's ephemeral handshake secrets, so the
    // attribution simulation and the sent tx disagree on their values; the ticket is deterministic.
    const ticket = by(miner.address)[0];
    if (!ticket) throw new Error('unreachable: the miner pushed the ticket');
    const siloedTicket = await siloNullifier(miner.address, ticket.inner);
    expect(data.nullifiers.some((n) => n.equals(siloedTicket))).toBe(true);
    // Note hashes: the minted note from the token and the handshake record from the registry
    // that validated the delivery (the contract behind the third nullifier); none from the miner.
    const registry = pushed.find(
      (p) => !p.contract.equals(miner.address) && !p.contract.equals(tokenAddress),
    );
    if (!registry) throw new Error('unreachable: the handshake nullifier has a contract');
    expect(notes.filter((a) => a.equals(tokenAddress))).toHaveLength(1);
    expect(notes.filter((a) => a.equals(registry.contract))).toHaveLength(1);
    expect(notes).toHaveLength(2);
    expect(data.noteHashes).toHaveLength(base.noteHashes.length + notes.length);
    const leaf = async (
      contract: AztecAddress,
      layout: Record<string, { slot: Fr }>,
      name: string,
      key?: Fr,
    ) => {
      const base = layout[name]?.slot;
      if (!base) throw new Error(`no storage slot for ${name}`);
      const slot = key === undefined ? base : await deriveStorageSlotInMap(base, { toField: () => key });
      return (await computePublicDataTreeLeafSlot(contract, slot)).toBigInt();
    };
    const expected = new Map<bigint, bigint>([
      [await leaf(miner.address, miner.artifact.storageLayout, 'claims', Fr.ZERO), 1n],
      [
        await leaf(miner.address, miner.artifact.storageLayout, 'last_digest', Fr.ZERO),
        winner.digest.toBigInt(),
      ],
      [await leaf(tokenAddress, TokenContract.artifact.storageLayout, 'total_supply'), PARAMS.REWARD],
    ]);
    const writes = new Map(data.publicDataWrites.map((w) => [w.leafSlot.toBigInt(), w.value.toBigInt()]));
    for (const [slot, value] of expected) expect(writes.get(slot)).toBe(value);
    // The landing's ledger example is read from an effect like this one, but not this one: a first claim
    // carries the handshake's note beside the minted one, and the extractor records plain claims only.
    const view = effectView(effect);
    const identity = {
      miner: deployment.miner,
      chainId: chainId.toString(),
      rollupVersion: rollupVersion.toString(),
    };
    const sponsorLeaf = await sponsorFeeLeaf();
    await expect(
      exampleClaimFromEffect(view, identity, miner.artifact.storageLayout, 0, sponsorLeaf),
    ).rejects.toThrow(/2 note hashes: not one plain claim/);
    // With one note set aside, the same effect is the claim: the same leaves, the same ticket, the same fee.
    const example = await exampleClaimFromEffect(
      { ...view, noteHashes: view.noteHashes.slice(0, 1) },
      identity,
      miner.artifact.storageLayout,
      0,
      sponsorLeaf,
    );
    expect(example).toMatchObject({
      txHash: receipt.txHash.toString(),
      epoch: 0,
      claims: [0, 1],
      nullifier: siloedTicket.toString(),
      noteHash: view.noteHashes[0],
    });
    // The only other write is the fee-juice deduction: the same leaf slot the baseline wrote.
    expect([...writes.keys()].filter((s) => !expected.has(s))).toEqual(
      base.publicDataWrites.map((w) => w.leafSlot.toBigInt()),
    );
  }, 900_000);

  test('a tampered proof field fails at proving and a replay of the winning proof is rejected', async () => {
    const { winner, secret } = await mine(miner);
    const tampered = winner.proofFields.map((f, i) => (i === 240 ? f.add(Fr.ONE) : f));
    const bad = await send(
      buildClaim(miner, {
        epoch: 0n,
        nonce: winner.nonce,
        out: winner.out,
        secret,
        proofFields: tampered,
        recipient: from,
      }),
    );
    expect(bad.ok).toBe(false);
    const good = await send(
      buildClaim(miner, {
        epoch: 0n,
        nonce: winner.nonce,
        out: winner.out,
        secret,
        proofFields: winner.proofFields,
        recipient: from,
      }),
    );
    expect(good.ok).toBe(true);
    const replay = await send(
      buildClaim(miner, {
        epoch: 0n,
        nonce: winner.nonce,
        out: winner.out,
        secret,
        proofFields: winner.proofFields,
        recipient: from,
      }),
    );
    expect(replay.ok).toBe(false);
    // A nullifier already in the tree: the node's refusal the miner reads as another send having landed.
    expect(replay.ok ? '' : classifyClaimFailure(new Error(replay.error))).toBe('landed-elsewhere');
  }, 900_000);

  test('a proof mined for one deployment does not claim on another', async () => {
    const other = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
      initialTarget: EASY_TARGET,
      portal: TEST_PORTAL,
    });
    const otherMiner = await registerDeployment(other);
    const { winner, secret } = await mine(miner); // domain of the FIRST deployment
    const r = await send(
      buildClaim(otherMiner, {
        epoch: 0n,
        nonce: winner.nonce,
        out: winner.out,
        secret,
        proofFields: winner.proofFields,
        recipient: from,
      }),
    );
    expect(r.ok).toBe(false);
    // The rejection must come from the recursive verifier (domain mismatch), not from setup.
    expect(r.ok ? '' : r.error).toMatch(/verif|proof/i);
  }, 900_000);

  // A claim that reverted in public still pays its fee; one refused at simulation costs nothing.
  const submit = async (
    c: { miner: Contract; account: AztecAddress },
    w: { winner: Winner; secret: Fr },
  ): Promise<{
    ok: boolean;
    reverted: boolean;
    error: string;
    fee: bigint;
    ms: number;
    /** Block number and index within it, for mined claims. */
    at?: [number, number];
  }> => {
    const t0 = performance.now();
    const claim = buildClaim(c.miner, {
      epoch: 0n,
      nonce: w.winner.nonce,
      out: w.winner.out,
      secret: w.secret,
      proofFields: w.winner.proofFields,
      recipient: c.account,
    });
    try {
      const r = await claim.send({ from: c.account, fee, wait: { timeout: 900, dontThrowOnRevert: true } });
      const receipt = (r as { receipt?: TxReceipt }).receipt ?? (r as unknown as TxReceipt);
      const ok = receipt.executionResult === 'success';
      const where = `block ${receipt.blockNumber} #${receipt.txIndexInBlock}`;
      console.log(
        `claim ${receipt.txHash}: ${receipt.executionResult} in ${where}, fee ${receipt.transactionFee}`,
      );
      return {
        ok,
        reverted: !ok,
        error: ok ? '' : (receipt.error ?? `reverted in ${where}`),
        fee: receipt.transactionFee ?? 0n,
        ms: performance.now() - t0,
        at: [Number(receipt.blockNumber), Number(receipt.txIndexInBlock)],
      };
    } catch (e) {
      return {
        ok: false,
        reverted: false,
        error: (e as Error).message.split('\n')[0] ?? '',
        fee: 0n,
        ms: performance.now() - t0,
      };
    }
  };

  test(`a burst of winners against N = ${PARAMS.N}: exactly N accepted, the rest revert as stale`, async () => {
    const burst = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
      initialTarget: EASY_TARGET,
      portal: TEST_PORTAL,
    });
    const m = await registerDeployment(burst);
    const rules = await readRules(m, from);
    // One wallet per winner: a PXE cannot simulate its own claims concurrently, and separate
    // wallets are what real miners are. All 2N claims race for the same epoch. Each ticket is
    // mined for its claimant, as the commitment binds the recipient.
    const claimants = await Promise.all(
      Array.from({ length: 2 * rules.N }, async () => {
        const w = await newWallet();
        await registerFpc(w);
        return { wallet: w, account: await newAccount(w), miner: await registerDeployment(burst, w) };
      }),
    );
    const winners: { winner: Winner; secret: Fr }[] = [];
    for (const c of claimants) winners.push(await mine(m, newEpochSecret(), c.account));
    const t0 = performance.now();
    let results: Awaited<ReturnType<typeof submit>>[];
    try {
      results = await Promise.all(
        winners.map((w, i) => submit(claimants[i] as (typeof claimants)[number], w)),
      );
    } finally {
      await Promise.all(claimants.map((c) => c.wallet.stop().catch(() => {})));
    }
    const accepted = results.filter((r) => r.ok);
    // A claim sequenced after the close reverts in public and pays (mined receipts carry no
    // reason); one whose simulation already saw the close is refused before sending, for free.
    const stale = results.filter((r) => !r.ok && (r.reverted || /stale|not open/i.test(r.error)));
    const inPublic = stale.filter((r) => r.reverted).length;
    for (const e of new Set(results.filter((r) => !r.ok).map((r) => r.error)))
      console.log(`burst failure: ${e}`);
    const fees = results.map((r) => r.fee);
    console.log(
      `burst: ${accepted.length} accepted, ${stale.length} stale (${inPublic} reverted in public, ${stale.length - inPublic} refused at simulation), ${results.length - accepted.length - stale.length} other, ` +
        `${((performance.now() - t0) / 1000).toFixed(0)} s wall, latency ${(Math.min(...results.map((r) => r.ms)) / 1000) | 0}–${(Math.max(...results.map((r) => r.ms)) / 1000) | 0} s, ` +
        `fees accepted ${accepted.map((r) => r.fee).join('/')} stale ${stale.map((r) => r.fee).join('/')} (sum ${fees.reduce((a, b) => a + b, 0n)})`,
    );
    const view = await readOpenEpoch(m, from);
    const closed = Number(((await m.methods.claims_in(0n).simulate({ from })) as { result: bigint }).result);
    console.log(
      `after the burst: open epoch ${view.epoch}, claims in epoch 0: ${closed}, in the open one: ${view.claims}`,
    );
    expect(accepted.length).toBe(rules.N);
    expect(stale.length).toBe(rules.N);
    expect(closed).toBe(rules.N);
    expect(view.epoch).toBe(1n);
    // The paid public path must actually have been exercised: at least one claim was sequenced
    // after the closing success, reverted there, and paid for it.
    const position = (r: { at?: [number, number] }) => (r.at?.[0] ?? 0) * 1_000_000 + (r.at?.[1] ?? 0);
    const closer = Math.max(...accepted.map(position));
    const mined = stale.filter((r) => r.reverted);
    expect(mined.length).toBeGreaterThan(0);
    for (const r of mined) {
      expect(r.fee).toBeGreaterThan(0n);
      expect(position(r)).toBeGreaterThan(closer);
    }
  }, 1_800_000);
});
