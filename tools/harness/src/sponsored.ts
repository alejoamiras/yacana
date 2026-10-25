// The fee path of a pinned version: the sponsored FPC, funded at genesis on every node this repo
// runs (the local network's own setup, the pinned node's prefund list), pays for a fresh account's
// own deployment. A real ClientIVC proof, sent and mined: the cheapest transaction that proves the
// version takes user transactions at all.
import { NO_FROM } from '@aztec-labs/aztec.js/account';
import { getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import { SPONSORED_FPC_SALT } from '@aztec-labs/constants';
import { Fq, Fr } from '@aztec-labs/foundation/curves/bn254';
import { SponsoredFPCContract } from '@aztec-labs/noir-contracts.js/SponsoredFPC';
import { EmbeddedWallet } from '@aztec-labs/wallets/embedded';

export interface SponsoredReceipt {
  txHash: string;
  blockNumber: number;
  account: string;
}

export async function sponsoredTransaction(nodeUrl: string): Promise<SponsoredReceipt> {
  const wallet = await EmbeddedWallet.create(nodeUrl, { ephemeral: true, pxe: { proverEnabled: true } });
  try {
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
      salt: new Fr(SPONSORED_FPC_SALT),
    });
    await wallet.registerContract(fpc, SponsoredFPCContract.artifact);
    const account = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), Fq.random());
    const method = await account.getDeployMethod();
    // NO_FROM: the account deploys itself and pays its own fee through the FPC, in one transaction.
    const { receipt } = await method.send({
      from: NO_FROM,
      fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) },
      wait: { timeout: 600 },
    });
    return {
      txHash: receipt.txHash.toString(),
      blockNumber: Number(receipt.blockNumber ?? 0),
      account: account.address.toString(),
    };
  } finally {
    await wallet.stop().catch(() => {});
  }
}
