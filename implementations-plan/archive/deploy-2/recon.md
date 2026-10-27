# deploy-2 recon

Base: `origin/main` at 4fd31b8. One Sonnet reuse sweep, then the planner's own reads. No open issue collides
(`gh issue list --state open`: only #87, the site's old origin). Closed known limits: #82, #85; neither covers
the pause or the continuation (`gh issue list --state all --search "pause"`, `"continuation"`: no hit).

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| Read the source's open epoch, target and seed | `continuationOf` (`tools/deploy/src/deploy.ts:272-286`) through `readOpenEpochNumber` + `readEpochs(..., { withSeed: true })` (`packages/miner-core/src/reader.ts:239-302`); the same pair in `apps/web-miner/src/public-epoch.ts:37` | adapt: one `readOpenEpoch` in `reader.ts` for `deploy.ts` and `epoch-stats.ts`; the web miner is left as is (out of scope) |
| The operator's tuple | `YACANA_CONTINUE_FIRST_EPOCH` / `_SEED` / `_TARGET`, all or none (`deploy.ts:256-270`), today taken *instead of* the node | adapt: required, and compared with the node |
| A source the record could give | `deployments/testnet-2026-09-28.json` (V5) and `testnet.json` (V6): no last epoch, seed or target. A record's `continuation` block holds its *own* start, not its source's end | none: the tuple is the second source |
| "The node is gone" as a fact | `lifecycle.nodeRetired`, written by `retire-node` on both records (`docs/upgrades.md` step 12, `tools/deploy/src/bridge/lifecycle.ts`) | reuse-as-is |
| A JSON-RPC stub node | `packages/stats-view/tests/history-transport.bun.test.ts:30-47`: `Bun.serve({ port: 0 })`, `aztec_getPublicStorageAt`, batch-aware, 32-byte hex results | adapt into `continuation.test.ts` (test files are not exported) |
| Storage values by slot | `packages/miner-core/src/reader.test.ts:71-84` `chain()`: `open_epoch`, epoch base / +1 seed / +2 opened_at, claims; `deriveSlotTable(layout, 0)` from the committed `fixtures/storage-layout.json`, no generated file | reuse the shape |
| A 0600, exclusive write | none. Searched `0o600`, `'wx'`, `O_EXCL`, `chmod`, `umask` over `*.ts`, `*.sh`, `*.yml`: one unrelated `chmodSync(…, 0o755)` (`bb-verify.test.ts:86`). Record writes are plain `writeFileSync` / tmp + rename (`lifecycle.ts:58`) | build new (one call) |
| Temp dirs in bun tests | `mkdtempSync(join(tmpdir(), 'yacana-<name>-'))`, `rmSync` after (`tools/deploy/src/bridge/lifecycle.test.ts:37`, `tools/localnet/src/registry.test.ts:7`) | reuse-as-is |
| A testable script | `export` + `if (import.meta.main)` (`tools/deploy/scripts/epoch-stats.ts:27,40`, `l1-deploy.ts:168`) | reuse for `launch.ts` |
| The pause's operator notes | `docs/bridge.md` § "The operators" (`:97-105`) and the pause rule (`:35-38`); `docs/threat-model.md:58` | adapt: one paragraph |
| Known-limit issue shape | #82, #85: `## What happens` (label + path), `## Where`, `## Impact`, `## Possible fix`, `## Record`, then **Disposition** / **Reopen when**; closed as not planned | reuse-as-is |

## Callers and CI

- `continuationOf`: the CLI (`deploy.ts:319`), `continuation.test.ts`, and three rig cases with no tuple:
  `migration.bun.test.ts:172`, `skip-version.bun.test.ts:88`, `browser.bun.test.ts:266`.
- `bun test tools/deploy` runs in `deploy.yml:44` (path-filtered) and `miner-core.yml:28` (with typecheck). The rig
  cases that call `continuationOf` run only on dispatch (`migration`, `skip-version`) or locally (`browser`); a pull
  request runs `flip` only. So a pull request checks those callers by typecheck alone.
- No workflow runs the root `bun test`.

## Collision risks

- `continuation.test.ts` reads `deployments/${PROFILE}.json` from the checkout; the new tests write their own record
  in a temp dir.
- `deploy.ts:245-251` says the tuple is "taken as given": the doc comment, `docs/upgrades.md` step 6 and the
  `CLAUDE.md` command line change with the code.
- Unrelated: `git ls-files -ci --exclude-standard -- implementations-plan` lists older plans' tracked audit files.
  Not this lane's.
