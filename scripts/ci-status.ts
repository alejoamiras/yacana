// The verdict of a pull-request workflow's `<workflow>-status` job, the one check branch protection requires.
// A gated job that is skipped reports "Success" to protection, so the status job compares every job it needs
// with what the change filter implies: `success` where `changes` said relevant (or the workflow has no
// `changes`), `skipped` where it said not. Anything else — failed, cancelled, never started, or a filter that
// never concluded — fails it. Usage: NEEDS='${{ toJSON(needs) }}' bun scripts/ci-status.ts

export interface Need {
  result: string;
  outputs?: Record<string, string>;
}

export function verdict(needs: Record<string, Need>): { ok: boolean; lines: string[] } {
  const jobs = Object.entries(needs);
  if (jobs.length === 0) return { ok: false, lines: ['the status job needs no job'] };
  // Workflows gate every job but `changes` on its one output; without `changes`, nothing is gated.
  const relevant = needs.changes ? needs.changes.outputs?.relevant : 'true';
  const results = jobs.map(([job, { result }]) => {
    const want =
      job === 'changes' || relevant === 'true' ? 'success' : relevant === 'false' ? 'skipped' : undefined;
    return {
      ok: result === want,
      line: `${job}: ${result}, expected ${want ?? 'a concluded change filter'}`,
    };
  });
  return { ok: results.every((r) => r.ok), lines: results.map((r) => r.line) };
}

if (import.meta.main) {
  const { ok, lines } = verdict(JSON.parse(process.env.NEEDS ?? ''));
  for (const line of lines) console.log(line);
  process.exit(ok ? 0 : 1);
}
