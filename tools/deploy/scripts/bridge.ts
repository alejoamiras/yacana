// The operator's bridge commands, one per runbook step. Reads need only the record; writes need
// YACANA_L1_PRIVATE_KEY, and the L2 side of `retire` needs YACANA_DEPLOYER_SECRET (any funded
// account would do: consuming the retire message is not privileged).
//
//   YACANA_L1_PRIVATE_KEY=0x… [YACANA_RECORD=deployments/<profile>.json] [YACANA_L1_RPC_URL=…] \
//     bun run bridge -- status [version]
//                    | register
//                    | note-transitions
//                    | pause <version> <seconds> | pause-all <seconds> | unpause <version>
//                    | close-deposits <version>
//                    | set-forwarder <address> on|off
//                    | retire <version>            (L1, once; then L2 with YACANA_DEPLOYER_SECRET and the record's node)
//                    | forward <source-record> [target-record] [--from-archive] [--batch <n>]
//                    | note-stop <version> [<unix seconds>] | retire-node <version>   (record writes: no key, no chain)
import { Fr } from '@aztec-labs/aztec.js/fields';
import { errorName } from '@yacana/bridge/revert';
import { PROFILE } from '@yacana/miner-core/generated/params';
import { getAddress } from 'viem';
import { parseCliArgs } from '../src/bridge/cli.ts';
import { forwardAll } from '../src/bridge/forward.ts';
import { openL2 } from '../src/bridge/l2.ts';
import { LIFECYCLE_COMMANDS, type LifecycleCommand, writeLifecycle } from '../src/bridge/lifecycle.ts';
import { loadRecord, operatorFromEnv } from '../src/bridge/operator.ts';
import { closeDeposits, pause, pauseAll, unpause } from '../src/bridge/pause.ts';
import { noteRegistryIndex, registerVersion, setForwarder } from '../src/bridge/register.ts';
import { retireOnL1, retireOnL2 } from '../src/bridge/retire.ts';
import { registeredVersions, statusLines, versionStatus } from '../src/bridge/status.ts';
import { noteAllTransitions } from '../src/bridge/transition.ts';

const { positional, flags } = parseCliArgs(process.argv.slice(2), {
  '--from-archive': 'switch',
  '--batch': 'integer',
});
const [command, ...args] = positional;
const arg = (i: number, name: string): string => {
  const v = args[i];
  if (v === undefined) throw new Error(`${command} needs <${name}>`);
  return v;
};
// The lifecycle notes touch the record alone: written and done before any RPC is opened.
if (command && LIFECYCLE_COMMANDS.includes(command)) {
  const record = process.env.YACANA_RECORD ?? `deployments/${PROFILE}.json`;
  const written = writeLifecycle(record, command as LifecycleCommand, arg(0, 'version'), args[1]);
  console.log(`${command}: ${record} now carries lifecycle ${JSON.stringify(written)}`);
  process.exit(0);
}
const op = await operatorFromEnv(PROFILE);

switch (command) {
  case 'status': {
    const versions = args[0] ? [BigInt(args[0])] : await registeredVersions(op);
    // Only the record's own version is held to the record's miner: earlier versions had their own.
    for (const v of versions) {
      const mine = v === BigInt(op.record.rollupVersion) ? op.record.miner : undefined;
      for (const line of statusLines(await versionStatus(op, v), mine)) console.log(line);
    }
    break;
  }
  case 'register': {
    const r = await registerVersion(op);
    noteRegistryIndex(op, r.index);
    console.log(`registered version ${r.version} at Registry index ${r.index}: ${r.txHash} (index recorded)`);
    break;
  }
  case 'note-transitions': {
    const noted = await noteAllTransitions(op);
    console.log(noted.length ? `noted transitions ${noted.join(', ')}` : 'nothing to note');
    break;
  }
  case 'pause':
    console.log(await pause(op, BigInt(arg(0, 'version')), BigInt(arg(1, 'seconds'))));
    break;
  case 'pause-all':
    console.log(await pauseAll(op, BigInt(arg(0, 'seconds'))));
    break;
  case 'unpause':
    console.log(await unpause(op, BigInt(arg(0, 'version'))));
    break;
  case 'close-deposits':
    console.log(await closeDeposits(op, BigInt(arg(0, 'version'))));
    break;
  case 'set-forwarder': {
    const word = arg(1, 'on|off');
    if (word !== 'on' && word !== 'off') throw new Error(`set-forwarder takes on or off, not ${word}`);
    console.log(await setForwarder(op, getAddress(arg(0, 'address')), word === 'on'));
    break;
  }
  case 'retire': {
    const version = BigInt(arg(0, 'version'));
    const sent = await retireOnL1(op, version);
    console.log(
      `retire ${sent.resumed ? 'was sent before' : 'sent'} for ${sent.version}: ${sent.txHash} (inbox index ${sent.inboxIndex})`,
    );
    const secret = process.env.YACANA_DEPLOYER_SECRET;
    if (!secret) {
      console.log(
        'YACANA_DEPLOYER_SECRET unset: run `retire` again with it set to consume the message on the old chain',
      );
      break;
    }
    if (BigInt(op.record.rollupVersion) !== version)
      throw new Error(
        `the record is version ${op.record.rollupVersion}: point YACANA_RECORD at version ${version}'s`,
      );
    const l2 = await openL2(op.record, Fr.fromHexString(secret));
    try {
      console.log(`retired on L2: ${await retireOnL2(l2, op.record.bridge.portal as `0x${string}`, sent)}`);
    } finally {
      await l2.stop();
    }
    break;
  }
  case 'forward': {
    const source = loadRecord(arg(0, 'source-record'));
    const target = args[1] ? loadRecord(args[1]) : undefined;
    const batch = flags.get('--batch');
    const r = await forwardAll(op, {
      source,
      ...(target ? { target } : {}),
      fromArchive: flags.get('--from-archive') === true,
      ...(typeof batch === 'number' ? { batch } : {}),
    });
    console.log(
      `archived ${r.archived}, forwarded ${r.forwarded.length}, failed ${r.failed.length}, pending ${r.pending.length}${r.refusedKind2 ? ` (send-aheads held: ${r.refusedKind2})` : ''}`,
    );
    for (const f of r.failed) console.log(`  exit ${f.index} failed: ${errorName(f.reason)}`);
    break;
  }
  default:
    throw new Error(`unknown command ${command ?? '(none)'}`);
}
