# Owner asks: v6-1

## OA1: the default node becomes a third party

**Surface.** The node every page talks to by default (`deployments/site.env`'s `VITE_AZTEC_NODE_URL`, shown in
the miner's Settings, where a visitor may pick another).

**What changes.** V5's default is Aztec Labs' own host. Aztec Labs runs no V6 host (`v6.testnet.rpc.aztec-labs.com`
does not resolve on 2026-10-25), and the only V6 RPC Aztec documents is dRPC's `https://aztec-testnet.drpc.org`.
The default node sees the PXE's tag-sync queries and every private transaction the page sends, with the
visitor's IP. Today Aztec Labs sees them; after the move, dRPC does.

**What ships now.** dRPC as the default, because the site cannot move to V6 without one. Switching to an Aztec
Labs host later is one `site.env` line and a redeploy.

**Other option.** Hold the PR until Aztec Labs runs a V6 host. The code and the site's move ship together
(plan D1), so the apex stays on V5 until then.

**Decision (2026-10-25, P1-01).** The owner chose to ship with dRPC's public node
(`https://aztec-testnet.drpc.org`) as the default V6 node, signed on the decision page with no note. P6 sets it
in `site.env`.

## OA2: a returning visitor with the V5 node saved sees "Cannot start" once

**Surface.** The first load of `/mine/`, `/stats/` or `/` after the merge, for a visitor whose browser saved a node.

**What happens** (traced in code, not run against the live site).
- The node setting is saved only when a visitor switches nodes in Settings, or clicks "Use the default"
  (`apps/web-miner/src/components/NodeTile.tsx:232`, `session.ts:825`, `packages/web-kit/src/browser/connection.ts:46`).
  "Use the default" saves the default's URL itself.
- After the merge, such a visitor's saved `https://v5.testnet.rpc.aztec-labs.com` wins over the new default
  (`connection.ts:92`). The deployment check refuses it (rollup 1821665230, not 679261766).
- The miner shows "Cannot start" with "Use the default" and a Settings link (`apps/web-miner/src/App.tsx:96`);
  the stats and the landing show their own way out. One click reloads on dRPC, and V6 works from then on.
- Visitors who never touched the node setting are not affected: they get the new default.

**Options.**
1. Ship as is: the affected visitors see the error once and click their way out.
2. A small web-kit change before the merge: a saved node equal to a retired default is read as no choice, and
   "Use the default" stores no URL, so later default moves strand nobody. It changes what is persisted and touches
   no file K pinned (`protocol/`, the params, the policy, `bun.lock`). It needs a unit test, and is a plan change
   to this PR or its own PR.

**Recommendation.** Option 2, because P1-01 chose dRPC as the default for every visitor, and a saved V5 node cannot
serve V6 anyway. It is left out of this PR, which after K takes only P6's files: the code is unchanged, and the owner's decision
is pending.

## Noted, no decision needed

- **Open V5 tabs.** A tab left open on the V5 apex sees the redeploy and shows its frozen copy: "What is still on
  V1821665230 can be sent ahead from the old app", with a link to `v5.yacana.network`
  (`apps/web-miner/src/features/OldTabNotice.tsx:53`). That origin serves an older V5 record (its
  `build.json` names miner `0x058c…f38f`; the apex's was `0x0364…014c` until this PR), and the new portal has no V5→V6 path, so
  the sentence is wrong for these tabs. It is compiled into V5's build, so this lane cannot
  change it. It follows from ask3 ("V5 balances and epochs are not carried, and v5.yacana.network is left as it
  is").
- **The vault.** The one behaviour change the bump would cause, a returning account refused at sign-in, is
  prevented in code (plan D3). No visible change.
