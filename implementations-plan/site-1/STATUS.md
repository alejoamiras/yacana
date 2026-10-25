# site-1 status

- 2026-10-25 recon: clean room of `513bd01` green under Bun 1.4.0 and 1.4.3, byte-identical to production; image changed 2026-10-23/24; red builds die 22–53 s after push; same-account Bun 1.4.2 Workers green.
- 2026-10-25 plan drafted: probes P0/P1/P2 decide B/E/R/T; outcome B pins Bun 1.4.2.
- 2026-10-25 ORCHY-STEER: every failed run ended ~3 s after it was queued (build 738d6190…: 15:19:48 → 15:19:51), green ones ~100 s; weigh a pre-build cause (connection, trigger, the image's Bun resolution from `packageManager`); stop with LEAD_BLOCKED if only the dashboard can fix it. Folded: probes now separate the pin from a pre-build setting by pass/fail alone.
- 2026-10-25 Codex audit (gpt-6.1-sol, high): conditional approve — byte gate must pin the commit, timing diagnoses removed, A1 resolved, outcome T bounded. All four folded.
- 2026-10-25 Codex final fresh pass: conditional approve (7 findings, all folded); resumed round 2: conditional approve (3 small conditions, all folded).
- 2026-10-25 Codex final pass round 3: approve. Plan committed.
- 2026-10-25 Phase 1 gate ✓: Q0, Q1, Q3, Q4 and Q2 all red 8–9 s after opening; probe branches deleted; outcome H. Codex (resumed): stop at H, no orphan probe. Phase 2 not run; no PR. LEAD_BLOCKED on the owner's reading of the build log.
