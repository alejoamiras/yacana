// A second miner for the lost-race spec: claims in the open epoch from a fresh account until that
// epoch closes — or until YACANA_BURST_CLAIMS claims landed — with the native bb backend. Prints one
// JSON line per event; exits 0.
//   AZTEC_NODE_URL=… YACANA_MINER=0x… YACANA_TOKEN=0x… [YACANA_BURST_CLAIMS=2] bun apps/web-miner/e2e/burst.ts
import { cpus } from 'node:os';
import { TokenContract } from '@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js';
import { BackendType, Barretenberg } from '@aztec-foundation/bb.js';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Contract, getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { deriveMasterMessageSigningSecretKey } from '@aztec-labs/stdlib/keys';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import { loadMinerArtifact, loadWorkArtifact } from '@yacana/miner-core/artifacts';
import { buildClaim, claimGasLimits } from '@yacana/miner-core/claim';
import { readOpenEpoch } from '@yacana/miner-core/epoch';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { mineEpoch } from '@yacana/miner-core/miner';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import { deployDomain } from '@yacana/miner-core/proof';
import { newEpochSecret } from '@yacana/miner-core/secret';
import { BbJsWorkProver } from '@yacana/miner-core/work';

const nodeUrl = process.env.AZTEC_NODE_URL;
const minerAddress = process.env.YACANA_MINER;
const tokenAddress = process.env.YACANA_TOKEN;
if (!nodeUrl || !minerAddress || !tokenAddress)
  throw new Error('AZTEC_NODE_URL, YACANA_MINER and YACANA_TOKEN are required');
const say = (o: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

const node = createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH });
const wallet = await EmbeddedWallet.create(nodeUrl, {
  ephemeral: true,
  pxe: { proverEnabled: true },
  nodeClientOptions: { maxBatchSize: NODE_MAX_BATCH },
});
const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
  salt: new Fr(SPONSORED_FPC_SALT),
});
await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
const fee = {
  paymentMethod: new SponsoredFeePaymentMethod(fpc.address),
  gasSettings: { gasLimits: await claimGasLimits(node) },
};
const secret = Fr.random();
const from = (
  await wallet.createSchnorrInitializerlessAccount(
    secret,
    Fr.ZERO,
    deriveMasterMessageSigningSecretKey(secret),
  )
).address;
// The claim's nested mint needs the token known to the PXE as well.
const minerArtifact = await loadMinerArtifact();
for (const [address, artifact] of [
  [minerAddress, minerArtifact],
  [tokenAddress, TokenContract.artifact],
] as const) {
  const at = AztecAddress.fromStringUnsafe(address);
  const instance = await node.getContract(at);
  if (!instance) throw new Error(`${address} is not on the node`);
  await wallet.registerContract(instance, artifact);
}
const miner = Contract.at(AztecAddress.fromStringUnsafe(minerAddress), minerArtifact, wallet);
const chainId = BigInt(await node.getChainId());
const rollupVersion = BigInt((await node.getNodeInfo()).rollupVersion);
const domain = await deployDomain(chainId, rollupVersion, miner.address.toField(), PARAMS.VERSION);

const threads = Math.max(1, Math.min(4, cpus().length - 2));
const api = await Barretenberg.new({ threads, backend: BackendType.NativeUnixSocket }).catch(() =>
  Barretenberg.new({ threads, backend: BackendType.WasmWorker }),
);
const prover = new BbJsWorkProver(await loadWorkArtifact(), api);
const start = await readOpenEpoch(miner, from);
const maxClaims = Number(process.env.YACANA_BURST_CLAIMS ?? Number.POSITIVE_INFINITY);
say({ event: 'start', epoch: start.epoch.toString(), claims: start.claims, account: from.toString() });
try {
  let nonce = 1n;
  let landed = 0;
  for (;;) {
    const view = await readOpenEpoch(miner, from);
    if (view.epoch !== start.epoch || landed >= maxClaims) break;
    const epochSecret = newEpochSecret();
    const winner = await mineEpoch(prover, {
      domain,
      seed: new Fr(view.params.seed),
      epoch: view.epoch,
      secret: epochSecret,
      recipient: from.toField(),
      target: view.params.target,
      startNonce: nonce,
    });
    if (!winner) break;
    nonce = winner.nonce + 1n;
    const t0 = Date.now();
    const sent = await buildClaim(miner, {
      epoch: view.epoch,
      nonce: winner.nonce,
      out: winner.out,
      secret: epochSecret,
      proofFields: winner.proofFields,
      recipient: from,
    }).send({ from, fee, wait: { timeout: 600, dontThrowOnRevert: true } });
    const receipt = (sent as { receipt?: { executionResult?: string; blockNumber?: number } }).receipt;
    if (receipt?.executionResult === 'success') landed += 1;
    say({
      event: receipt?.executionResult === 'success' ? 'claim' : 'reverted',
      epoch: view.epoch.toString(),
      block: receipt?.blockNumber,
      ms: Date.now() - t0,
    });
  }
  const open = (await readOpenEpoch(miner, from)).epoch.toString();
  say({
    event: open === start.epoch.toString() ? 'stopped' : 'closed',
    epoch: start.epoch.toString(),
    open,
    landed,
  });
} finally {
  await api.destroy().catch(() => {});
  await wallet.stop().catch(() => {});
}
process.exit(0);
