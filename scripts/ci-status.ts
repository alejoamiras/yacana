// The verdict behind each `<workflow>-status` check. A skipped job satisfies branch protection, so every job's
// result is compared with what the change filter implies.

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
