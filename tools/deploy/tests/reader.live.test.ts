// Runs against an isolated local network: bun run e2e:agent -- bun test packages/miner-core
import { describe, expect, test } from 'bun:test';
import { TokenContract } from '@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js';
import { loadContractArtifact } from '@aztec-labs/aztec.js/abi';
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import { loadMinerArtifact } from '@yacana/miner-core/artifacts';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { NODE_MAX_BATCH } from '@yacana/miner-core/node-client';
import {
  assertDeployment,
  expectedFromStrings,
  readEpochs,
  readGenesis,
  readLottery,
  readOpenEpochNumber,
  readTotalSupply,
} from '@yacana/miner-core/reader';
import { deriveSlotTable } from '@yacana/miner-core/slots';
import { deployYacana, TEST_PORTAL } from '../src/deploy.ts';

const nodeUrl = process.env.AZTEC_NODE_URL ?? '';

describe.skipIf(!nodeUrl)('assertDeployment against a live node', () => {
  test('accepts the deployment it was built for and refuses every drift', async () => {
    const node = createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH });
    const layout = (await loadMinerArtifact()).storageLayout;
    const d = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
      initialTarget: 1n << 127n,
      portal: TEST_PORTAL,
    });
    const other = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
      initialTarget: 1n << 127n,
      portal: TEST_PORTAL,
    });
    const expected = expectedFromStrings(d);
    await assertDeployment(node, expected, layout);
    await expect(assertDeployment(node, { ...expected, chainId: 1n }, layout)).rejects.toThrow(/on chain/);
    await expect(assertDeployment(node, { ...expected, rollupVersion: 1n }, layout)).rejects.toThrow(
      /rollup version/,
    );
    await expect(
      assertDeployment(node, { ...expected, rollupAddress: `0x${'ab'.repeat(20)}` }, layout),
    ).rejects.toThrow(/serves rollup/);
    await expect(assertDeployment(node, { ...expected, minerClassId: Fr.random() }, layout)).rejects.toThrow(
      /has class/,
    );
    await expect(
      assertDeployment(node, { ...expected, miner: expectedFromStrings(other).miner }, layout),
    ).rejects.toThrow(/bound token/);
    await expect(
      assertDeployment(node, { ...expected, token: expectedFromStrings(other).token }, layout),
    ).rejects.toThrow(/bound token/);
  }, 600_000);
});

describe.skipIf(!nodeUrl)('the epoch reader against a live node', () => {
  test('epoch 0 through the slot table matches the deployment record; genesis, lottery and supply read', async () => {
    const node = createAztecNodeClient(nodeUrl, { maxBatchSize: NODE_MAX_BATCH });
    const layout = (await loadMinerArtifact()).storageLayout;
    const d = await deployYacana(nodeUrl, Fr.random(), Fr.random(), {
      initialTarget: 1n << 120n,
      portal: TEST_PORTAL,
    });
    const miner = AztecAddress.fromStringUnsafe(d.miner);
    expect(await readOpenEpochNumber(node, miner, layout)).toBe(0);
    const load = (chunk: number) => deriveSlotTable(layout, chunk);
    const [row] = await readEpochs(node, miner, { from: 0, to: 0 }, load, { withSeed: true });
    expect(row).toMatchObject({
      epoch: 0,
      target: 1n << 120n,
      openedAt: Number(d.launchedAt),
      claims: 0,
      duration: null,
      closedBy: null,
    });
    expect(row?.seed).toBeGreaterThan(0n);
    const genesis = await readGenesis(node, miner, layout);
    expect(genesis).toEqual({
      target: 1n << 120n,
      seed: BigInt(PARAMS.GENESIS_SEED),
      launchAt: Number(d.launchAt),
    });
    expect(await readLottery(node, miner, layout)).toEqual({ mix: 0n, reveals: 0 });
    const tokenLayout = loadContractArtifact(TokenContract.artifact as never).storageLayout;
    expect(await readTotalSupply(node, AztecAddress.fromStringUnsafe(d.token), tokenLayout)).toBe(0n);
  }, 600_000);
});
