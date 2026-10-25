// The launch lottery of an announced deployment, from a throwaway account paying through the
// sponsored FPC. `commit` draws a secret preimage (kept in deployments/.launch-<profile>.json,
// gitignored) and commits Poseidon2(DOM_LAUNCH, 1, miner, account, preimage) before launch_at; `reveal` reveals it inside the window after
// launch_at; `open` calls launch() once the window has closed. Anyone may run any phase.
//   AZTEC_NODE_URL=… bun tools/deploy/scripts/launch.ts commit|reveal|open [deployments/<profile>.json]
import { resolve } from 'node:path';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Contract, getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { poseidon2Hash } from '@aztec-labs/foundation/crypto/poseidon';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { deriveMasterMessageSigningSecretKey } from '@aztec-labs/stdlib/keys';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import { PARAMS, PROFILE } from '@yacana/miner-core/generated/params';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import { DOM_LAUNCH } from '@yacana/miner-core/proof';
import type { Deployment } from '../src/deploy.ts';

const repo = resolve(import.meta.dir, '../../..');
const phase = process.argv[2];
if (phase !== 'commit' && phase !== 'reveal' && phase !== 'open')
  throw new Error('usage: launch.ts commit|reveal|open [deployment.json]');
const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is required');
const file = process.argv[3] ?? resolve(repo, `deployments/${PROFILE}.json`);
const deployment = (await Bun.file(file).json()) as Deployment;
// The account secret persists with the preimage: the reveal must come from the committing address.
const secretFile = resolve(repo, `deployments/.launch-${PROFILE}.json`);
type Secret = { account: string; preimage: string };
const unwrap = async <T>(p: Promise<unknown>): Promise<T> => ((await p) as { result: T }).result;

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
  const stored = (await Bun.file(secretFile).exists())
    ? ((await Bun.file(secretFile).json()) as Secret)
    : null;
  if (phase === 'commit' && stored)
    throw new Error(`${secretFile} exists: already committed from this machine`);
  if (phase === 'reveal' && !stored) throw new Error(`${secretFile} missing: nothing to reveal`);
  const secret: Secret = stored ?? { account: Fr.random().toString(), preimage: Fr.random().toString() };
  const accountSecret = Fr.fromString(secret.account);
  const from = (
    await wallet.createSchnorrInitializerlessAccount(
      accountSecret,
      Fr.ZERO,
      deriveMasterMessageSigningSecretKey(accountSecret),
    )
  ).address;
  const artifact = loadContractArtifact(
    await Bun.file(resolve(repo, 'protocol/contracts/target/yacana_miner-YacanaMiner.json')).json(),
  );
  const miner = await Contract.at(AztecAddress.fromStringUnsafe(deployment.miner), artifact, wallet);
  const genesis = await unwrap<{ launch_at: bigint }>(miner.methods.genesis().simulate({ from }));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const window = PARAMS.REVEAL_WINDOW_SECONDS;
  const send = (m: ReturnType<typeof miner.methods.launch>) => m.send({ from, fee, wait: { timeout: 600 } });
  if (phase === 'commit') {
    if (now >= genesis.launch_at) throw new Error(`commit phase ended at ${genesis.launch_at}`);
    // Tag 1 is the commitment; the contract folds tag 2 (the hidden contribution) on reveal.
    const commitment = await poseidon2Hash([
      new Fr(DOM_LAUNCH),
      new Fr(1n),
      miner.address.toField(),
      from.toField(),
      Fr.fromString(secret.preimage),
    ]);
    await send(miner.methods.commit_launch(commitment));
    await Bun.write(secretFile, `${JSON.stringify(secret, null, 2)}\n`);
    console.log(
      `committed from ${from}; reveal between ${genesis.launch_at} and ${genesis.launch_at + window}`,
    );
  } else if (phase === 'reveal') {
    if (now < genesis.launch_at || now >= genesis.launch_at + window)
      throw new Error(`reveal window is [${genesis.launch_at}, ${genesis.launch_at + window}); now ${now}`);
    await send(miner.methods.reveal_launch(Fr.fromString(secret.preimage)));
    const [mix, reveals] = await unwrap<[bigint, bigint]>(miner.methods.launch_lottery().simulate({ from }));
    console.log(`revealed from ${from}; ${reveals} reveals so far, mix ${mix.toString(16)}`);
  } else {
    if (now < genesis.launch_at + window)
      throw new Error(`reveal window closes at ${genesis.launch_at + window}; now ${now}`);
    const { receipt } = await send(miner.methods.launch());
    const opened = await unwrap<{ opened_at: bigint }>(miner.methods.epoch_params(0n).simulate({ from }));
    console.log(
      `launched ${deployment.miner}: epoch 0 opened at ${opened.opened_at} (tx ${String(receipt.txHash)})`,
    );
  }
} finally {
  await wallet.stop().catch(() => {});
}
