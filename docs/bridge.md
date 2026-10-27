# The bridge

YACA lives on one Aztec version at a time and, as an ERC-20, on Ethereum. One contract on Ethereum, the portal
(`protocol/portal/src/YacanaPortal.sol`; the token `YACA.sol` beside it, the portal its only minter), consumes what
each registered Aztec version's miner burns and mints it where it is going. Nothing crosses without a burn on one
side and a message the other side can verify. This page is the mechanism; `docs/upgrades.md` is what the operators
do on the day Aztec moves on; the FAQ at `/faq` says it for a holder; `/stats/bridge` shows the numbers live.

## The crossings

| kind | from → to | who starts it | how it ends |
|---|---|---|---|
| exit (K1) | Aztec → Ethereum | the holder, from the miner's wallet page (`exit_to_l1`: a private burn of the amount) | once the epoch is proven on Ethereum, anyone may `forward` the leaf: the portal mints YACA to the address the exit named. Yacana forwards exits by hand; the holder may forward their own from the page |
| send-ahead (K2) | Aztec V*n* → Aztec V*n+1* | the holder, from the migration card (`send_ahead`: a private burn under a one-time secret hash and a per-exit redeem address, both derived from the wallet's master) | once proven, the portal holds it; it is forwarded into the live version's Inbox by its holder (a signature by the redeem key) or by a listed forwarder, then claimed on that version with the secret (`claim_from_l1`, a private mint); or redeemed to YACA on Ethereum by its holder at any time |
| deposit (K3) | Ethereum → Aztec | the holder, from an injected Ethereum wallet (one `deposit` with a secret hash, the version reviewed and a deadline: the portal burns the YACA itself, no allowance) | the Inbox message is claimed on the version it named, with the secret, from its row in the Wallet's activity |
| retire (K5) | the portal → an Aztec version | anyone, after the flip (`bun run bridge -- retire`) | the miner consumes it and accepts no more mining claims; arrivals (`claim_from_l1`, K4) still land |

Every leaf an Aztec version writes is consumed on that version's own Outbox with a Merkle path against a settled
root and nullified by its leaf id; the portal rebuilds the message from the version's number and the miner it
registered for it; every message a miner consumes must come from the portal's fixed address. Public exit logs help
a device find its exits again; only Outbox membership authorises issuance.

## The turnstile, plainly

- **No per-crossing delay.** A crossing waits for one thing: its epoch's proof on Ethereum. The page shows the
  epoch's proof deadline; past it the epoch is pruned and the burn is undone onto the version it left.
- **The cap is a cumulative bound, net of what came in.** Per version, `exited − inbound + amount ≤ cap` with
  `cap = ALLOWANCE + PER_HOUR × hours(launchAt → min(now, flipAt))`: `PER_HOUR` is three times what the mining
  schedule can produce in an hour, `ALLOWANCE` 24 epochs of rewards (`REWARD × N × 24`: a day of the mainnet
  schedule, two hours of the testnet's; `packages/bridge/src/policy.ts`). It grows on wall time for the version's
  life and freezes at the flip. Before the flip a leaf over the cap **waits**: it stays consumable and the next
  hour frees room. After the flip the frozen remainder is all that can ever leave that version: what is beyond it
  then, and anything still there at the deadline, never leaves. The stats page says the numbers: "N tYACA may
  leave V5 right now · grows M an hour; exits beyond it wait for it to grow, until the flip freezes it".
- **The pause stops what comes after it.** The operators may pause a version's exits and deposits for at most 30
  days per call and 60 days per version, charged up front and refunded by `unpause` (per second: a pause undone in
  its own block costs nothing, [#90](https://github.com/alejoamiras/yacana/issues/90)); a pause adds nothing to the
  cap and removes nothing from it, and every charged second extends the version's deadline. Mining on Aztec does not
  pause with the portal.
- **The deadline ends a version.** A version's exits close at the later of the observed activation of the version
  after next and 180 days after its flip, plus its paused seconds; until both the flip and the version after next
  are seen, the deadline is open. What is still on a stopped chain past its deadline is lost.
- **Transitions are recorded by observation.** The Registry keeps no timestamps: the first portal call that sees
  `numberOfVersions()` above an index records that index's activation as now. Observed times are never earlier
  than the true flip, so nobody can shorten a holder's window; the runbook's minute-one calls (`note-transitions`,
  `retire`) bound how long the cap keeps growing after the true flip.

The bound, plainly: a compromised old version can never issue more than `cap(flipAt)` net of what was deposited
into it, three times the schedule from its launch plus the allowance, before its deadline closes; the pause
defers, the deadline ends. The launch time is the operators' word within a week behind and 90 days ahead of the
registration, so at most a week's growth is theirs to add. The cap is a tripwire, not a proof of honesty: in a
competitive boom honest production can exceed the schedule, so an honest exit can wait and, once the cap is
frozen and exhausted, be refused.

## The forwarding rule, and why

A held send-ahead is forwarded into the live version **only by its holder** (a signature by the exit's own redeem
key, made in the page from the wallet's master) **or by a forwarder the operators listed**. Anyone may forward an
exit to Ethereum: it can only mint to the address it named. The reason: a forward lands a send in one version for
good (the leaf is nullified), and a stranger could push it into a rollup about to stop, where it would be stranded.
A listed forwarder holds exactly that power, which is why it is listed by the operators, disclosed on the Verify
page and used from a key that is never in the repo. The holder keeps the other way out: a held send can be
redeemed to YACA on Ethereum at any time, under the same cap, pause and deadline as a forward.

The forward's target is the Registry's canonical version, and only if Yacana registered it there with a later
index; a skipped version never strands a send. The page forwards a send-ahead only from the version it lands on,
and only when the portal routes that version to the miner the page was built for; the operator script refuses a
target whose registered miner is not the announced record's.

## What a holder keeps, and where

- **The journal** (IndexedDB, per account and portal, on the device): every crossing with its state, the witness
  once the epoch is proven, the Inbox index once forwarded or deposited. Reread from the chain every 15 s; the
  record's own state is a reading, never the truth. The chain is.
- **The recovery file** (the wallet page's "Save recovery file"): the journal as JSON, bound to the chain and the
  portal, nothing secret in it (secrets re-derive from the master). Restored on a new device, its ended states are
  hints the chain confirms; a witnessed crossing must be this master's or the file is refused whole.
- **The words or the passkey**: the account. A crossing's secrets are derived from the master under the version
  and an index, so the same twelve words open every crossing again once the device knows of it: a new device
  finds what arrived (deposits, sends forwarded in) from the portal's events by itself, under the first 2000
  indices of each version; what left is in the recovery file, which is why the wallet page asks for it to be
  saved.
- **The witness archive** the operator commits (`deployments/witnesses/<profile>.jsonl`, every version of the
  profile in it) and the site serves (`/witnesses/<version>.jsonl`): an earlier version's settled exits, read by
  a later version's page for a crossing it already holds once that version's node is gone. The page matches an
  entry by what the master derives and what its record holds, and believes it only once its path folds to the
  root that version's Outbox holds on Ethereum.

## What is public

On Aztec: that a coin was mined and that an exit or send-ahead left (a nullifier, a note hash, a tagged log with
the amount and a hash), never who. On Ethereum: every crossing's amount and time, the address an exit names or a
deposit comes from, and a one-time redeem address per send-ahead. Someone matching amounts and times across the
two sides could link them; nothing is sent automatically, so a holder chooses when an amount becomes visible.

## The operators

An address named in the record (`bridge.operators`: an EOA on Sepolia; the Safe, its signers and threshold come
with the mainnet plan). They may register a version once (write-once: an old version's exits can never be
repointed; a wrong first registration would let that miner issue up to the version's cap and strand every send
forwarded into it, which is why the forwarder script and the page refuse a target whose registered miner is not
the announced record's) with the launch time the deploy recorded, pause within the bounds, list or unlist
forwarders, close a version's deposits (one-way, the day before an announced flip) and hand the role to another
address. The policy
(`PER_HOUR`, `ALLOWANCE`, the pause bounds, the launch bounds) is immutable, set at deployment. No timelock: the
bounds are the guard. `retire` and `noteTransition` are permissionless.

The pause budget is charged per second, while an exit is refused per block. A `pause(v, 1)` and an `unpause(v)` in
the same block refuse every exit between them and charge nothing, so operators who can order their two calls
around each exit can hold a version's exits without spending budget or moving its deadline. The deployed portal
keeps this as a known limit ([#90](https://github.com/alejoamiras/yacana/issues/90)); the next portal charges each
pause a minimum that `unpause` never refunds.

```
YACANA_L1_PRIVATE_KEY=0x… [YACANA_RECORD=deployments/<profile>.json] [YACANA_L1_RPC_URL=…] \
  bun run bridge -- status [version] | register | note-transitions
                 | pause <version> <seconds> | pause-all <seconds> | unpause <version>
                 | close-deposits <version> | set-forwarder <address> on|off | retire <version>
                 | forward <source-record> [target-record] [--from-archive] [--batch <n>]
```

`status` needs only the record and an RPC; every write signs with `YACANA_L1_PRIVATE_KEY`: the operators key,
or for `forward` a listed forwarder's key (the runbook keeps that one in the shell as `YACANA_L1_FORWARDER_KEY`,
never on a command line, never echoed). `retire` is two steps in one command: the portal's message (once; a rerun
reports the index it already sent), then, with `YACANA_DEPLOYER_SECRET` set and `YACANA_RECORD` the retired
version's, the miner's consumption on the record's node.

## The record

`deployments/<profile>.json` carries two blocks beside the deployment: `bridge` (`chainId`, `portal`, `yaca`,
`registry`, `operators`, `l1RpcUrl`, `deployBlock`), written by the L1 deploy
(`YACANA_L1_RPC_URL=… YACANA_L1_PRIVATE_KEY=… YACANA_REGISTRY=… YACANA_OPERATORS=… bun
tools/deploy/scripts/l1-deploy.ts deployments/<profile>.json`) into the record, or, while no record exists
yet, beside it as `deployments/<profile>.bridge.json` for `bun run deploy` to fold in (a continuation carries its
source record's block; either must name the portal the miner trusts, or the deploy refuses), and `migration`
(`toIndex`, `announcedAt`, `expectedFlipAt`), written by hand when Aztec announces the next version. The site builds both into the apps; the Verify page shows the Ethereum side with its
Etherscan links and the forwarders listed now; the stats bridge page shows every registered version's flows.
