// The upgrade rig: a rollup upgrade on the isolated local network, driven programmatically. It
// owns the whole lifecycle — the network, the second (and third) rollup, the governance vote that
// flips the Registry, the pinned node that follows a chosen version — and it moves L1 time only the
// way the network allows: while an automine node runs, that node owns the L1 clock and every warp
// goes through its debug API; anvil's own cheat codes are touched only when no node is alive.
//
//   const rig = await startUpgradeRig();  …  await rig.teardown();
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GovernanceAbi } from '@aztec-foundation/l1-artifacts/GovernanceAbi';
import { RegisterNewRollupVersionPayloadAbi } from '@aztec-foundation/l1-artifacts/RegisterNewRollupVersionPayloadAbi';
import { RegisterNewRollupVersionPayloadBytecode } from '@aztec-foundation/l1-artifacts/RegisterNewRollupVersionPayloadBytecode';
import { RollupAbi } from '@aztec-foundation/l1-artifacts/RollupAbi';
import { TestERC20Abi } from '@aztec-foundation/l1-artifacts/TestERC20Abi';
import { getInitialTestAccountsData } from '@aztec-labs/accounts/testing';
import { getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { createExtendedL1Client, getPublicClient } from '@aztec-labs/ethereum/client';
import { getL1ContractsConfigEnvVars } from '@aztec-labs/ethereum/config';
import { RegistryContract, RollupContract } from '@aztec-labs/ethereum/contracts';
import { deployRollupForUpgrade } from '@aztec-labs/ethereum/deploy-aztec-l1-contracts';
import { deployL1Contract } from '@aztec-labs/ethereum/deploy-l1-contract';
import type { L1ContractAddresses } from '@aztec-labs/ethereum/l1-contract-addresses';
import { getL1ContractsConfig } from '@aztec-labs/ethereum/queries';
import type { ExtendedViemWalletClient, ViemPublicClient } from '@aztec-labs/ethereum/types';
import { CheckpointNumber } from '@aztec-labs/foundation/branded-types';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { EthAddress } from '@aztec-labs/foundation/eth-address';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { getVKTreeRoot } from '@aztec-labs/noir-protocol-circuits-types/vk-tree';
import { protocolContractsHash } from '@aztec-labs/protocol-contracts';
import { createAztecNodeAdminClient, createAztecNodeDebugClient } from '@aztec-labs/stdlib/interfaces/client';
import { getGenesisValues } from '@aztec-labs/world-state/testing';
import { getContract, type Hex, parseEventLogs } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { type IsolatedNode, startIsolatedNode } from './isolated-node.ts';
import { lanePortBase, runPortWindowBase } from './port-window.ts';
import { claim, release } from './registry.ts';
import { jsonRpcReady, killOwned, type Owned, repoRoot, spawnDetached, toolchainBin } from './toolchain.ts';

/** The local network's deployer and V5 publisher (anvil's mnemonic, index 0). Never reused by the rig. */
const NETWORK_MNEMONIC = 'test test test test test test test test test test test junk';
/** Anvil account 1: the rig's own signer, so its transactions never race the V5 publisher's nonces. */
const RIG_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
/** The deposit behind the vote: the proposal's lock (1e24 locally) plus as much again to vote with. */
const VOTE_STAKE = 2n * 10n ** 24n;

export interface RigNode {
  version: bigint;
  nodeUrl: string;
  adminUrl: string;
  stop: () => Promise<void>;
  debug: ReturnType<typeof createAztecNodeDebugClient>;
  admin: ReturnType<typeof createAztecNodeAdminClient>;
}

export interface RigVersion {
  version: bigint;
  rollup: EthAddress;
  inbox: EthAddress;
  outbox: EthAddress;
  registryIndex: number;
  manaTarget: bigint;
}

export interface WarpRecord {
  version: bigint;
  seconds: number;
  /** Slots left before the pending chain would be pruned; `null` when nothing was pending. */
  headroomSlots: number | null;
}

export interface UpgradeRig {
  l1RpcUrl: string;
  /** The run's directory under .localnet: data dirs, and whatever a case writes for the run. */
  runRoot: string;
  registry: EthAddress;
  publicClient: ViemPublicClient;
  /** The rig's own L1 signer (a viem account) and its private key for helpers that take one. */
  signer: ReturnType<typeof privateKeyToAccount>;
  signerKey: Hex;
  /** The genesis archive root every rollup the rig deploys is constructed with (the pinned node's formula). */
  genesisRoot: Fr;
  versions: RigVersion[];
  /** The one automine node currently alive, if any; the rig keeps at most one. */
  node?: RigNode;
  /** A new rollup with the canonical's config and one change: `manaTarget + bump`. Not yet canonical. */
  deployNext(opts?: { bump?: bigint }): Promise<RigVersion>;
  /** Governance makes `next` canonical: propose, vote, execute, with the vote spread over five slots. */
  flip(next: RigVersion): Promise<void>;
  /** Stops the live node (pausing its sequencer first); anvil and the run dir stay. */
  stopNode(): Promise<void>;
  /** A node pinned to `version`, automine, settling on its own unless `autoProve: false`. */
  startNode(version: RigVersion, opts?: { autoProve?: boolean }): Promise<RigNode>;
  /** Every warp through a node, with the proof-window headroom the live version had afterwards. */
  warps: WarpRecord[];
  /** Moves the L1 clock: through the live node when one runs, through anvil otherwise. */
  warpBy(seconds: number): Promise<void>;
  /** Settles the live node up to its latest checkpoint (the debug prove). */
  prove(): Promise<void>;
  /**
   * Publishes `checkpoints` more checkpoints on the live node, one slot each: what a message sent
   * into the Inbox needs before the node serves it as consumable (three, by the Inbox's lag).
   */
  nudge(checkpoints?: number): Promise<void>;
  /** Prunes `version`'s unproven checkpoints once its proof window has passed; false when it has not. */
  prune(version: RigVersion): Promise<boolean>;
  teardown(): Promise<void>;
}

interface Genesis {
  root: Fr;
  /** What the new FeeJuicePortal must hold so the genesis-funded accounts are backed. */
  fundingNeeded: bigint;
  env: Record<string, string>;
}

/** Everything the rig's operations share; the public `UpgradeRig` is a view over it. */
interface RigContext {
  network: IsolatedNode;
  addresses: L1ContractAddresses;
  chainId: number;
  publicClient: ViemPublicClient;
  rigClient: ExtendedViemWalletClient;
  deployerClient: ExtendedViemWalletClient;
  genesis: Genesis;
  verbose: boolean;
  versions: RigVersion[];
  /** Lanes 0–3 belong to the local network; each pinned node takes the next two. */
  laneOffset: number;
}

/** The pinned node's own genesis formula (test accounts + the sponsored FPC + prefund; no BananaFPC). */
async function pinnedGenesis(): Promise<Genesis> {
  const accounts = (await getInitialTestAccountsData()).map((a) => a.address);
  const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
  const funded = [...accounts, fpc.address];
  const { genesisArchiveRoot, fundingNeeded } = await getGenesisValues(funded);
  // The pinned node funds exactly PREFUND_ADDRESSES at genesis, in this order.
  const env = { PREFUND_ADDRESSES: funded.map(String).join(',') };
  return { root: genesisArchiveRoot, fundingNeeded, env };
}

/** Straight from the rollup: a version just deployed is not in the Registry yet. */
async function describeVersion(
  ctx: RigContext,
  rollupAddress: EthAddress,
  index: number,
): Promise<RigVersion> {
  const rollup = new RollupContract(ctx.publicClient, rollupAddress);
  const raw = getContract({
    address: rollupAddress.toString() as Hex,
    abi: RollupAbi,
    client: ctx.publicClient,
  });
  const [version, manaTarget, inbox, outbox] = await Promise.all([
    rollup.getVersion(),
    rollup.getManaTarget(),
    raw.read.getInbox(),
    raw.read.getOutbox(),
  ]);
  return {
    version,
    rollup: rollupAddress,
    inbox: EthAddress.fromString(inbox),
    outbox: EthAddress.fromString(outbox),
    registryIndex: index,
    manaTarget,
  };
}

async function deployNextVersion(ctx: RigContext, bump: bigint): Promise<RigVersion> {
  // @aztec-labs/ethereum looks for forge under ~/.aztec/current, ~/.foundry and PATH; the pinned
  // toolchain lives under ~/.aztec/versions/<pin> (the only one CI installs), so name it.
  process.env.FORGE_BIN ??= toolchainBin('aztec-forge');
  const canonical = ctx.versions[ctx.versions.length - 1] as RigVersion;
  const config = await getL1ContractsConfig(ctx.publicClient, {
    governanceAddress: ctx.addresses.governanceAddress,
    rollupAddress: canonical.rollup,
  });
  // The env defaults carry what the chain does not report (thresholds, slashing amounts); the
  // chain's values win for everything it does report; one field changes.
  const {
    l1StartBlock: _b,
    l1GenesisTime: _t,
    rollupVersion: _v,
    genesisArchiveTreeRoot: _g,
    ...onChain
  } = config;
  const registry = ctx.addresses.registryAddress;
  const { rollup } = await deployRollupForUpgrade(RIG_KEY, ctx.network.l1RpcUrl, ctx.chainId, registry, {
    ...getL1ContractsConfigEnvVars(),
    ...onChain,
    manaTarget: canonical.manaTarget + bump,
    vkTreeRoot: getVKTreeRoot(),
    protocolContractsHash,
    genesisArchiveRoot: ctx.genesis.root,
    aztecTargetCommitteeSize: 0,
    slasherEnabled: false,
    realVerifier: false,
    feeJuicePortalInitialBalance: ctx.genesis.fundingNeeded,
  });
  const next = await describeVersion(ctx, EthAddress.fromString(rollup.address), ctx.versions.length);
  ctx.versions.push(next);
  console.info(`deployed rollup version ${next.version} at ${next.rollup} (mana target ${next.manaTarget})`);
  return next;
}

/** One mint funds the rig's whole vote; the deposit locks it in Governance. */
async function stakeForVote(ctx: RigContext, node: RigNode | undefined, governanceAddress: Hex, voter: Hex) {
  const stakingAsset = ctx.addresses.stakingAssetAddress.toString() as Hex;
  const wait = (hash: Promise<Hex>) =>
    hash.then((h) => ctx.publicClient.waitForTransactionReceipt({ hash: h }));
  const token = getContract({ address: stakingAsset, abi: TestERC20Abi, client: ctx.deployerClient });
  // The minter is the network's deployer, the account the live sequencer publishes from: the mint
  // goes out under a paused sequencer so the two never race a nonce.
  await node?.admin.pauseSequencer();
  try {
    await wait(token.write.mint([voter, VOTE_STAKE]));
  } finally {
    await node?.admin.resumeSequencer();
  }
  const rigToken = getContract({ address: stakingAsset, abi: TestERC20Abi, client: ctx.rigClient });
  await wait(rigToken.write.approve([governanceAddress, VOTE_STAKE]));
  const governance = getContract({ address: governanceAddress, abi: GovernanceAbi, client: ctx.rigClient });
  await wait(governance.write.deposit([voter, VOTE_STAKE]));
}

async function flipVersion(ctx: RigContext, rig: UpgradeRig, next: RigVersion): Promise<void> {
  const governanceAddress = ctx.addresses.governanceAddress.toString() as Hex;
  const registry = ctx.addresses.registryAddress;
  const wait = (hash: Promise<Hex>) =>
    hash.then((h) => ctx.publicClient.waitForTransactionReceipt({ hash: h }));
  const { address: payload } = await deployL1Contract(
    ctx.rigClient,
    RegisterNewRollupVersionPayloadAbi,
    RegisterNewRollupVersionPayloadBytecode as Hex,
    [registry.toString(), next.rollup.toString()],
  );
  await stakeForVote(ctx, rig.node, governanceAddress, rig.signer.address);
  const governance = getContract({ address: governanceAddress, abi: GovernanceAbi, client: ctx.rigClient });
  const proposeReceipt = await wait(
    governance.write.proposeWithLock([payload.toString(), rig.signer.address]),
  );
  const [proposed] = parseEventLogs({ abi: GovernanceAbi, eventName: 'Proposed', logs: proposeReceipt.logs });
  if (!proposed) throw new Error('proposeWithLock emitted no Proposed event');
  const proposalId = (proposed.args as { proposalId: bigint }).proposalId;
  const proposal = await governance.read.getProposal([proposalId]);
  const now = () => ctx.publicClient.getBlock().then((b) => b.timestamp);
  const warpTo = async (target: bigint) => {
    const t = await now();
    if (target > t) await rig.warpBy(Number(target - t) + 1);
  };
  const votingOpens = proposal.creation + proposal.config.votingDelay;
  const votingCloses = votingOpens + proposal.config.votingDuration;
  await warpTo(votingOpens);
  const votedAt = await now();
  if (votedAt >= votingCloses)
    throw new Error(`the vote's block (${votedAt}) is past the window (${votingCloses})`);
  // proposeWithLock started a withdrawal of the lock amount: the power left is what can vote.
  const power = await governance.read.powerAt([rig.signer.address, votingOpens]);
  const { minimumVotes } = await governance.read.getConfiguration();
  if (power < minimumVotes) throw new Error(`voting power ${power} is under the minimum ${minimumVotes}`);
  await wait(governance.write.vote([proposalId, power, true]));
  await warpTo(votingCloses + proposal.config.executionDelay);
  await wait(governance.write.execute([proposalId]));
  const registryContract = new RegistryContract(ctx.publicClient, registry);
  const canonical = await registryContract.getCanonicalAddress();
  if (!canonical.equals(next.rollup))
    throw new Error(`the Registry's canonical is ${canonical}, expected ${next.rollup}`);
  const count = await registryContract.getNumberOfVersions();
  if (count !== ctx.versions.length)
    throw new Error(`the Registry holds ${count} versions, the rig knows ${ctx.versions.length}`);
  console.info(`flipped: version ${next.version} is canonical (index ${next.registryIndex})`);
}

interface NodePorts {
  runId: string;
  node: number;
  admin: number;
}

async function claimNodePorts(ctx: RigContext, version: RigVersion): Promise<NodePorts> {
  const runId = `${ctx.network.runId}-v${version.registryIndex}`;
  const windowBase = runPortWindowBase(ctx.network.runId);
  const lane = ctx.laneOffset;
  ctx.laneOffset += 2;
  const svc = (service: string, i: number) =>
    claim({
      runId,
      service,
      ownerPid: process.pid,
      worktree: repoRoot,
      base: lanePortBase(windowBase, lane + i, 8),
      span: 8,
    });
  const node = await svc('aztec', 0);
  try {
    return { runId, node, admin: await svc('aztecAdmin', 1) };
  } catch (e) {
    await release(runId).catch(() => {});
    throw e;
  }
}

async function startPinnedNode(ctx: RigContext, version: RigVersion, autoProve: boolean): Promise<RigNode> {
  const ports = await claimNodePorts(ctx, version);
  // One disposal for every way out — a stop by hand, the network's teardown, a failed start — so a
  // stale handle can never free the lanes a restarted node of the same version holds.
  let child: Owned | undefined;
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposed ??= (async () => {
      if (child) killOwned(child);
      await release(ports.runId).catch(() => {});
    })();
    return disposed;
  };
  let disown = (): void => {};
  const stop = async (): Promise<void> => {
    disown();
    await dispose();
  };
  const nodeUrl = `http://127.0.0.1:${ports.node}`;
  const adminUrl = `http://127.0.0.1:${ports.admin}`;
  try {
    const dataDir = join(ctx.network.runRoot, `node-v${version.registryIndex}`);
    mkdirSync(dataDir, { recursive: true });
    // The launcher is the local network's node without its deployment (see the file); it runs on
    // the toolchain's packages under the same `node` the aztec launcher uses.
    child = spawnDetached(
      `aztec-v${version.registryIndex}`,
      'node',
      [join(import.meta.dir, 'pinned-node.mjs')],
      {
        ...ctx.genesis.env,
        AZTEC_TOOLCHAIN_ROOT: join(toolchainBin('aztec'), '..', '..'),
        ETHEREUM_HOSTS: ctx.network.l1RpcUrl,
        L1_CHAIN_ID: String(ctx.chainId),
        REGISTRY_CONTRACT_ADDRESS: ctx.addresses.registryAddress.toString(),
        ROLLUP_VERSION: String(version.version),
        PINNED_NODE_PORT: String(ports.node),
        PINNED_NODE_ADMIN_PORT: String(ports.admin),
        DATA_DIRECTORY: dataDir,
        WS_DATA_DIRECTORY: join(dataDir, 'world-state'),
        TMPDIR: join(homedir(), '.cache', 'tmp'),
        AUTOMINE_ENABLE_PROVE_EPOCH: autoProve ? '1' : '0',
        AZTEC_MANA_TARGET: String(version.manaTarget),
        // Blocks every slot, txs or not, as the local network runs.
        SEQ_MIN_TX_PER_BLOCK: '0',
        MNEMONIC: NETWORK_MNEMONIC,
        // `bun test` runs with NODE_ENV=test, which the node's logger takes as "silent".
        LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
        // The launcher refuses a toolchain other than the pinned one.
        AZTEC_VERSION: aztecPin(),
      },
      ctx.verbose,
      join(ctx.network.logDir, `aztec-v${version.registryIndex}.log`),
    );
    // Dies with the network from here on: a teardown or a signal reaches it and frees its lanes.
    disown = ctx.network.adopt(child, dispose);
    await jsonRpcReady(nodeUrl, 'node_getNodeInfo', 240_000, child);
    const nodeInfo = await createAztecNodeClient(nodeUrl).getNodeInfo();
    if (BigInt(nodeInfo.rollupVersion) !== version.version)
      throw new Error(`the node follows version ${nodeInfo.rollupVersion}, expected ${version.version}`);
  } catch (e) {
    await stop();
    throw e;
  }
  return {
    version: version.version,
    nodeUrl,
    adminUrl,
    stop,
    debug: createAztecNodeDebugClient(nodeUrl),
    admin: createAztecNodeAdminClient(adminUrl),
  };
}

const aztecPin = (): string => readFileSync(join(repoRoot, '.aztecrc'), 'utf8').trim();

const anvilRpc = (url: string, method: string, params: unknown[]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

/**
 * Slots left before the live version prunes its pending chain: an epoch's proof must land within
 * `proofSubmissionEpochs` epochs after it ends, counted from the first unproven checkpoint.
 * `null` when nothing is pending.
 */
async function proofHeadroom(ctx: RigContext, live: RigVersion): Promise<number | null> {
  const rollup = new RollupContract(ctx.publicClient, live.rollup);
  const [pending, proven, slot] = await Promise.all([
    rollup.getCheckpointNumber(),
    rollup.getProvenCheckpointNumber(),
    rollup.getSlotNumber(),
  ]);
  if (pending <= proven) return null;
  const [firstUnprovenEpoch, window, epochDuration] = await Promise.all([
    rollup.getEpochNumberForCheckpoint(CheckpointNumber(Number(proven) + 1)),
    rollup.getProofSubmissionEpochs(),
    rollup.getEpochDuration(),
  ]);
  const deadlineSlot = (Number(firstUnprovenEpoch) + window + 1) * epochDuration;
  return deadlineSlot - Number(slot);
}

/**
 * Warps the live node's clock and records the proof headroom left afterwards. A warp that crossed
 * the proof deadline makes the sequencer's next propose prune the pending chain first — and the
 * new checkpoint can leave the tip where it was — so the Rollup's `PrunedPending` over the warp's
 * blocks is what says whether a prune happened.
 */
async function warpNodeBy(ctx: RigContext, rig: UpgradeRig, node: RigNode, seconds: number): Promise<void> {
  const live = ctx.versions.find((v) => v.version === node.version);
  // viem answers `getBlockNumber` from a four-second cache by default; a warp is faster than that.
  const fromBlock = (await ctx.publicClient.getBlockNumber({ cacheTime: 0 })) + 1n;
  await node.debug.warpL2TimeAtLeastBy(seconds);
  if (live) {
    const pruned = await ctx.publicClient.getContractEvents({
      address: live.rollup.toString() as Hex,
      abi: RollupAbi,
      eventName: 'PrunedPending',
      fromBlock,
      toBlock: await ctx.publicClient.getBlockNumber({ cacheTime: 0 }),
    });
    if (pruned.length > 0)
      throw new Error(
        `a ${seconds}s warp pruned version ${node.version}'s pending chain (${pruned.length} prune)`,
      );
  }
  const headroomSlots = live ? await proofHeadroom(ctx, live) : null;
  rig.warps.push({ version: node.version, seconds, headroomSlots });
  console.info(
    `warped ${seconds}s on version ${node.version}: proof headroom ${headroomSlots ?? 'none pending'} slots`,
  );
}

async function warpAnvilBy(ctx: RigContext, seconds: number): Promise<void> {
  const ts = (await ctx.publicClient.getBlock()).timestamp + BigInt(seconds);
  await anvilRpc(ctx.network.l1RpcUrl, 'evm_setNextBlockTimestamp', [Number(ts)]);
  await anvilRpc(ctx.network.l1RpcUrl, 'evm_mine', []);
}

export async function startUpgradeRig(
  opts: { votingDurationSeconds?: number; verbose?: boolean } = {},
): Promise<UpgradeRig> {
  const verbose = opts.verbose ?? process.env.YACANA_NODE_VERBOSE === '1';
  // Five 72 s slots: the node's warp rounds up to a slot boundary and publishes a checkpoint there,
  // so a one-minute window can close between the warp's landing and the vote's inclusion.
  const votingDuration = String(opts.votingDurationSeconds ?? 360);
  const network = await startIsolatedNode({
    env: { AZTEC_GOVERNANCE_VOTING_DURATION: votingDuration },
    verbose,
  });
  const info = await createAztecNodeClient(network.nodeUrl).getNodeInfo();
  const l1RpcUrl = network.l1RpcUrl;
  const ctx: RigContext = {
    network,
    addresses: info.l1ContractAddresses,
    chainId: info.l1ChainId,
    publicClient: getPublicClient({ l1RpcUrls: [l1RpcUrl], l1ChainId: info.l1ChainId }),
    rigClient: createExtendedL1Client([l1RpcUrl], RIG_KEY, foundry),
    deployerClient: createExtendedL1Client([l1RpcUrl], mnemonicToAccount(NETWORK_MNEMONIC), foundry),
    genesis: await pinnedGenesis(),
    verbose,
    versions: [],
    laneOffset: 4,
  };
  ctx.versions.push(await describeVersion(ctx, info.l1ContractAddresses.rollupAddress, 0));
  const rig: UpgradeRig = {
    l1RpcUrl,
    runRoot: network.runRoot,
    registry: info.l1ContractAddresses.registryAddress,
    publicClient: ctx.publicClient,
    signer: privateKeyToAccount(RIG_KEY),
    signerKey: RIG_KEY,
    genesisRoot: ctx.genesis.root,
    versions: ctx.versions,
    node: {
      version: ctx.versions[0]?.version as bigint,
      nodeUrl: network.nodeUrl,
      adminUrl: network.adminUrl,
      stop: async () => network.stopNode(),
      debug: createAztecNodeDebugClient(network.nodeUrl),
      admin: createAztecNodeAdminClient(network.adminUrl),
    },
    deployNext: ({ bump = 1n } = {}) => deployNextVersion(ctx, bump),
    flip: (next) => flipVersion(ctx, rig, next),
    async stopNode() {
      const node = rig.node;
      if (!node) return;
      await node.admin.pauseSequencer().catch(() => {});
      await node.stop();
      rig.node = undefined;
    },
    async startNode(version, { autoProve = true } = {}) {
      if (rig.node) throw new Error('one automine node at a time: stop the live one first');
      rig.node = await startPinnedNode(ctx, version, autoProve);
      return rig.node;
    },
    warps: [],
    warpBy: (seconds) => (rig.node ? warpNodeBy(ctx, rig, rig.node, seconds) : warpAnvilBy(ctx, seconds)),
    async prove() {
      if (!rig.node) throw new Error('no live node to settle');
      await rig.node.debug.prove();
    },
    async nudge(checkpoints = 4) {
      if (!rig.node) throw new Error('no live node to build on');
      // A message sent while checkpoint N is the tip goes into the Inbox tree of N+3 and is served
      // once the tip reaches it; a block within the same slot lands in the same checkpoint, a warp
      // lands on the next slot, so four warps cover it with one to spare.
      for (let i = 0; i < checkpoints; i++) await rig.warpBy(72);
    },
    async prune(version) {
      const rollup = getContract({
        address: version.rollup.toString() as Hex,
        abi: RollupAbi,
        client: ctx.rigClient,
      });
      const now = (await ctx.publicClient.getBlock()).timestamp;
      if (!(await rollup.read.canPruneAtTime([now]))) return false;
      await ctx.publicClient.waitForTransactionReceipt({ hash: await rollup.write.prune() });
      return true;
    },
    async teardown() {
      await rig.stopNode().catch(() => {});
      await network.teardown();
      rmSync(network.runRoot, { recursive: true, force: true });
    },
  };
  return rig;
}
