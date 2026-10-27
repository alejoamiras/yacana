# fees-1 · phase 3 (a1: the three options)

- 2026-10-27 `Segmented` renders radix toggle items with no per-option props, so `fees-chain-<id>` could not exist
  without touching ui. The chain is the radio by its name; §4's test ids and the Shots row say so.
- 2026-10-27 `views` became `views.tsx`: each phase's label is a span with `fees-step-<phase>` and the machine's
  status, so `Stepper`, `Trail` and `Timeline` all carry the same ids while their own `data-state` stays theirs.
- 2026-10-27 a balance read keyed on "a trade landed" would be an effect dependency Biome calls unnecessary; `Held`
  is a component its owner keys on landed, which re-runs the read without a suppression.
- 2026-10-27 web-miner's specs carry no jest-dom matcher types (`tsconfig.app.json` types only `vite/client`); the
  root `tsc -b` refused `toHaveTextContent`. Plain `textContent` / `disabled` assertions, as the other specs do.
- 2026-10-27 the commit hung in `ssh-keygen -Y sign` on a stale agent socket (machine.md's known gotcha); killed my
  own signer by pid and committed with `env -u SSH_AUTH_SOCK`, signature G.
- 2026-10-27 gate green; the six cases passed four runs in a row; forcing A's close to reset failed the reopen case.
