# site-2 phase 0: planning consults

- 2026-10-26 recon: one Sonnet Explore sweep (reuse map in `recon.md`); one web read of Cloudflare's Custom
  Domains and `wrangler delete` docs (certificate kept on removal; silent on the DNS record and on what `delete`
  removes).
- 2026-10-26 Codex audit r1 (`gpt-6.1-sol`, high, session `01a178ac`; the host runs Codex in its approve-for-me
  sandbox mode): conditional approve, six findings, all adopted (plan §7). The useful catch: the shared origin turns
  every "redeploy from the kept worktree" into a possible overwrite of a later version.
- 2026-10-26 final fresh Codex pass: the first attempt (session `01a178b4`) failed with "Selected model is at
  capacity"; one retry (`01a178b6`) ran. Conditional approve, three findings adopted (Bun's shared module registry
  makes an import-time `defaults` unreliable in a unit test; wrangler's dry run prints no Worker name; no assertion
  held the caller-only write rule). Resumed verification: approve.
