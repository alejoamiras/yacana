# ci-1 phase 2

- Guard first run failed "uses ./.github/actions/status does not exist": the layout guard's `exists` reads
  `git ls-files`, so a new action must be staged before the guard sees it.
- biome flags `'${{ … }}'` string literals (`noTemplateCurlyInString`); an escaped template literal says the same.
- Planted defects, each caught by its guard and restored: `ui-status` without `test` in `needs` (G2), `if:
  ${{ !cancelled() }}` (G2), job-level `continue-on-error: true` on a gated job (G3), `pull_request.paths` (G1),
  `|| true` after the verdict in the action (G2).
- Full `bun test`: the one failure is `vk-pinning.test.ts` without `aztec-nargo` on PATH; it passes with
  `~/.aztec/versions/5.2.0/bin` and its `node_modules/.bin` prefixed (already in `lessons.md`).
