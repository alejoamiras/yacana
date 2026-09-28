// The one-line announcement the stats pages carry while a migration is announced: the
// build's record says which Registry index comes next and when the upgrade is expected; the lead in
// bold, the FAQ one link away.
import type { MigrationRecord } from '@yacana/bridge/record';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';
import { useStatsHost } from '../host';

const migration = (): MigrationRecord | null =>
  import.meta.env.VITE_MIGRATION ? (JSON.parse(import.meta.env.VITE_MIGRATION) as MigrationRecord) : null;

/** "Aztec's next version arrives around <day>": the one sentence, from the record's migration block. */
export const announcementLine = (m: MigrationRecord, version: string): string =>
  `Aztec's next version arrives around ${new Date(Number(m.expectedFlipAt) * 1000).toISOString().slice(0, 10)}. Mining on ${version} ends when the upgrade lands; send what you hold ahead before then, and claim it on the next version with the same passkey. Anything left on ${version} when it goes quiet is lost.`;

export function Announcement() {
  const { faqHref } = useStatsHost();
  const m = migration();
  if (!m) return null;
  const line = announcementLine(m, ownVersionName());
  const cut = line.indexOf('. ') + 1;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[6px] border border-uv/50 px-3.5 py-2.5 text-sm text-ink-2"
      data-testid="announcement"
    >
      <span>
        <b className="font-medium text-ink">{line.slice(0, cut)}</b>
        {line.slice(cut)}
      </span>
      <span className="flex gap-4 whitespace-nowrap">
        <a href={faqHref} className="text-uv-2 hover:underline">
          what to do →
        </a>
      </span>
    </div>
  );
}
