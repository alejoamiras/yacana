# The day Aztec moves on: the runbook

Aztec ships a new rollup version; the Registry names it canonical (the flip); the old version keeps running for
a while, then its operators stop it. Yacana's miner is deployed per version; balances move between versions
through the portal (`docs/bridge.md`). This is what the operators do, in the order the upgrade rig runs it:
`bun run rig -- migration` (`tools/harness/tests/migration.bun.test.ts`) is the executable form of the chain
side below, `bun run rig -- browser` the holder's side through the page, `bun run rig -- all` every case.

Every write here is `bun run bridge -- <command>` with `YACANA_L1_PRIVATE_KEY` in the shell (the operators key;
for `forward`, the listed forwarder's key, kept in the shell as `YACANA_L1_FORWARDER_KEY` and passed as
`YACANA_L1_PRIVATE_KEY=$YACANA_L1_FORWARDER_KEY`), `YACANA_RECORD` pointing at the version's record, and the
record's RPC or `YACANA_L1_RPC_URL`. Reads (`status`) need no key. Keys are never on a command line, never in
the repo, never echoed. The profile's live record is always `deployments/<profile>.json` (`testnet.json` below);
the deploy script writes that path and nothing else, so an earlier version's record moves aside by hand before
the next version is deployed.

## Once: the bridge

0. **Deploy and list.** The portal comes before its first miner (the miner trusts one portal, immutably):
   `bun tools/deploy/scripts/l1-deploy.ts deployments/testnet.json` with `YACANA_L1_RPC_URL`,
   `YACANA_L1_PRIVATE_KEY`, `YACANA_REGISTRY`, `YACANA_OPERATORS` in the shell deploys YACA and the portal and,
   with no record at that path yet, writes the `bridge` block to `deployments/testnet.bridge.json`; then
   `YACANA_PORTAL=<portal> AZTEC_NODE_URL=… YACANA_DEPLOYER_SECRET=… bun run deploy` deploys the miner and folds
   that block into `deployments/testnet.json` (delete the side file after); then `bun run bridge -- register`
   puts the version on the portal and `bun run bridge -- set-forwarder <address> on` lists the forwarder key's
   address. An existing record is amended in place instead: `l1-deploy.ts deployments/testnet.json` refuses a
   record whose miner trusts another portal. Last, `bun tools/deploy/scripts/l1-verify.ts deployments/testnet.json`
   with `ETHERSCAN_API_KEY` (a keyed run on `deployments/etherscan.env.example`) publishes both contracts' source.

## Before: Aztec announces V6

1. **Announce.** Add the `migration` block to `deployments/testnet.json` (`toIndex`: the Registry index V6 will
   take, the current canonical index plus one; `announcedAt`; `expectedFlipAt`, unix seconds, Aztec's word as
   given) and redeploy the site (a push to `main`, or `bun run site:deploy`). Announcing is a redeploy: the
   miner's migration card, the stats pages and the landing carry the line from the build's record. Nothing on
   chain changes.
2. **Watch.** `bun run bridge -- status` reads every registered version's standing: registered miner, flip,
   pause, headroom, deadline, deposits. The stats bridge page is the same read for everyone.

## The day before: close deposits into V5

3. `bun run bridge -- close-deposits <V5>` (one-way). A deposit into a version about to stop would strand its Inbox
   message; the miner's deposit dialog reads the portal and refuses before it asks the wallet.

## Minute one after the flip

4. `bun run bridge -- note-transitions`: the portal records the Registry's new index as observed now. The cap of
   V5 freezes at that moment and its deadline clock starts; until this call the cap keeps growing, which is why
   it is the first thing after the flip. The register, retire, forward, redeem, deposit, pause and close-deposits
   calls record a transition as a side effect; listing a forwarder or handing the role on does not, and a
   reverted call records nothing.
5. `YACANA_RECORD=deployments/testnet.json YACANA_DEPLOYER_SECRET=… bun run bridge -- retire <V5>` (the record is
   still V5's at this point): the retire message into V5's Inbox (once; a rerun reports the index it already
   sent), then the miner consumes it on the record's node, after which no mining claim mints on V5 (arrivals still
   claim). Without the secret the command sends the message and prints the second step. The miner's page sees the
   flip through the Registry and stops mining before the message lands; the retire message makes it final.

Holders who have not sent ahead can still do so: V5 settles epochs until its operators stop it, and a send-ahead
after the flip lands like any other once its epoch is proven (rig case H4). The page says what is lost and when.

## Deploy V6

6. **Move V5's record aside, then deploy the continuation.** `git mv deployments/testnet.json
   deployments/testnet-v5.json` and `git mv deployments/testnet.example-claim.json
   deployments/testnet-v5.example-claim.json` (any names but the live ones; the operator script takes a record
   by path, and a production build refuses an example claim of another deployment), set
   `VITE_AZTEC_NODE_URL` in `deployments/site.env` to V6's node (the apps' default node comes from there, not
   from the deploy's environment), commit, then `YACANA_CONTINUE_FROM=deployments/testnet-v5.json
   YACANA_PORTAL=<portal> AZTEC_NODE_URL=<V6 node> YACANA_DEPLOYER_SECRET=… bun run deploy`: the V6 miner as
   V5's continuation (it starts at the epoch V5 left off, with V5's last target), bound to the same portal,
   written to `deployments/testnet.json` with the `bridge` block carried from V5's record. The deploy refuses to
   write over its own source, and refuses a source whose portal is not `YACANA_PORTAL`. The record's
   `continuation.firstEpoch` is where every epoch read starts (the stats page, the landing's strip,
   `epoch:stats`): a continuation has no epoch before it. Once a claim lands on
   V6, `AZTEC_NODE_URL=<V6 node> bun tools/deploy/scripts/record-example-claim.ts <txHash>` records the
   example claim the landing shows.
7. `YACANA_RECORD=deployments/testnet.json bun run bridge -- register`: V6 on the portal, with its miner and the
   record's launch time. Write-once; the portal accepts a launch time from a week behind to 90 days ahead of the
   registration, so register within the week after the deploy. From here the portal forwards held sends into V6.
8. **The apex, the old origin.** With step 6 and 7 committed on `main`, deploy the V6 site to the apex
   (`bun run site:deploy`, or the push). The old origin is V5's last build, made from the last commit that
   carried V5 in `deployments/testnet.json` (the one before step 6's move) in its own worktree so the V6
   checkout is never touched: `git worktree add ../yacana-v5 <that commit>`, then in `../yacana-v5`
   `bun install && YACANA_APP_ROLE=old bun run site:build` (into its `apps/site/dist-old`) and, from its
   `apps/site`, `wrangler deploy -c v5/wrangler.jsonc` (the `yacana-v5` Worker: `v5.yacana.network`). Keep
   the worktree: steps 11 and 12 note V5's stop in it and redeploy from it; `git worktree remove ../yacana-v5`
   from the V6 checkout's root once the old origin comes down. An open V5 tab learns from `build.json`
   that it is behind and asks for a reload. The old origin restores accounts (never creates one), sends ahead
   and exits; mining there has ended. Keep it up until V5's deadline has passed, then take it down.

## Forward

9. `YACANA_L1_PRIVATE_KEY=$YACANA_L1_FORWARDER_KEY bun run bridge -- forward deployments/testnet-v5.json
   deployments/testnet.json [--batch 20]`: every settled exit of V5 is archived first (to
   `deployments/witnesses/testnet.jsonl`, the profile's one archive, every version in it), then every held
   send-ahead is forwarded into V6 (the target record names the miner the portal must route to; a mismatch holds
   every send-ahead) and every exit to Ethereum. Rerun as later epochs settle; `--from-archive` once V5's node is
   gone. Holders may forward their own from the V6 page, or redeem to Ethereum instead; nothing waits on Yacana.
   No cron runs this: Yacana forwards by hand, when a next version opens and as later epochs settle, and the pages
   promise no schedule, only that Yacana forwards a held send-ahead once the next version opens and that holders
   can forward or redeem themselves.
10. **The witness archive.** Commit `deployments/witnesses/testnet.jsonl` and redeploy the site: the assembly
    serves each version's lines at `/witnesses/<rollup version>.jsonl` (the record's `rollupVersion`, not the
    registry's index), and a holder's page on V6 completes a V5 send it already holds from there once V5's node
    is gone (a device that never held it needs the recovery file).

## When V5 stops

11. **Note the stop.** When V5's operators stop it for good (its last proof is on Ethereum; the miner's chip and
    the old origin say "no proof from V5 for …" meanwhile, never "stopped"), `YACANA_RECORD=deployments/testnet-v5.json
    bun run bridge -- note-stop <V5> [<unix seconds>]` writes `lifecycle.stoppedProvingAt` to V5's record: no key,
    no chain, the time defaults to now, a second note is refused. Commit it. Then redeploy the old origin with the
    note: in step 8's worktree (V5's record is `deployments/testnet.json` there) run the same `note-stop` against
    that path, commit there too, build and `wrangler deploy -c v5/wrangler.jsonc`. Its page turns from "send
    ahead" to "V5 has stopped proving. Nothing more can leave"; what V5 proved in time stays claimable on V6 or
    redeemable on Ethereum until V5's last day. The pages never infer a stop from a silent hour: only this note
    says "stopped".
12. **Retire the node.** Commit the witness archive first (step 10: a holder's V6 page completes V5's settled sends
    from `/witnesses/<V5's rollup version>.jsonl`, not from V5's node), then take V5's node down and `bun run bridge -- retire-node
    <V5>` on both records as in step 11 (after the stop, once), committed in both checkouts: `lifecycle.nodeRetired`.
    The old origin's redeploy then shows the "node gone" page before any node access — no log in, no Change node,
    the apex one link away.

## Then

- V5's deadline: the later of the version after next's observed activation and 180 days after the flip, plus
  paused seconds. `status` shows it. After it, nothing leaves V5; take the old origin down and remove step 8's
  worktree.
- The rehearsal: every step above runs on a preview deployment first (`docs/deployments.md`: the branch alias is
  a preview host with its own passkeys; a version of the `yacana-v5` Worker created without its route serves the
  frozen record on a preview URL). Production deploys (the apex, the `v5` custom domain) happen after the merge,
  never from a branch.

## What each step exercises on the rig

| step | command | rig case |
|---|---|---|
| deploy, fold the block | `l1-deploy.ts`, `bun run deploy` | the rig attaches the block to its records itself (`tools/harness/src/yacana.ts`, the run helper `tools/deploy/src/bridge/run.ts`) and never runs the deploy CLI; the CLI's fold from the side file ran once in the rehearsal (`docs/deployments.md`), the continuation's carry-over is unit-tested (`bridge-block.test.ts`) and **not yet exercised end to end** |
| list a forwarder | `set-forwarder` | the run helper every browser e2e uses |
| register | `register` | every case; `skip-version.bun.test.ts` (H7: a version Yacana never registers is skipped, the send lands on the next) |
| close deposits | `close-deposits` | `deposit.bun.test.ts` (H2: a deposit lands where it named; after the close the next is refused) |
| observe the flip | `note-transitions` | `migration.bun.test.ts` (H3), `skip-version.bun.test.ts`, `never-settled.bun.test.ts` (H5), `browser.bun.test.ts` |
| retire | `retire` (L1, then L2) | `migration.bun.test.ts` (H3: no mining claim mints after; a rerun resumes), `browser.bun.test.ts` |
| the continuation | `bun run deploy` with `YACANA_CONTINUE_FROM` | `migration.bun.test.ts`, `browser.bun.test.ts` (V6 as V5's continuation) |
| pause | `pause`, `pause-all`, `unpause` | `bridge.bun.test.ts` (H9: held exits, the budget charged), `migration.bun.test.ts` (`pause-all` reaches every version) |
| forward | `forward` | `migration.bun.test.ts` (H11: a stranger refused, a wrong target held, the forwarder and the holder accepted, all from the archive with the source node gone), `bridge.bun.test.ts` (H1, H6, H10), `never-settled.bun.test.ts` (an unproven epoch forwards nothing) |
| the holder's side | — | `browser.bun.test.ts` (V5, the flip, V6 through the page), `origin.bun.test.ts` (one passkey across the apex and the old origin) |
| the stop, the node's retirement | `note-stop`, `retire-node` | record writes only: `tools/deploy/src/bridge/lifecycle.test.ts`; the pages' states on them are component specs (`versioned-origin.vitest.tsx`, `gallery.vitest.tsx`) |
