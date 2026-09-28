import { Chip, ChipLink, shortHash, Tile, TileHeader } from '@yacana/ui';
import type { DeploymentRecord } from '@yacana/web-kit/config';
import { W_VK_HASH } from '@yacana/work-circuit/generated/vk';
import { links } from '../explorer';
import { useStatsHost } from '../host';
import { reproduceCommand } from '../lib/reproduce.ts';

const record = JSON.parse(import.meta.env.VITE_DEPLOYMENT_RECORD) as DeploymentRecord;

/** The deployment's identity as chips, and the one command that reproduces the page; the route has the rest. */
export function VerifyTile({ nodeUrl, className }: { nodeUrl: string; className?: string }) {
  const commit = import.meta.env.VITE_SOURCE_COMMIT;
  const { navigate, pathFor } = useStatsHost();
  return (
    <Tile className={className} data-testid="verify-tile">
      <TileHeader
        aside={
          <a
            href={pathFor('verify')}
            className="hover:text-ink"
            onClick={(e) => {
              e.preventDefault();
              navigate('verify');
            }}
          >
            the full record →
          </a>
        }
      >
        verify
      </TileHeader>
      <div className="flex flex-wrap gap-2">
        <ChipLink
          label="miner"
          value={record.miner}
          href={links.instance(record.miner)}
          testId="chip-miner"
        />
        <ChipLink
          label="token"
          value={record.token}
          href={links.instance(record.token)}
          testId="chip-token"
        />
        <ChipLink
          label="class"
          value={record.minerClassId}
          href={links.classVersion(record.minerClassId)}
          testId="chip-class"
        />
        <Chip label="W vk" value={shortHash(W_VK_HASH)} full={W_VK_HASH} />
        <Chip label="source" value={commit.slice(0, 7)} full={commit} />
      </div>
      <pre
        className="mt-2.5 overflow-x-auto rounded-sm bg-ground px-2.5 py-2 font-mono text-[11.5px] text-ink-2"
        data-testid="reproduce-command"
      >
        {reproduceCommand(nodeUrl)}
      </pre>
    </Tile>
  );
}
