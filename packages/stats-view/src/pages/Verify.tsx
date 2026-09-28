// The deployment record in full, against what the node says: addresses, class ids, the work
// circuit's verifier key hash, the source commit, the launch record and the reproduce commands.

import { PARAMS } from '@yacana/miner-core/generated/params';
import { ExternalLink, KvRow, Tile, TileBoundary, TileHeader } from '@yacana/ui';
import type { DeploymentRecord } from '@yacana/web-kit/config';
import { W_VK_HASH } from '@yacana/work-circuit/generated/vk';
import { useAtomValue } from 'jotai';
import { bridgeRecord } from '../bridge';
import { l1Links, links } from '../explorer';
import { reproduceCommand } from '../lib/reproduce.ts';
import { bridgeAtom, fixedAtom, historyAtom, rowsAtom } from '../state';

const record = JSON.parse(import.meta.env.VITE_DEPLOYMENT_RECORD) as DeploymentRecord & {
  profile?: string;
  nodeUrl?: string;
  deployer?: string;
  minerSalt?: string;
  tokenSalt?: string;
  launchAt?: string;
  launchedAt?: string;
  deployedAt?: string;
  params?: Record<string, string | number>;
};

/** A value in full; with `href`, the explorer's page for it one click away (the code stays the exact text). */
const Hex = ({ value, testId, href }: { value: string; testId?: string; href?: string }) => {
  const code = (
    <code className="break-all font-mono text-xs" data-testid={testId}>
      {value}
    </code>
  );
  return href ? (
    <ExternalLink href={href} full={value} className="text-ink">
      {code}
    </ExternalLink>
  ) : (
    code
  );
};

const stamp = (unix?: string) => (unix ? `${new Date(Number(unix) * 1000).toISOString()} (${unix})` : '—');

function DeploymentTile() {
  const commit = import.meta.env.VITE_SOURCE_COMMIT;
  return (
    <Tile className="md:col-span-2">
      <TileHeader>the deployment this page was built for</TileHeader>
      <KvRow label="profile" value={record.profile ?? import.meta.env.VITE_SITE_MODE} />
      <KvRow label="chain id · rollup version" value={`${record.chainId} · ${record.rollupVersion}`} />
      <KvRow
        label="miner"
        value={<Hex value={record.miner} testId="verify-miner" href={links.instance(record.miner)} />}
      />
      <KvRow
        label="miner class id"
        value={
          <Hex
            value={record.minerClassId}
            testId="verify-miner-class"
            href={links.classVersion(record.minerClassId)}
          />
        }
      />
      <KvRow
        label="token"
        value={<Hex value={record.token} testId="verify-token" href={links.instance(record.token)} />}
      />
      <KvRow
        label="token class id"
        value={
          <Hex
            value={record.tokenClassId}
            testId="verify-token-class"
            href={links.classVersion(record.tokenClassId)}
          />
        }
      />
      <KvRow
        label="deployer (no privilege after bind_token)"
        value={
          <Hex value={record.deployer ?? '—'} href={record.deployer && links.address(record.deployer)} />
        }
      />
      <KvRow
        label="miner salt · token salt"
        value={<Hex value={`${record.minerSalt ?? '—'} · ${record.tokenSalt ?? '—'}`} />}
      />
      <KvRow label="work circuit verifier key hash" value={<Hex value={W_VK_HASH} testId="verify-vk" />} />
      <KvRow label="source commit" value={<Hex value={commit} testId="verify-commit" />} />
      <KvRow label="deployed · launch at" value={`${record.deployedAt ?? '—'} · ${stamp(record.launchAt)}`} />
    </Tile>
  );
}

function LaunchTile() {
  const fixed = useAtomValue(fixedAtom);
  const history = useAtomValue(historyAtom);
  const rows = useAtomValue(rowsAtom);
  const first = rows?.[0];
  return (
    <Tile>
      <TileHeader>the launch, as public storage records it</TileHeader>
      {fixed ? (
        <>
          <KvRow
            label="genesis target"
            value={<Hex value={`0x${fixed.genesis.target.toString(16)}`} testId="verify-genesis-target" />}
          />
          <KvRow label="genesis seed" value={<Hex value={`0x${fixed.genesis.seed.toString(16)}`} />} />
          <KvRow label="launch at" value={stamp(String(fixed.genesis.launchAt))} />
          <KvRow
            label="lottery mix · reveals"
            value={
              history?.lottery
                ? `${history.lottery.mix.toString(16).slice(0, 12)}… · ${history.lottery.reveals}`
                : '—'
            }
          />
          <KvRow
            label="epoch 0 opened"
            value={stamp(String(first?.epoch === 0 ? first.openedAt : record.launchedAt))}
          />
          <KvRow label="open epoch" value={String(fixed.open)} />
        </>
      ) : (
        <p className="text-xs text-ink-2">reading…</p>
      )}
    </Tile>
  );
}

function ConstantsTile() {
  return (
    <Tile>
      <TileHeader>the constants this build assumes</TileHeader>
      {Object.entries(PARAMS)
        .filter(([k]) => !['TOKEN_NAME'].includes(k))
        .map(([k, v]) => (
          <KvRow key={k} label={k} value={<span className="font-mono text-xs">{String(v)}</span>} />
        ))}
    </Tile>
  );
}

function ReproduceTile({ nodeUrl }: { nodeUrl: string }) {
  const commit = import.meta.env.VITE_SOURCE_COMMIT;
  return (
    <Tile className="md:col-span-2">
      <TileHeader>reproduce</TileHeader>
      <p className="mb-2 text-xs text-ink-2">
        Every number on the stats page comes from public storage on the node you choose; the same reads from a
        terminal:
      </p>
      <pre
        className="overflow-x-auto rounded-sm border border-line bg-raised p-3 font-mono text-xs"
        data-testid="reproduce"
      >
        {`${reproduceCommand(nodeUrl)}\n# the artifacts and the verifier key: git checkout ${commit.slice(0, 12)} && bun run codegen && bun run contracts:compile`}
      </pre>
    </Tile>
  );
}

/**
 * The Ethereum side of the record: the contracts and the keys, each on Etherscan. The multisig
 * and the relayers are the portal's word now, not the build's: the role can be handed on and a
 * relayer authorized after the record was written; when the RPC is silent, the tile says so.
 */
function BridgeRecordTile() {
  const bridge = bridgeRecord();
  const status = useAtomValue(bridgeAtom);
  if (!bridge) return null;
  const live = status.phase === 'ready' ? status.snapshot : null;
  const forwarders = live?.forwarders ?? null;
  const operators = live?.operators ?? bridge.operators;
  const silent = status.phase === 'error' || (status.phase === 'ready' && status.unreachable);
  const chain = (label: string, address: string, testId: string) => (
    <KvRow label={label} value={<Hex value={address} testId={testId} href={l1Links.address(address)} />} />
  );
  return (
    <Tile className="md:col-span-2" data-testid="verify-bridge">
      <TileHeader>the bridge on Ethereum</TileHeader>
      <KvRow label="chain id" value={bridge.chainId} />
      {chain('portal', bridge.portal, 'verify-portal')}
      {chain('YACA', bridge.yaca, 'verify-yaca')}
      {chain('registry (Aztec)', bridge.registry, 'verify-registry')}
      {chain(
        live
          ? silent
            ? 'governance multisig (last read; the RPC is silent)'
            : 'governance multisig (now)'
          : 'governance multisig (at deployment)',
        operators,
        'verify-operators',
      )}
      <KvRow
        label={silent ? 'authorized relayers (last read; the RPC is silent)' : 'authorized relayers'}
        value={
          forwarders === null ? (
            silent ? (
              'unreachable'
            ) : (
              '…'
            )
          ) : forwarders.length === 0 ? (
            'none'
          ) : (
            <span className="flex flex-col gap-1" data-testid="verify-forwarders">
              {forwarders.map((f) => (
                <Hex key={f} value={f} href={l1Links.address(f)} />
              ))}
            </span>
          )
        }
      />
    </Tile>
  );
}

/** Five tiles, each behind its own boundary: a value that cannot be formatted costs its tile, not the page. */
export function Verify({ nodeUrl }: { nodeUrl: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="verify">
      <TileBoundary name="verify-deployment" className="md:col-span-2">
        <DeploymentTile />
      </TileBoundary>
      <TileBoundary name="verify-bridge" className="md:col-span-2">
        <BridgeRecordTile />
      </TileBoundary>
      <TileBoundary name="verify-launch">
        <LaunchTile />
      </TileBoundary>
      <TileBoundary name="verify-constants">
        <ConstantsTile />
      </TileBoundary>
      <TileBoundary name="verify-reproduce" className="md:col-span-2">
        <ReproduceTile nodeUrl={nodeUrl} />
      </TileBoundary>
    </div>
  );
}
