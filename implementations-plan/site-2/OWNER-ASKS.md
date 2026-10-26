# site-2: owner asks

## OA1: the node row right after "Use the default" in Settings

- **Surface**: `/mine/settings`, Network → Aztec node row (`apps/web-miner/src/components/NodeTile.tsx`).
- **What happens today** (traced, not new to this lane):
  1. The visitor clicks "Use the default".
  2. The tile switches to `URL.href` of the default, `https://aztec-testnet.drpc.org/`. `site.env` names it without
     the slash.
  3. So `isDefault` is false: the row keeps "· custom" and the "Use the default" link until the page reloads.
  4. Before a1, a reload kept it too, because the slash form was saved. After a1 a reload shows "· default", because
     nothing is saved.
- **Options**:
  - A: compare normalized URLs in the row (and the five `onDefault` sites). The row says "· default" and drops the
    link at once.
  - B: leave it. The row corrects itself on the next reload.
- **Recommendation**: A. The row then says what the visitor just did.
- **What ships now**: a1 without it (B's behaviour, with the reload now fixing the row).

## OA2: one previous origin replaces the version before it

- **Surface**: `previous.yacana.network` (the old app), and `docs/upgrades.md`.
- **What ask11 implies**: every move deploys the retiring version's build to the one previous origin. That replaces
  the version it served before. Today the runbook keeps each old origin "until V5's deadline has passed".
- **When a person notices**: only if version N still proves when version N+2 flips. N's holders who never sent
  ahead then lose N's page before its deadline. The FAQ promises the old app "while it [proves]"
  (`apps/web-landing/src/faq-copy.ts:83`). What N proved stays claimable on the next version or redeemable on
  Ethereum.
- **Options**:
  - A: accept, as asked. The runbook says the move replaces the version before. It checks `build.json` before any
    redeploy from a kept checkout, and never takes the origin down at a deadline.
  - B: delay a move's deploy to `previous` while the version there still proves. The new version's tabs then link
    an origin that serves the older one.
- **Recommendation**: A. Testnet versions stop proving hours or days after their flip, months before the next one.
- **What ships now**: A in the runbook (a2). No code depends on the choice.
