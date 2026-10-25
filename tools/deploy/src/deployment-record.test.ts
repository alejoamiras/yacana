// The committed deployment record must parse as on-chain values and carry the parameters the
// contracts were compiled with.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { PROFILE } from '@yacana/miner-core/generated/params';
import config from '../../../yacana.params.json';

const repo = resolve(import.meta.dir, '../../..');
type Json = Record<string, unknown>;
const record = (await Bun.file(resolve(repo, `deployments/${PROFILE}.json`)).json()) as Json;
const profile = config.profiles[PROFILE as keyof typeof config.profiles] as Json;

const DECIMAL = /^\d+$/;
// Numbers and hex strings in the profile become decimal strings in the record.
const canonical = (v: unknown): unknown =>
  typeof v === 'number' || (typeof v === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(v))
    ? BigInt(v).toString()
    : v;

describe(`deployments/${PROFILE}.json`, () => {
  test('has the record shape', async () => {
    expect(record.profile).toBe(PROFILE);
    // A deployed address is a non-zero Grumpkin x-coordinate (isValid); parsing rejects out-of-field values.
    for (const k of ['deployer', 'miner', 'token']) {
      const address = AztecAddress.fromStringUnsafe(record[k] as string);
      expect([k, address.isZero(), await address.isValid()]).toEqual([k, false, true]);
    }
    for (const k of ['minerClassId', 'tokenClassId'])
      expect(Fr.fromString(record[k] as string).isZero()).toBe(false);
    for (const k of ['minerSalt', 'tokenSalt']) Fr.fromString(record[k] as string); // zero is a legal salt
    for (const k of ['chainId', 'rollupVersion', 'launchAt']) expect(record[k]).toMatch(DECIMAL);
    expect(record.rollupAddress).toMatch(/^0x[0-9a-f]{40}$/);
    if (record.launchedAt !== undefined) {
      expect(record.launchedAt).toMatch(DECIMAL);
      expect(BigInt(record.launchedAt as string) >= BigInt(record.launchAt as string)).toBe(true);
    }
    const nodeUrl = record.nodeUrl as string;
    expect(new URL(nodeUrl).origin).toBe(nodeUrl);
    expect(new URL(nodeUrl).protocol).toBe('https:');
    const deployedAt = record.deployedAt as string;
    expect(new Date(deployedAt).toISOString()).toBe(deployedAt);
    expect(record.miner).not.toBe(record.token);
  });

  test('params match the compiled profile', () => {
    const params = record.params as Json;
    expect(Object.keys(params).sort()).toEqual(Object.keys(profile).sort());
    for (const [k, v] of Object.entries(profile))
      expect([k, canonical(params[k])]).toEqual([k, canonical(v)]);
  });
});
