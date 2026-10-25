# ci-1 phase 2

- Guard first run failed "uses ./.github/actions/status does not exist": the layout guard's `exists` reads
  `git ls-files`, so a new action must be staged before the guard sees it.
- biome flags `'${{ … }}'` string literals (`noTemplateCurlyInString`); an escaped template literal says the same.
- Planted defects, each caught by its guard and restored: `ui-status` without `test` in `needs` (G2), `if:
  ${{ !cancelled() }}` (G2), job-level `continue-on-error: true` on a gated job (G3), `pull_request.paths` (G1),
  `|| true` after the verdict in the action (G2).
- Full `bun test`: the one failure is `vk-pinning.test.ts` without `aztec-nargo` on PATH; it passes with
  `~/.aztec/versions/5.2.0/bin` and its `node_modules/.bin` prefixed (already in `lessons.md`).

## Fix loop r1
- Codex (gpt-6.1-sol, high): one low finding, the verdict's five-line header repeated the code; cut to one sentence.
- Opus 5.5 diff review, three findings, all accepted as local fixes:
  - A `workflow_dispatch` run on a PR branch posts check runs on the PR head SHA. With one status name for both
    events, a green dispatch (`harness` with `cases=bridge`) could answer for a red PR status, or a red dispatch block
    a green PR. Fix: the status job's name is an expression, bare on `pull_request`, `(dispatch)` otherwise. Skipping
    the job on dispatch would be worse: a skipped job with the required name reads as success.
  - `'pull_request' in doc.on` is false for `on: [pull_request, …]` (array index lookup), so such a workflow escaped
    every guard; events are normalised from string, list or map.
  - A job without `name` is checked under its id, so uniqueness now counts `name ?? id`.
- Planted: list-form `on:` with the status job removed (G2 red); an unnamed `deploy-status` job in `e2e.yml` (G2 red).
