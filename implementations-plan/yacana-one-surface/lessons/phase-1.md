# P1 · Lucide icons — lessons

## What changed
- `packages/ui/src/components/icons.tsx`: the six hand-drawn path lists → Lucide components (`Pickaxe`, `Wallet`,
  `ChartColumn`, `ShieldCheck`, `Settings`, `FingerprintPattern`) at `strokeWidth={1.5}`, same `Icon({ name, size })`
  API and `data-icon`; no consumer changed. The old origin's bar takes the same glyphs through `oldTabs`.
- `header.vitest.tsx` asserts each name's `lucide-<glyph>` class, stroke 1.5, `aria-hidden`, and the tabs' glyphs;
  `shell.vitest.tsx` renders `oldTabs` in the `Header` and asserts Pickaxe and ChartColumn.

## Facts
- lucide-react 1.34 renders `class="lucide lucide-<kebab>"` and adds `aria-hidden="true"` only when no a11y prop is
  passed; passing our own `aria-hidden` keeps it. Its `size` sets width and height; `strokeWidth` is not scaled unless
  `absoluteStrokeWidth`.
- This machine's shell has no Aztec binaries on PATH: `protocol/work-circuit/src/vk-pinning.test.ts` fails with
  "command not found: aztec-nargo" unless `~/.aztec/current/bin` is prepended. Not a code failure.

## Gate (2026-09-23)
Fast layers: `bun run lint` 0 · `bun test` 0 (586 pass, 42 skip, 0 fail) · `bun run typecheck` 0 ·
`bun run test:components` 0 (ui 87, landing 14, stats 84, miner 132) · `test:replay` 0 (9 passed).
