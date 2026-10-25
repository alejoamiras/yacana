// Headless miner for the testnet soak: mines the deployment in deployments/<profile>.json with
// the native bb backend, claims every win, rolls after T_MAX, and varies its own hashrate on a
// schedule so the retarget sees real load changes. Stops after --hours (capped at 2) or once
// --epochs epochs have closed on chain, whichever comes first.
//   AZTEC_NODE_URL=… bun tools/deploy/scripts/soak.ts [--hours 2] [--epochs 24] [--threads N]
//                    [--schedule full,half,pause,full] [--label miner-a] [--report soak.jsonl]
import { appendFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
import { buildClaim, claimGasLimits, isDeliveryBlockedError } from '@yacana/miner-core/claim';
import { readOpenEpoch, readRules } from '@yacana/miner-core/epoch';
import { PARAMS, PROFILE } from '@yacana/miner-core/generated/params';
import { mineEpoch } from '@yacana/miner-core/miner';
import { deployDomain } from '@yacana/miner-core/proof';
import { newEpochSecret } from '@yacana/miner-core/secret';
import { BbJsWorkProver } from '@yacana/miner-core/work';

const MAX_HOURS = 2; // owner's cap on the testnet soak
const repo = resolve(import.meta.dir, '../../..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const positive = (name: string, fallback: string, integer = false) => {
  const n = Number(opt(name, fallback));
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n)))
    throw new Error(`--${name} must be a positive ${integer ? 'integer' : 'number'}`);
  return n;
};
const hours = Math.min(MAX_HOURS, positive('hours', String(MAX_HOURS)));
const maxEpochs = positive('epochs', '24', true);
const maxThreads = positive('threads', String(Math.max(1, cpus().length - 1)), true);
const schedule = opt('schedule', 'full,half,pause,full').split(',');
const label = opt('label', 'soak');
const startedAt = new Date();
const report = resolve(
  opt('report', `tools/deploy/target/soak-${label}-${startedAt.toISOString().replace(/[:.]/g, '-')}.jsonl`),
);
const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) throw new Error('AZTEC_NODE_URL is required');
mkdirSync(dirname(report), { recursive: true });

const deployment = (await Bun.file(resolve(repo, `deployments/${PROFILE}.json`)).json()) as {
  miner: string;
  token: string;
};
const node = createAztecNodeClient(nodeUrl);
const wallet = await EmbeddedWallet.create(nodeUrl, { ephemeral: true, pxe: { proverEnabled: true } });
const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
  salt: new Fr(SPONSORED_FPC_SALT),
});
await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
const fee = {
  paymentMethod: new SponsoredFeePaymentMethod(fpc.address),
  gasSettings: { gasLimits: await claimGasLimits(node) },
};
const newAccount = async () => {
  const secret = Fr.random();
  return (
    await wallet.createSchnorrInitializerlessAccount(
      secret,
      Fr.ZERO,
      deriveMasterMessageSigningSecretKey(secret),
    )
  ).address;
};
// A claim that reverted in public leaves this account's note-delivery sequence blocked until the
// tx finalizes on L1; the soak rotates to a fresh account instead of waiting, keeping every
// account's rewards in the final balance.
const accounts: AztecAddress[] = [];
let from = await newAccount();
const rotateAccount = async () => {
  accounts.push(from);
  from = await newAccount();
  await line({ event: 'rotated-account', account: from.toString() });
};
const minerArtifact = await loadMinerArtifact();
for (const [address, art] of [
  [AztecAddress.fromStringUnsafe(deployment.miner), minerArtifact],
  [AztecAddress.fromStringUnsafe(deployment.token), TokenContract.artifact],
] as const) {
  const instance = await node.getContract(address);
  if (!instance) throw new Error(`${address} is not on the node`);
  await wallet.registerContract(instance, art);
}
const miner = Contract.at(AztecAddress.fromStringUnsafe(deployment.miner), minerArtifact, wallet);
const token = Contract.at(AztecAddress.fromStringUnsafe(deployment.token), TokenContract.artifact, wallet);
const rules = await readRules(miner, from);
const chainId = BigInt(await node.getChainId());
const rollupVersion = BigInt((await node.getNodeInfo()).rollupVersion);
const domain = await deployDomain(chainId, rollupVersion, miner.address.toField(), PARAMS.VERSION);

// Every row names the run and the deployment, so reports from different runs cannot be confused.
const runId = `${label}-${startedAt.getTime()}`;
const line = async (o: Record<string, unknown>) => {
  const row = { t: new Date().toISOString(), label, run: runId, miner: deployment.miner, ...o };
  console.log(JSON.stringify(row));
  appendFileSync(report, `${JSON.stringify(row)}\n`);
};

// One prover per hashrate step; "pause" mines nothing for the step's duration.
const stepSeconds = Math.max(300, Math.floor((hours * 3600) / schedule.length));
const threadsFor = (step: string) => (step === 'half' ? Math.max(1, Math.floor(maxThreads / 2)) : maxThreads);

const deadline = startedAt.getTime() + hours * 3600_000;
const remainingSeconds = () => Math.max(1, Math.floor((deadline - Date.now()) / 1000));
const startEpoch = (await readOpenEpoch(miner, from)).epoch;
/** Epochs closed on chain since the run started, whoever closed them. */
const closedOnChain = async () => (await readOpenEpoch(miner, from)).epoch - startEpoch;
let claims = 0;
let stale = 0;
let proofs = 0;
await line({
  event: 'start',
  hours,
  maxEpochs,
  maxThreads,
  schedule,
  stepSeconds,
  epoch: startEpoch.toString(),
  account: from.toString(),
});

const done = async () => Date.now() >= deadline || (await closedOnChain()) >= BigInt(maxEpochs);

for (let s = 0; !(await done()); s = (s + 1) % schedule.length) {
  const step = schedule[s] ?? 'full';
  const stepEnd = Math.min(deadline, Date.now() + stepSeconds * 1000);
  await line({
    event: 'step',
    step,
    threads: step === 'pause' ? 0 : threadsFor(step),
    until: new Date(stepEnd).toISOString(),
  });
  if (step === 'pause') {
    while (Date.now() < stepEnd && !(await done())) {
      await maybeRoll();
      await delay(30_000);
    }
    continue;
  }
  const api = await Barretenberg.new({
    threads: threadsFor(step),
    backend: BackendType.NativeUnixSocket,
  }).catch(() => Barretenberg.new({ threads: threadsFor(step), backend: BackendType.WasmWorker }));
  const prover = new BbJsWorkProver(await loadWorkArtifact(), api);
  try {
    while (Date.now() < stepEnd && !(await done())) {
      await maybeRoll();
      const view = await readOpenEpoch(miner, from);
      const epochSecret = newEpochSecret();
      const winner = await mineEpoch(
        prover,
        {
          domain,
          seed: new Fr(view.params.seed),
          epoch: view.epoch,
          secret: epochSecret,
          recipient: from.toField(),
          target: view.params.target,
        },
        {
          onAttempt: (_n, _d, proveMs) => {
            proofs++;
            if (proofs % 20 === 0)
              void line({
                event: 'attempt',
                epoch: view.epoch.toString(),
                proveMs: Math.round(proveMs),
                proofs,
              });
            return Date.now() < stepEnd;
          },
        },
      );
      if (!winner) continue;
      if ((await readOpenEpoch(miner, from)).epoch !== view.epoch) {
        stale++;
        await line({ event: 'stale-before-send', epoch: view.epoch.toString() });
        continue;
      }
      const t0 = Date.now();
      try {
        const claim = () =>
          buildClaim(miner, {
            epoch: view.epoch,
            nonce: winner.nonce,
            out: winner.out,
            secret: epochSecret,
            proofFields: winner.proofFields,
            recipient: from,
          }).send({
            from,
            fee,
            wait: { timeout: Math.min(900, remainingSeconds()), dontThrowOnRevert: true },
          });
        const sent = await claim();
        const receipt = (
          sent as {
            receipt?: {
              txHash?: { toString(): string };
              executionResult?: string;
              blockNumber?: number;
              transactionFee?: bigint;
            };
          }
        ).receipt;
        const ok = receipt?.executionResult === 'success';
        if (ok) claims++;
        else stale++;
        // The account and the hash pick an account's second claim for the example-claim record.
        await line({
          event: ok ? 'claim' : 'reverted',
          epoch: view.epoch.toString(),
          account: from.toString(),
          txHash: receipt?.txHash?.toString(),
          block: receipt?.blockNumber,
          fee: receipt?.transactionFee?.toString(),
          ms: Date.now() - t0,
          attempts: winner.attempts,
        });
        // A public revert blocks this account's note delivery until the tx finalizes: rotate now,
        // before the next winner is wasted on it.
        if (!ok) await rotateAccount();
      } catch (e) {
        stale++;
        await line({
          event: 'refused',
          epoch: view.epoch.toString(),
          error: String(e).split('\n')[0],
          ms: Date.now() - t0,
        });
        if (isDeliveryBlockedError(e)) await rotateAccount();
      }
    }
  } finally {
    await api.destroy().catch(() => {});
  }
}

let balance = 0n;
for (const a of [...accounts, from])
  balance += ((await token.methods.balance_of_private(a).simulate({ from: a })) as { result: bigint }).result;
await line({
  event: 'end',
  hoursElapsed: ((Date.now() - startedAt.getTime()) / 3600_000).toFixed(2),
  closedEpochs: (await closedOnChain()).toString(),
  claims,
  stale,
  proofs,
  balance: balance.toString(),
});
await wallet.stop();

async function maybeRoll() {
  const view = await readOpenEpoch(miner, from);
  const age = BigInt(Math.floor(Date.now() / 1000)) - view.params.openedAt;
  if (age < rules.T_MAX) return;
  await line({ event: 'roll', epoch: view.epoch.toString(), age: age.toString() });
  try {
    await miner.methods.roll().send({ from, fee, wait: { timeout: Math.min(900, remainingSeconds()) } });
  } catch (e) {
    await line({ event: 'roll-failed', error: String(e).split('\n')[0] });
  }
}
