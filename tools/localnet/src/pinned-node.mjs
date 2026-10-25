#!/usr/bin/env node
// A node pinned to one rollup version on an L1 that already exists, with everything the local
// network gives its own node — the automine sequencer on a settable clock, synthetic epoch
// settlement, no proof verification, the debug and admin APIs — minus the deployment
// `aztec start --local-network` insists on, and minus p2p, which this toolchain's libp2p cannot
// even bind (its mafmt and libp2p resolve different multiaddr copies). Resolved against the pinned
// toolchain's own packages and run by the same `node`, so it runs exactly what the toolchain runs.
//
// Environment: the node's usual (ETHEREUM_HOSTS, L1_CHAIN_ID, REGISTRY_CONTRACT_ADDRESS,
// ROLLUP_VERSION, DATA_DIRECTORY, WS_DATA_DIRECTORY, AZTEC_MANA_TARGET, LOG_LEVEL, …) plus
// AZTEC_TOOLCHAIN_ROOT (and AZTEC_VERSION, which it must match), PINNED_NODE_PORT,
// PINNED_NODE_ADMIN_PORT, PREFUND_ADDRESSES (the genesis, in order), MNEMONIC (the validator +
// publisher, anvil's first account) and AUTOMINE_ENABLE_PROVE_EPOCH.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = process.env.AZTEC_TOOLCHAIN_ROOT;
if (!root) throw new Error('AZTEC_TOOLCHAIN_ROOT is not set');
const packageJson = join(root, 'node_modules', '@aztec-labs', 'aztec', 'package.json');
const require = createRequire(packageJson);
const load = (spec) => import(require.resolve(spec));
const toolchainVersion = JSON.parse(readFileSync(packageJson, 'utf8')).version;
if (process.env.AZTEC_VERSION && toolchainVersion !== process.env.AZTEC_VERSION)
  throw new Error(
    `the toolchain at ${root} is @aztec-labs/aztec ${toolchainVersion}, not the pinned ${process.env.AZTEC_VERSION}`,
  );

const [
  { getConfigEnvVars },
  { createAztecNodeService, registerAztecNodeRpcHandlers },
  { createNamespacedSafeJsonRpcServer, startHttpRpcServer },
  { TestDateProvider },
  { SecretValue },
  { EthAddress },
  { AztecAddress },
  { getGenesisValues },
  { createBlobClient },
  { getConfigEnvVars: getTelemetryClientConfig, initTelemetryClient },
  { mnemonicToAccount, privateKeyToAddress },
  { BarretenbergSync },
  { RegistryContract, RollupContract },
  { getPublicClient },
] = await Promise.all([
  load('@aztec-labs/aztec-node/config'),
  load('@aztec-labs/aztec-node'),
  load('@aztec-labs/foundation/json-rpc/server'),
  load('@aztec-labs/foundation/timer'),
  load('@aztec-labs/foundation/config'),
  load('@aztec-labs/foundation/eth-address'),
  load('@aztec-labs/stdlib/aztec-address'),
  load('@aztec-labs/world-state/testing'),
  load('@aztec-labs/blob-client/client'),
  load('@aztec-labs/telemetry-client'),
  load('viem/accounts'),
  load('@aztec-foundation/bb.js'),
  load('@aztec-labs/ethereum/contracts'),
  load('@aztec-labs/ethereum/client'),
]);

const mnemonic = process.env.MNEMONIC ?? 'test test test test test test test test test test test junk';
const key = `0x${Buffer.from(mnemonicToAccount(mnemonic).getHdKey().privateKey).toString('hex')}`;
const config = {
  ...getConfigEnvVars(),
  // The test key below is the node's only signer and no prover node runs beside it: a key store,
  // remote signer or prover switch in the ambient environment must not reach this node.
  keyStoreDirectory: undefined,
  web3SignerUrl: undefined,
  enableProverNode: false,
  useAutomineSequencer: true,
  automineEnableProveEpoch: process.env.AUTOMINE_ENABLE_PROVE_EPOCH !== '0',
  realProofs: false,
  p2pEnabled: false,
  sequencerPublisherPrivateKeys: [new SecretValue(key)],
  validatorPrivateKeys: new SecretValue([key]),
  coinbase: EthAddress.fromString(privateKeyToAddress(key)),
  allowEphemeralSigningProtection: true,
};
// The node checks its timing against the rollup and builds its epoch cache from it: take the
// rollup's own values rather than the environment's defaults.
const publicClient = getPublicClient({ l1RpcUrls: config.l1RpcUrls, l1ChainId: config.l1ChainId });
const { rollupAddress } = await RegistryContract.collectAddresses(
  publicClient,
  config.registryAddress,
  config.rollupVersion,
);
const rollup = new RollupContract(publicClient, rollupAddress.toString());
const [slotDuration, epochDuration, proofSubmissionEpochs] = await Promise.all([
  rollup.getSlotDuration(),
  rollup.getEpochDuration(),
  rollup.getProofSubmissionEpochs(),
]);
Object.assign(config, {
  aztecSlotDuration: Number(slotDuration),
  aztecEpochDuration: Number(epochDuration),
  aztecProofSubmissionEpochs: Number(proofSubmissionEpochs),
});

const prefund = (process.env.PREFUND_ADDRESSES ?? '')
  .split(',')
  .filter((a) => a.length > 0)
  .map((a) => AztecAddress.fromStringUnsafe(a));
const { genesis, genesisArchiveRoot } = await getGenesisValues(prefund);
console.log(`Genesis archive root: ${genesisArchiveRoot}`);

const telemetry = await initTelemetryClient(getTelemetryClientConfig());
const node = await createAztecNodeService(
  config,
  { telemetry, blobClient: createBlobClient(), dateProvider: new TestDateProvider(), proverNodeDeps: {} },
  { genesis },
);
const services = {};
const adminServices = {};
registerAztecNodeRpcHandlers(node, services, adminServices, { debug: true });
// The RPC schema may decompress a Chonk proof before the handler runs.
await BarretenbergSync.initSingleton();
// Loopback only: the debug and admin APIs (a settable clock, a forced prove) take no key.
const { port } = await startHttpRpcServer(
  createNamespacedSafeJsonRpcServer(services, { http200OnError: false }),
  { host: '127.0.0.1', port: Number(process.env.PINNED_NODE_PORT) },
);
const admin = await startHttpRpcServer(
  createNamespacedSafeJsonRpcServer(adminServices, { http200OnError: false }),
  { host: '127.0.0.1', port: Number(process.env.PINNED_NODE_ADMIN_PORT) },
);
console.log(`Pinned node listening on ${port} (admin ${admin.port}), rollup version ${config.rollupVersion}`);

const stop = () => {
  node
    .stop()
    .catch(() => {})
    .finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
