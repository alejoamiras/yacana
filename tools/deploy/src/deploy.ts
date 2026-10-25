// Deploys one profile of yacana.params.json: the token-less miner (its address depends only on
// class, salt, deployer and its constructor args), the token with `minter` = that address, the
// miner, then one bind_token. Fees go through the sponsored FPC; the deployer is an
// initializerless Schnorr account derived from YACANA_DEPLOYER_SECRET (never logged).
//   AZTEC_NODE_URL=… YACANA_DEPLOYER_SECRET=0x… YACANA_PORTAL=0x… [YACANA_LAUNCH_AT=<unix seconds>] \
//     [YACANA_CONTINUE_FROM=deployments/<source>.json] [YACANA_DEPLOY_SALT=0x…] [YACANA_DEPLOY_FORCE=1] \
//     bun tools/deploy/src/deploy.ts

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TokenContract } from '@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Contract, getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { deriveMasterMessageSigningSecretKey } from '@aztec-labs/stdlib/keys';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import type { BridgeRecord, LifecycleRecord, MigrationRecord } from '@yacana/bridge/record';
import { PARAMS, PROFILE } from '@yacana/miner-core/generated/params';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import { carriedBridge } from './bridge-block.ts';

const repo = resolve(import.meta.dir, '../../..');

/** What the L1 deploy script records: the Ethereum side of one profile's bridge. */
export type { BridgeRecord, LifecycleRecord, MigrationRecord } from '@yacana/bridge/record';

export interface Deployment {
  profile: string;
  chainId: string;
  nodeUrl: string;
  deployer: string;
  miner: string;
  token: string;
  /** For checking an announcement: the class ids the instances were deployed from, and the rollup. */
  minerClassId: string;
  tokenClassId: string;
  rollupVersion: string;
  /** The L1 rollup contract; with the chain id and the version it names the network a node must serve. */
  rollupAddress: string;
  minerSalt: string;
  tokenSalt: string;
  params: Record<string, string | number>;
  /**
   * genesis().launch_at as the chain normalised it (a constructor argument of 0 becomes the deploy
   * block's time), so it is not the constructor argument that predicts the address.
   */
  launchAt: string;
  /** Set when this deployment launched at once (launchAt 0): the first epoch's opened_at. */
  launchedAt?: string;
  deployedAt: string;
  /** The Ethereum portal this miner trusts (records before the bridge have none). */
  portal?: string;
  /**
   * A continuation of an earlier version: the epoch it starts at (the source's last + 1) and the
   * source's last seed, both public on the source, so anyone can check the announcement.
   */
  continuation?: { firstEpoch: string; sourceSeed: string; sourceTarget: string; source: string };
  /** Written by the L1 deploy script once the portal exists on this record's chain. */
  bridge?: BridgeRecord;
  /** Present from the announcement of the next version to this version's retirement. */
  migration?: MigrationRecord;
  /** Noted after the flip by `note-stop` / `retire-node`; the old origin's build reads it. */
  lifecycle?: LifecycleRecord;
}

export interface DeployOverrides {
  /** Tests mine at an easy target; real deployments always take the profile's value. */
  initialTarget?: bigint;
  /** Unix seconds; announce the deployment before it. 0 launches at once (the deployer calls launch()). */
  launchAt?: bigint;
  /** The portal on Ethereum; the constructor refuses zero. */
  portal?: EthAddress;
  /** Continue an earlier version's schedule instead of running the launch lottery: its first
   *  epoch, the source's last seed and the source's last target, so difficulty carries over. */
  continuation?: { firstEpoch: bigint; sourceSeed: Fr; sourceTarget: bigint; source: string };
}

// The record must describe what is on chain, not what the local artifact was compiled with.
async function verifyOnChain(
  miner: Contract,
  token: Contract,
  from: AztecAddress,
  initialTarget: bigint,
  launched: boolean,
  bridge: { portal: EthAddress; firstEpoch: bigint; seed: Fr },
): Promise<{ launchAt: bigint; openedAt?: bigint }> {
  const read = async <T>(p: Promise<unknown>) => ((await p) as { result: T }).result;
  const [n, expected, tMax, reward, ttl] = await read<bigint[]>(miner.methods.constants().simulate({ from }));
  const genesis = await read<{ target: bigint; seed: bigint; launch_at: bigint }>(
    miner.methods.genesis().simulate({ from }),
  );
  const minter = await read<{ toString(): string }>(token.methods.get_minter().simulate({ from }));
  const bound = await read<{ toString(): string }>(miner.methods.bound_token().simulate({ from }));
  const [portal, firstEpoch] = await read<[{ toString(): string }, bigint]>(
    miner.methods.bridge_state().simulate({ from }),
  );
  const mismatches = [
    [n, BigInt(PARAMS.N), 'N'],
    [expected, PARAMS.EXPECTED_EPOCH_SECONDS, 'EXPECTED_EPOCH_SECONDS'],
    [tMax, PARAMS.T_MAX, 'T_MAX'],
    [reward, PARAMS.REWARD, 'REWARD'],
    [ttl, PARAMS.CLAIM_TTL_SECONDS, 'CLAIM_TTL_SECONDS'],
    [genesis.target, initialTarget, 'INITIAL_TARGET'],
    [genesis.seed, bridge.seed.toBigInt(), 'GENESIS_SEED'],
    [firstEpoch, bridge.firstEpoch, 'FIRST_EPOCH'],
  ].filter(([onChain, local]) => onChain !== local);
  if (mismatches.length)
    throw new Error(
      `deployed contract disagrees with the generated params: ${mismatches.map((m) => m[2]).join(', ')}`,
    );
  if (minter.toString() !== miner.address.toString()) throw new Error('token minter is not the miner');
  if (bound.toString() !== token.address.toString()) throw new Error('the miner bound a different token');
  if (portal.toString() !== bridge.portal.toString()) throw new Error('the miner trusts a different portal');
  if (!launched) return { launchAt: genesis.launch_at };
  const first = await read<{ target: bigint; opened_at: bigint }>(
    miner.methods.epoch_params(bridge.firstEpoch).simulate({ from }),
  );
  if (first.target !== genesis.target) throw new Error('the first epoch opened with a different target');
  return { launchAt: genesis.launch_at, openedAt: first.opened_at };
}

export async function deployYacana(
  nodeUrl: string,
  deployerSecret: Fr,
  salt = Fr.random(),
  overrides: DeployOverrides = {},
): Promise<Deployment> {
  const wallet = await EmbeddedWallet.create(nodeUrl, {
    ephemeral: true,
    pxe: { proverEnabled: true },
    nodeClientOptions: { maxBatchSize: NODE_MAX_BATCH },
  });
  try {
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(SPONSORED_FPC_SALT),
    });
    await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) };
    // Fixed account salt: the same secret always yields the same deployer address.
    const deployer = (
      await wallet.createSchnorrInitializerlessAccount(
        deployerSecret,
        Fr.ZERO,
        deriveMasterMessageSigningSecretKey(deployerSecret),
      )
    ).address;
    const minerArtifact = loadContractArtifact(
      await Bun.file(resolve(repo, 'protocol/contracts/target/yacana_miner-YacanaMiner.json')).json(),
    );
    const portal = overrides.portal;
    if (!portal || portal.isZero()) throw new Error('a portal address is required (the miner refuses zero)');
    // A continuation carries the source's last seed where a genesis carries the profile's.
    const seed = overrides.continuation?.sourceSeed ?? new Fr(PARAMS.GENESIS_SEED);
    const firstEpoch = overrides.continuation?.firstEpoch ?? 0n;
    if (overrides.continuation && firstEpoch === 0n) throw new Error('a continuation starts after epoch 0');
    // A continuation opens at the source's last target: the schedule continues, difficulty included.
    const target = overrides.continuation?.sourceTarget ?? overrides.initialTarget ?? PARAMS.INITIAL_TARGET;
    const minerDeploy = Contract.deploy(
      wallet,
      minerArtifact,
      [target, seed, overrides.launchAt ?? 0n, firstEpoch, portal],
      'constructor',
      { deployer, salt },
    );
    const predicted = (await minerDeploy.getInstance()).address;
    const tokenSalt = Fr.random();
    const { contract: token, instance: tokenInstance } = await TokenContract.deployWithOpts(
      { method: 'constructor_with_minter', wallet, instantiation: { deployer, salt: tokenSalt } },
      PARAMS.TOKEN_NAME,
      PARAMS.TOKEN_SYMBOL,
      PARAMS.DECIMALS,
      predicted,
      AztecAddress.ZERO,
    ).send({ from: deployer, fee, wait: { timeout: 600 } });
    const { contract: miner, instance: minerInstance } = await minerDeploy.send({
      from: deployer,
      fee,
      wait: { timeout: 600 },
    });
    if (!miner.address.equals(predicted))
      throw new Error('deployed miner address differs from the precomputed one');
    await miner.methods.bind_token(token.address).send({ from: deployer, fee, wait: { timeout: 600 } });
    // An announced launch is opened later by whoever calls launch() (scripts/launch.ts).
    const launchNow = (overrides.launchAt ?? 0n) === 0n;
    if (launchNow) await miner.methods.launch().send({ from: deployer, fee, wait: { timeout: 600 } });
    const launch = await verifyOnChain(miner, token, deployer, target, launchNow, {
      portal,
      firstEpoch,
      seed,
    });
    const info = await createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH }).getNodeInfo();
    return {
      profile: PROFILE,
      chainId: String(info.l1ChainId),
      // Origin only: a node URL can carry a provider API key in its path.
      nodeUrl: new URL(nodeUrl).origin,
      deployer: deployer.toString(),
      miner: miner.address.toString(),
      token: token.address.toString(),
      minerClassId: minerInstance.currentContractClassId.toString(),
      tokenClassId: tokenInstance.currentContractClassId.toString(),
      rollupVersion: String(info.rollupVersion),
      rollupAddress: info.l1ContractAddresses.rollupAddress.toString(),
      minerSalt: salt.toString(),
      tokenSalt: tokenSalt.toString(),
      params: Object.fromEntries(
        Object.entries(PARAMS).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
      ),
      launchAt: launch.launchAt.toString(),
      ...(launch.openedAt === undefined ? {} : { launchedAt: launch.openedAt.toString() }),
      deployedAt: new Date().toISOString(),
      ...bridgeRecord(portal, firstEpoch, seed, target, overrides.continuation?.source),
    };
  } finally {
    await wallet.stop().catch(() => {});
  }
}

const bridgeRecord = (
  portal: EthAddress,
  firstEpoch: bigint,
  seed: Fr,
  target: bigint,
  source: string | undefined,
): Pick<Deployment, 'portal' | 'continuation'> => ({
  portal: portal.toString(),
  ...(source === undefined
    ? {}
    : {
        continuation: {
          firstEpoch: firstEpoch.toString(),
          sourceSeed: seed.toString(),
          sourceTarget: target.toString(),
          source,
        },
      }),
});

/**
 * What a continuation needs from its source: the source record names the node and the miner, and
 * the miner's last epoch and its seed are read from the source chain's public storage. The
 * source's node must still answer; once it is gone, the announced values are passed by hand
 * (YACANA_CONTINUE_FIRST_EPOCH + YACANA_CONTINUE_SEED + YACANA_CONTINUE_TARGET), taken as given:
 * checking them against the announcement is the operator's, not this script's.
 */
export async function continuationOf(
  sourceRecord: string,
): Promise<NonNullable<DeployOverrides['continuation']>> {
  const source = (await Bun.file(resolve(repo, sourceRecord)).json()) as Deployment;
  const first = process.env.YACANA_CONTINUE_FIRST_EPOCH;
  const seed = process.env.YACANA_CONTINUE_SEED;
  const target = process.env.YACANA_CONTINUE_TARGET;
  if (first && seed && target) {
    return {
      firstEpoch: BigInt(first),
      sourceSeed: Fr.fromString(seed),
      sourceTarget: BigInt(target),
      source: sourceRecord,
    };
  }
  if (first || seed || target)
    throw new Error(
      'YACANA_CONTINUE_FIRST_EPOCH, YACANA_CONTINUE_SEED and YACANA_CONTINUE_TARGET go together',
    );
  // The source's open epoch and its seed, straight from its public storage through the read path.
  const { readEpochs, readOpenEpochNumber } = await import('@yacana/miner-core/reader');
  const { deriveSlotTable, loadLayouts } = await import('@yacana/miner-core/slots');
  const node = createAztecNodeClient(source.nodeUrl, { maxBatchSize: NODE_MAX_BATCH });
  const miner = AztecAddress.fromStringUnsafe(source.miner);
  const layout = (await loadLayouts()).miner;
  const last = await readOpenEpochNumber(node, miner, layout);
  const load = (chunk: number) => deriveSlotTable(layout, chunk);
  const [row] = await readEpochs(node, miner, { from: last, to: last }, load, { withSeed: true });
  if (row?.seed === undefined) throw new Error(`could not read epoch ${last} of the source miner`);
  return {
    firstEpoch: BigInt(last) + 1n,
    sourceSeed: new Fr(row.seed),
    sourceTarget: row.target,
    source: sourceRecord,
  };
}

/** A fixed, non-zero portal for local runs that never touch Ethereum; the miner refuses zero. */
export const TEST_PORTAL = EthAddress.fromString('0x000000000000000000000000000000000000beef');

if (import.meta.main) {
  const nodeUrl = process.env.AZTEC_NODE_URL;
  const secret = process.env.YACANA_DEPLOYER_SECRET;
  if (!nodeUrl || !secret) throw new Error('AZTEC_NODE_URL and YACANA_DEPLOYER_SECRET are required');
  // Validated and reduced here: the field constructors throw messages that echo their input, and
  // a 32-byte key can exceed the field modulus. Any 1–32-byte hex value maps to one deployer.
  if (!/^(0x)?[0-9a-fA-F]{1,64}$/.test(secret))
    throw new Error('YACANA_DEPLOYER_SECRET must be hex, at most 32 bytes');
  const deployerSecret = Fr.fromBufferReduce(Buffer.from(secret.replace(/^0x/, '').padStart(64, '0'), 'hex'));
  const salt = process.env.YACANA_DEPLOY_SALT ? Fr.fromString(process.env.YACANA_DEPLOY_SALT) : Fr.random();
  const dir = resolve(repo, 'deployments');
  const file = resolve(dir, `${PROFILE}.json`);
  const source = process.env.YACANA_CONTINUE_FROM;
  if (source && resolve(repo, source) === file)
    throw new Error(
      `${source} is where this deploy writes: move the source record aside first (docs/upgrades.md)`,
    );
  if ((await Bun.file(file).exists()) && process.env.YACANA_DEPLOY_FORCE !== '1')
    throw new Error(
      `${file} already records a ${PROFILE} deployment; set YACANA_DEPLOY_FORCE=1 to replace it`,
    );
  const launchAt = BigInt(process.env.YACANA_LAUNCH_AT ?? '0');
  if (launchAt < 0n || launchAt >= 1n << 63n) throw new Error('YACANA_LAUNCH_AT must be unix seconds');
  if (!process.env.YACANA_PORTAL) throw new Error('YACANA_PORTAL (the Ethereum portal address) is required');
  const portal = EthAddress.fromString(process.env.YACANA_PORTAL);
  // A continuation names its source deployment record; the first epoch and seed are read from it.
  const continuation = process.env.YACANA_CONTINUE_FROM
    ? await continuationOf(process.env.YACANA_CONTINUE_FROM)
    : undefined;
  // The bridge block is settled before anything is spent: a mismatch refuses the deploy.
  const side = resolve(dir, `${PROFILE}.bridge.json`);
  const bridge = carriedBridge(portal.toString(), [
    ...(source
      ? [{ from: source, bridge: ((await Bun.file(resolve(repo, source)).json()) as Deployment).bridge }]
      : []),
    ...((await Bun.file(side).exists())
      ? [
          {
            from: `deployments/${PROFILE}.bridge.json`,
            bridge: (await Bun.file(side).json()) as BridgeRecord,
          },
        ]
      : []),
  ]);
  const deployment = await deployYacana(nodeUrl, deployerSecret, salt, { launchAt, portal, continuation });
  mkdirSync(dir, { recursive: true });
  await Bun.write(file, `${JSON.stringify({ ...deployment, ...(bridge ? { bridge } : {}) }, null, 2)}\n`);
  console.log(
    `deployed ${PROFILE}: miner ${deployment.miner}, token ${deployment.token} → ${file}${bridge ? ' (with its bridge block)' : ''}`,
  );
}
