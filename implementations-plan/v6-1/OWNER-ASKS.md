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

## Noted, no decision needed

- **Open V5 tabs.** A tab left open on the V5 apex sees the redeploy and shows its frozen copy: "What is still on
  V1821665230 can be sent ahead from the old app", with a link to `v5.yacana.network`
  (`apps/web-miner/src/features/OldTabNotice.tsx:53`). That origin serves an older V5 record (its
  `build.json` names miner `0x058c…f38f`; the apex's is `0x0364…014c`), and the new portal has no V5→V6 path, so
  the sentence is wrong for these tabs. It is compiled into V5's build, so this lane cannot
  change it. It follows from ask3 ("V5 balances and epochs are not carried, and v5.yacana.network is left as it
  is").
- **The vault.** The one behaviour change the bump would cause, a returning account refused at sign-in, is
  prevented in code (plan D3). No visible change.
