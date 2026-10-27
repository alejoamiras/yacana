# deploy-2 phase 2: the lottery secret

- Red check (step 2), Bun 1.4.2, umask 002: with the helper's body as a default `writeFileSync(path, json)` (the
  mode `Bun.write` gives, Fact 5), the test failed on the mode: `Expected: 384, Received: 436` (0600 vs 0664). With
  `{ mode: 0o600 }` and no `wx`, it failed on the overwrite: `toThrow(/EEXIST/)`, "Received function did not
  throw". With both: 1 pass.
- Deviation: the red run used a default `writeFileSync` rather than `Bun.write` itself, so the helper and the test
  stay synchronous; the earlier scratch run showed both give 0664.
- The script body now runs under `if (import.meta.main)`; the CLI guards still fire (`launch.ts bogus` → usage).
- Gate: `bun run lint` (after `lint:fix` reflowed `launch.ts`), `bun run typecheck`, `bun test tools/deploy` → 25
  pass, 9 skip, 0 fail.
