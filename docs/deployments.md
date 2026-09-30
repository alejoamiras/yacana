# Deployments

## Bootstrap (fair launch)

A deployment nobody knows about can be mined alone before it is announced, so a legitimate launch is announced
first: publish the miner class id, salt, constructor arguments (`initial_target`, `genesis_seed`, `launch_at`), the
token address and `launch_at` (unix seconds, `YACANA_LAUNCH_AT` for `bun run deploy`) well before `launch_at`.
Epoch 0 does not exist until the launch lottery ran (`AZTEC_NODE_URL=… bun run launch -- commit|reveal|open`):
anyone commits a hash before `launch_at`, reveals inside the `REVEAL_WINDOW_SECONDS` after it, and anyone opens
epoch 0 once the window closed; `seed_0` folds every reveal, so the announcement alone lets nobody pre-mine it for
more than the window. The token must be bound before `launch_at`. Claims and rolls before the launch are refused. The mainnet profile refuses a `launch_at` less than `LAUNCH_NOTICE_SECONDS` (one day) after deployment.
Verify a deployment against its announcement with `epoch_params(0)` (`target`, `seed`, `opened_at`), `constants()`,
`work_vk_hash()`, `bound_token()` (must equal the announced token: a deployer could otherwise announce one token and
bind another) and the class ids, rollup version and L1 rollup address in `deployments/<profile>.json`
(`minerClassId`, `tokenClassId`, `rollupVersion`, `rollupAddress`). `launch()` refuses an unbound deployment and `roll()` an unlaunched one, so an instance cannot be rolled
towards a trivial target before it can mint. `genesis()` shows the announced target, seed input and launch time. Nobody rolls for a reward, so run a keeper that calls `roll()` after `T_MAX`
(the soak driver and the web miner offer it) or an epoch stuck at `N − 1` claims hangs.


Contracts are immutable: a parameter change is a new deployment (`yacana.params.json` → `bun run codegen` →
`bun run contracts:compile` → `bun run deploy`). The machine-readable record of each deployment is
`deployments/<profile>.json`, written by the deploy script (and refused as an overwrite unless
`YACANA_DEPLOY_FORCE=1`).

## Public Aztec testnet — `testnet` profile (2026-09-28, Yacana with the reducedness check)

The miner of the 2026-09-13 deployment below with `claim`'s reducedness check: a proof is accepted only if every
coordinate of its 36 points is in its one reduced encoding (`docs/threat-model.md`, "Re-encoded proof points").
The same work-circuit VK, domain tags, genesis seed, parameters and token metadata; a new portal and YACA, since
the old portal's slot for this rollup version belongs to the old miner (`registerVersion` is write-once). Deployed
from the fix's branch as one keyed run (my-stack: keys from 1Password on the owner's Mac, never a `.env`).

| | |
|---|---|
| Node | `https://v5.testnet.rpc.aztec-labs.com` (L1 chain 11155111) |
| Miner (`YacanaMiner`) | [`0x0364f04e318480bb6d6354772b12ee8e59fce2123dc43e16bc5650fd5505014c`](https://testnet.aztecscan.xyz/contracts/instances/0x0364f04e318480bb6d6354772b12ee8e59fce2123dc43e16bc5650fd5505014c) |
| Token (aztec-standards `Token` v5.2.0, minter = miner, `bound_token()`) | [`0x1fb296ab77cc42f7807e95fbdc2260d59cc9f5d48bff1ef65299b9a279466a15`](https://testnet.aztecscan.xyz/contracts/instances/0x1fb296ab77cc42f7807e95fbdc2260d59cc9f5d48bff1ef65299b9a279466a15) |
| Deployer (initializerless Schnorr account, no privilege after `bind_token`) | `0x01ac35f9b30617d5e45cbc7e36211b299d0ac0a6d0b24ee4469d91466f10bb7e` |
| Miner salt / token salt | `0x06d63f15…bf61b` / `0x06a1a5b9…d524f` (full values in `deployments/testnet.json`) |
| Miner class id / token class id | [`0x0ee9c81b…5b07f`](https://testnet.aztecscan.xyz/contracts/classes/0x0ee9c81b4018f249a69235d41eaddda33316e5142644398df3d6f56080c5b07f/versions/1) / `0x10fd5603…fecbf` |
| Rollup version (in the deploy domain) | 1821665230 (Registry index 5 on the portal) |
| Portal it trusts | `0x13c06CF71C75fDaE21a46d66478e738209A0370c` (Sepolia, below) |
| Fees | sponsored FPC (`SPONSORED_FPC_SALT`) |
| Deployed / launched | 2026-09-28T15:27:37.303Z / epoch 0 opened at once (`launchAt` 1790609292, immediate: no notice or reveal window in this profile) |
| Example claim (the landing's) | [`0x0954a6a9…4838`](https://testnet.aztecscan.xyz/tx-effects/0x0954a6a9d00a81e3b36f7f8682f80bb2a29b064f40876fe1375c551b892c4838), by a throwaway account with the headless miner |

Parameters (the `testnet` profile, also embedded in the contract as compile-time globals):

| parameter | value |
|---|---|
| `N` (accepted claims per epoch) | 4 |
| `EXPECTED_EPOCH_SECONDS` | 300 |
| `T_MAX` (escape hatch, = 4 × expected) | 1200 |
| `REWARD` | 4 tYACA (4 × 10^18, 18 decimals) |
| `INITIAL_TARGET` | 2^124 (≈ 16 proofs per winning ticket) |
| `GENESIS_SEED` | `0x594143412f746573746e6574` ("YACA/testnet") |
| `CHAIN_LEN` (work circuit) | 2048 |
| `VERSION` (domain separator) | 1 |
| `CLAIM_TTL_SECONDS` | 600 |
| `LAUNCH_NOTICE_SECONDS` / `REVEAL_WINDOW_SECONDS` | 0 / 0 (mainnet: 86400 / 600) |
| Token | "Yacana Testnet" / `tYACA` |

The three pages read this record through `deployments/site.env` + `deployments/testnet.json`. The node is a
user setting: any https node, checked against this record (chain id, rollup version, `rollupAddress`, both
instances and classes, the bound token) before it is used, from the miner's Settings → Node; it applies at once
(mining pauses, the account's chain view is rebuilt from the new node, mining resumes) and the stats and landing
pick it up at their next load (`yacana.connection`, one origin). `?node=&miner=&token=` only in e2e builds. A
record made before `rollupAddress` was recorded is amended once with `bun run record-rollup-address`.

### The site (`yacana.network`, a Cloudflare Worker serving static assets)

One origin, three apps, assembled by `bun run site:build` into `apps/site/dist`: the landing at `/`, the miner
at `/mine/`, the stats at `/stats/` (`/verify` rewrites to it), the CRS / artifacts / slot table once at the root,
`_headers` (COOP, COEP, CORP, the CSP with `connect-src 'self' data: https:` — the fetch guard bounds the node in code — `Permissions-Policy`, `nosniff`,
`no-referrer`), `_redirects` (exact deep links → each app's directory) and `build.json` (mode, commit, node
origins, RP ID). Production builds take nothing from the process environment: a local or plaintext node origin or an RP ID
other than `site.env`'s fails (`packages/web-kit/src/config.ts`), `YACANA_SITE_MODE` must be one of `production`,
`e2e`, `dev` or the build refuses to start, and a non-production mode can land neither in `apps/site/dist`
nor in a Cloudflare build (`CF_PAGES`). After a production assembly, the emitted files are checked as well
(`apps/site/src/artifact.ts`): `build.json` must say `production`, every `_headers` must be the production
map, and no script may name a plaintext loopback origin or carry the proverless marker (`VITE_E2E_PROVERLESS`,
an e2e-only flag that turns off the wallet's proving). These guards sit on the supported routes —
`site:deploy` and Workers Builds' build step both assemble first; a bare `wrangler deploy` of an existing `dist`
is not guarded, and `apps/web-miner`'s own `build` writes `apps/web-miner/dist`, which nothing deploys.

`apps/site/wrangler.jsonc` is the whole deployment definition: the Worker's name (`yacana`), the custom domain
(`yacana.network`, whose DNS record and certificate Cloudflare creates on the first deploy; the zone must be in the
same account), the assets directory (`dist`) and the SPA fallback; no Worker script runs, the assets service applies
`_headers` and `_redirects`. `workers_dev` is off (no second production origin); versions get preview URLs under
`workers.dev`, which the apps treat as this project's previews (see below).

Deploy (owner, from a machine authenticated with `wrangler login`, or with `CLOUDFLARE_API_TOKEN` in the shell and
never in the repo):

```
bun run site:deploy        # = bun run --cwd apps/site deploy: assemble the production site, then wrangler deploy
```

Git-triggered deploys: Workers Builds (dashboard: connect the repository) keeps two build triggers for the Worker,
and the build settings page edits only the production one, so set both. Both hold (the settings name no
folder, so the site can move without touching the dashboard): root directory `/`, build command
`bun install --frozen-lockfile && bun run site:build`, deploy command `bun run site:wrangler deploy` on the `main`
trigger and `bun run site:wrangler versions upload` on the "Deploy non-production branches" trigger (`*` minus
`main`); `site:wrangler` is the root script that runs the site's pinned wrangler from the site's folder. The API
`PATCH /accounts/{account}/builds/triggers/{trigger}` with a token holding Workers Builds Configuration edits a
trigger without the dashboard. Bun 1.4.0 comes from the root `packageManager`, no variable needed. Every push to `main`
assembles and deploys; every other branch gets a version with a `workers.dev` preview URL and a branch alias
(`<branch>-yacana.alejo-amiras.workers.dev`), both in the build log the commit's check run links to. Connected on
2026-09-07; nothing else is configured there, the file carries the rest.

Previews are usable for review, `/mine/` included. A host of the form `<label>` + `VITE_PREVIEW_HOST_SUFFIX`
(`site.env`: `-yacana.alejo-amiras.workers.dev`; version ids and branch aliases both fit) is a `preview` to the
apps (`packages/web-kit/src/browser/host.ts`): the banner names it, and accounts may be created or restored there
with the exact preview host as the WebAuthn relying party. What that means for a reviewer: use the branch alias,
not the per-push version URL — each hostname is its own origin, with its own vault and its own passkeys (a
passkey made on the alias cannot be used on `yacana.network`, on another preview, or, should the alias ever
change, on the new name); twelve words are the same account on every host, so never enter production words on
a preview or carry preview words to production — treat preview code as unreviewed; the page cannot stop it from
reading what is typed. Treat preview accounts as disposable. The suffix names the account's
namespace, not this Worker: another Worker in the same account would match it too; it is trusted the way the
production RP ID is. Any other host — `www.yacana.network`, someone else's `workers.dev`, a `pages.dev` name —
stays locked. Dev and e2e builds carry an empty suffix: nothing is a preview there. Whether a PRF passkey
works on a `workers.dev` host with real authenticators is checked by hand on a preview, not by the suites. `bun run e2e:agent -- bun run site:e2e` serves an e2e assembly with `wrangler dev` and asserts
every path's app, identical headers, `build.json` and the landing's proof.

First production deploy: 2026-09-06, Worker version `ea00520a-65bf-415a-b524-4235442159c6`, commit `aef4edd`
(`build.json`), 624 assets; the custom domain, its DNS record and certificate were created by that deploy. Verified
live: every path with identical policy headers, the landing's strip reading the testnet (epoch 8), a real proof
through "Prove one now" (5.0 s; the in-page demo has since been removed and the landing ships no prover), the
stats' deep link, the miner's sign-up screen. Cloudflare
injects its Web Analytics beacon into HTML by default; the CSP blocks it (one console error per page) and the
promise is no trackers, so it is turned off in the Worker's Observability settings.

`www.yacana.network` is a second, five-line Worker (`apps/site/www/`, `bun run --cwd apps/site deploy:www`)
that answers 301 to the apex with HSTS; its custom domain and DNS record are created by that deploy. It is never a
second host of the site: to the apps it is an unknown host, locked like any other.

Zone settings (owner, once):
**Always Use HTTPS on** (SSL/TLS → Edge Certificates: the edge redirects a plain-http first visit, which would
otherwise load without `crypto.subtle` or COOP; the site itself sends HSTS in `_headers`); DNSSEC on; after the certificate is active, CAA records for Cloudflare's
CAs (`letsencrypt.org`, `pki.goog`, `ssl.com`, `digicert.com`); Analytics & Logs → Web Analytics → automatic setup
off for the zone (the CSP blocks the injected beacon anyway). The previous `elixir-web-miner.pages.dev` project is
gone.

Zone state on 2026-09-06: Always Use HTTPS on; HSTS from `_headers`; CAA `issue` for the four CAs added (Cloudflare
augments them with `issuewild` and its own entries); DNSSEC enabled, the DS at Cloudflare Registrar (key tag 2371), the
TLD's publication pending; Web Analytics automatic setup off.

### The bridge (Sepolia) and the versioned origin

The record carries two more blocks once the bridge exists (`packages/bridge/src/record.ts`): `bridge` (`chainId`,
`portal`, `yaca`, `registry`, `operators`, `l1RpcUrl`, `deployBlock`), written by
`bun tools/deploy/scripts/l1-deploy.ts deployments/<profile>.json` with `YACANA_L1_RPC_URL`,
`YACANA_L1_PRIVATE_KEY`, `YACANA_REGISTRY` (Aztec's Registry on that chain) and `YACANA_OPERATORS` in the shell
(the policy comes from `yacana.params.json` through `packages/bridge/src/policy.ts`; the script amends an existing
record and refuses one whose miner trusts another portal; with no record yet it writes the block beside it as
`deployments/<profile>.bridge.json`, which `bun run deploy` folds into the record it writes), and `migration`
(`toIndex`, `announcedAt`, `expectedFlipAt`), written by hand when Aztec announces the next version. A miner is
deployed with `YACANA_PORTAL` naming the portal it trusts, immutably, so the portal comes first; then
`bun run bridge -- register` and `bun run bridge -- set-forwarder` (`docs/upgrades.md`, step 0). The site builds both blocks into the apps (`VITE_BRIDGE`, `VITE_MIGRATION`; production
refuses a plaintext or local RPC); `bun run bridge -- status` reads the portal's view of every registered version.

Sepolia (2026-09-28; the policy of `packages/bridge/src/policy.ts` for the `testnet` profile: `PER_HOUR` 576 tYACA,
`ALLOWANCE` 384 tYACA, 180 d exit floor, 30 d / 60 d pause, launch window −7 d / +90 d, 400 000 gas a leaf):

| | |
|---|---|
| Portal (`YacanaPortal`, verified; deployed in [`0x42d38318…bc61`](https://sepolia.etherscan.io/tx/0x42d38318a3135077227c6184a4387886ab83659506dc8778e20192dd2074bc61)) | [`0x13c06CF71C75fDaE21a46d66478e738209A0370c`](https://sepolia.etherscan.io/address/0x13c06CF71C75fDaE21a46d66478e738209A0370c#code) |
| YACA (`tYACA`, ERC-20, minter = the portal, created by it, verified) | [`0x4DA537e78409830dCa92850fE635eFD15A60109c`](https://sepolia.etherscan.io/address/0x4DA537e78409830dCa92850fE635eFD15A60109c#code) |
| Aztec Registry (the testnet's) | `0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba` |
| Operators (an EOA; the Safe comes with the mainnet plan; its key is `YACANA_L1_PRIVATE_KEY` of the `Yacana-Testnet` item) | [`0xc9b7162F57B74257261cB61a0FAc870Eda87Cbb7`](https://sepolia.etherscan.io/address/0xc9b7162F57B74257261cB61a0FAc870Eda87Cbb7) |
| Listed forwarder (the relayer of 2026-09-14) | [`0x6792D5eb…8bac`](https://sepolia.etherscan.io/address/0x6792D5eb75e1F025438349d454AC91378d9F8bac), listed by [`0x2af3cf09…54c4`](https://sepolia.etherscan.io/tx/0x2af3cf09a9bf110c2b23c59dcc1b2399cfcccea0435ad06c64669cb2514154c4) |
| Registration of version 1821665230 (index 5) | [`0xb97bd785…681f`](https://sepolia.etherscan.io/tx/0xb97bd785e6e2afce454d04cba64c15530875e27d323f108e3b6216a2e12f681f) |
| Deploy block / RPC in the record | 11801404 / `https://ethereum-sepolia-rpc.publicnode.com` |

The versioned origin: a retired version's last build, assembled with `YACANA_APP_ROLE=old bun run site:build` into
`apps/site/dist-old` and deployed to the `yacana-v5` Worker (`apps/site/v5/wrangler.jsonc`, custom domain
`v5.yacana.network`, versions at `<id>-yacana-v5.<account>.workers.dev`). It restores accounts and never creates
one, sends ahead and exits; mining there has ended. It is kept until the version's deadline has passed
(`docs/upgrades.md`). Its custom domain is created by its first production deploy, after the merge, never from a
branch; before that a version of the Worker serving the frozen record proves the role and the headers on a preview
host. Rehearsed 2026-09-13: the Worker created without its route from a copy of `v5/wrangler.jsonc` minus `routes`
(so nothing but version previews is reachable), version `86e77d40-bbf3-4716-b8c7-b8ad82372aa7` of commit `bc3cbb4`
serving the 2026-09-05 record as role `old` at `https://86e77d40-yacana-v5.alejo-amiras.workers.dev` — the same
policy headers as the apex preview, `build.json` with the role and the old miner, the retired banner, sign-in
restore-only with the preview notice naming the host.
First production deploy 2026-09-14, after stack #41 merged: `YACANA_APP_ROLE=old bun run site:build` of `2f56f86`
and `wrangler deploy -c v5/wrangler.jsonc` (version `00295ec9-ec53-4664-a9ef-5a3625fbc3c6`) created the custom
domain; `https://v5.yacana.network/build.json` reports role `old` with the live testnet record. The apex was
deployed by Workers Builds from the same commit.

The witness archive: `deployments/witnesses/<profile>.jsonl`, written by `bun run bridge -- forward` from a
version's settled exits (every version of the profile in the one file), committed, and served by the site as one
file per version at `/witnesses/<version>.jsonl`. A relaunch on the same rollup version moves the old archive out
of that folder, or the site would serve the old portal's witnesses as the new one's.

## Mainnet

Not deployed. The `mainnet` profile (N = 24, 1 h epochs, target 2^122, `YACA`) exists in `yacana.params.json`;
launch is a later plan (`docs/roadmap.md`).

## Archived — Yacana public testnet with the bridge, before the reducedness check (2026-09-13)

The miner with its bridge functions (`exit_to_l1`, `send_ahead`, `claim_from_l1`, the retire message), bound
at deployment to the portal on Sepolia below; the same work-circuit VK
(`W_VK_HASH` `0x1d1043617e4762fe8a2bb2ecf572de706ae890fdb4a4ff0d8f298e24722ece7b`), domain tags, genesis seed and
token metadata as the archived 2026-09-05 deployment, which keeps running on its own (it has no bridge). The
rehearsal of `docs/upgrades.md` step 0 on the public networks (the plan's P11), from the arc-4 branch, on
preview deployments only.

| | |
|---|---|
| Node | `https://v5.testnet.rpc.aztec-labs.com` (L1 chain 11155111, node `5.2.0-nightly.20260815` at deploy time) |
| Miner (`YacanaMiner`) | [`0x058c14aeaf1cd0b05d03c642a371cfb00feae0a3118bba4215ce4ef5ae36f38f`](https://testnet.aztecscan.xyz/contracts/instances/0x058c14aeaf1cd0b05d03c642a371cfb00feae0a3118bba4215ce4ef5ae36f38f) |
| Token (aztec-standards `Token` v5.2.0, minter = miner, `bound_token()`) | [`0x0436563c5d7b05702a0c806c58917ec3377c639bbc04da3b851c393510be45fc`](https://testnet.aztecscan.xyz/contracts/instances/0x0436563c5d7b05702a0c806c58917ec3377c639bbc04da3b851c393510be45fc) |
| Deployer (initializerless Schnorr account, no privilege after `bind_token`) | `0x2c7a1312299762bab96e91d83c26c4bf1754959bf95854df117b42bca4e3c54b` |
| Miner salt / token salt | `0x25f925d8…b0796` / `0x0a04360c…f34fa` (full values in `deployments/testnet-2026-09-13.json`) |
| Miner class id / token class id | [`0x09500c6f…ad63a`](https://testnet.aztecscan.xyz/contracts/classes/0x09500c6fc6e6e2731eff89f8c8a9de63fa9915f3aa3b9752d51d7b4b9a1ad63a/versions/1) / `0x10fd5603…fecbf` |
| Rollup version (in the deploy domain) | 1821665230 (Registry index 5 on the portal) |
| Portal it trusts | `0xD536D74Eedf1d2308bf8556402f37f4102eD63f7` (Sepolia, below) |
| Fees | sponsored FPC (`SPONSORED_FPC_SALT`) |
| Deployed / launched | 2026-09-13T11:58:32.147Z / epoch 0 opened at once (`launchAt` 1789300764, immediate: no notice or reveal window in this profile) |

Its record is `deployments/testnet-2026-09-13.json`; its miner keeps running on its own, and its portal holds K2 below. Its witness archive moved to `deployments/testnet-2026-09-13.witnesses.jsonl`, out of the served folder.

Sepolia (the rehearsal; the policy of `packages/bridge/src/policy.ts` for the `testnet` profile:
`PER_HOUR` 576 tYACA, `ALLOWANCE` 384 tYACA, 180 d exit floor, 30 d / 60 d pause, launch window −7 d / +90 d,
400 000 gas a leaf):

| | |
|---|---|
| Portal (`YacanaPortal`, verified) | [`0xD536D74Eedf1d2308bf8556402f37f4102eD63f7`](https://sepolia.etherscan.io/address/0xD536D74Eedf1d2308bf8556402f37f4102eD63f7#code) |
| YACA (`tYACA`, ERC-20, minter = the portal, verified) | [`0x109faf880CD5EAB47A3d9eeB4476aB736ea36ed4`](https://sepolia.etherscan.io/address/0x109faf880CD5EAB47A3d9eeB4476aB736ea36ed4#code) |
| Aztec Registry (the testnet's) | `0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba` |
| Operators (an EOA; the Safe comes with the mainnet plan) | [`0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`](https://sepolia.etherscan.io/address/0xFcc2238319aC360e985f1736aBB3df6251DAF6F5) |
| Listed forwarder (the relayer, a dedicated EOA since 2026-09-14) | [`0x6792D5eb…8bac`](https://sepolia.etherscan.io/address/0x6792D5eb75e1F025438349d454AC91378d9F8bac): its key is `YACANA_L1_FORWARDER_KEY` in the operator's shell, never in the repo; funded 0.2 ETH by [`0xa46ee51d…61c2`](https://sepolia.etherscan.io/tx/0xa46ee51defb2f44074adf52890669d505299bc9f3b3e7fd3a2cd975a91b661c2), listed by [`0x0453f88d…e250`](https://sepolia.etherscan.io/tx/0x0453f88d88b19eb14f311552499b429f05f938b6b6a59ba59af46d32614de250). The operators' address played both roles in the rehearsal (listed by [`0x47d74c3e…e658`](https://sepolia.etherscan.io/tx/0x47d74c3e57ab564aa70340b4571ef43759eba85d7ff7901dd35050c779d5e658)) and was unlisted by [`0xec860848…e103`](https://sepolia.etherscan.io/tx/0xec8608486bc1668479600d86b6ca8e4242b186799ac47444e25dfae611d9e103) |
| Registration of version 1821665230 (index 5) | [`0xff8724ed…9458`](https://sepolia.etherscan.io/tx/0xff8724ed02e7feb9712ca0683d9a7bf78ee8cca27327f71d3d17027ff0cb9458) |
| Deploy block / RPC in the record | 11695738 / `https://ethereum-sepolia-rpc.publicnode.com` |

The rehearsal's crossings, by a throwaway holder who mined two real claims on the new miner (the second,
[`0x282fde31…2727`](https://testnet.aztecscan.xyz/tx-effects/0x282fde31d2f705c1a6f68bbb296dae0c704640c7f703f7389104326ea2c22727),
is the example claim the landing shows):

| crossing | Aztec | Ethereum |
|---|---|---|
| K1: 1 tYACA exited to the operators' address | `exit_to_l1` [`0x2645bcbd…f745`](https://testnet.aztecscan.xyz/tx-effects/0x2645bcbda0c12526b448ee3f81154c675a0b08493c2b0bbbe12c532d091bf745) (epoch 2398 of the rollup) | forwarded and minted by [`0xfb5f7fc8…2888`](https://sepolia.etherscan.io/tx/0xfb5f7fc80f1b1d4f0821fb07cbb89b916f6c9db47df356e5bb66ab4decd02888) once the epoch was proven (`bun run bridge -- forward`, twelve minutes after the exit) |
| K3: 1 tYACA deposited into the live version, claimed to the holder | `claim_from_l1` [`0x0144c7f3…4cb6`](https://testnet.aztecscan.xyz/tx-effects/0x0144c7f3dbcd476ccd42c186b5943ce959592e2362954b2e88f97b3041ac4cb6) (Inbox index 75569152) | `deposit` [`0x4557ebb3…bb35`](https://sepolia.etherscan.io/tx/0x4557ebb341c77a5ba04696e499e2230dcd7843d83a1ab36d5d1c3e496cc4bb35) from the operators' YACA (the rehearsal's script also sent an `approve` the portal never needs; the page sends none) |
| K2: 1 tYACA sent ahead, held | `send_ahead` [`0x1da46805…5f8c`](https://testnet.aztecscan.xyz/tx-effects/0x1da46805334bd18e597ea272110c28a8f1d3352dfd218f156d1ce4e8592d5f8c) (redeem address `0x60bb1823…6637`) | held by the portal: no later version is registered, so `forward` keeps it ("no target record"); its witness is archived in `deployments/witnesses/testnet.jsonl` and served at `/witnesses/1821665230.jsonl`. Its landing on a next version is **pending validation**: the public testnet has not flipped |

After them `bun run bridge -- status` reads `exited 1 · inbound 1` for version 1821665230, the stats bridge page
on the branch preview reads the same from the portal, and the miner's wallet page on that preview shows the
bridge tile against the live headroom. Every step above ran from the arc-4 branch on preview deployments; the
apex and the `v5` custom domain are untouched.

## Archived — Yacana public testnet before the bridge, `testnet` profile (2026-09-05)

First deployment under the Yacana name: new domain tags (`YACA/*`), genesis seed, work-circuit VK and token
metadata; the contract logic is the hardened one of the pre-rename deployment below, without the bridge
functions. Still running; its record is `deployments/testnet-2026-09-05.json`, and the `yacana-v5` Worker's
rehearsal version above serves its last build as the old role.

| | |
|---|---|
| Node | `https://v5.testnet.rpc.aztec-labs.com` (L1 chain 11155111, node `5.2.0-nightly.20260815` at deploy time) |
| Miner (`YacanaMiner`) | `0x2091605cff5bb6658821ef6df7a268e7b499ff326cafba8a5696102212565e3e` |
| Token (aztec-standards `Token` v5.2.0, minter = miner, `bound_token()`) | `0x2f83633f946bdf7ea294183c9c49dfb4172646b1edf81a6fb4b4f305bbd42d88` |
| Deployer (initializerless Schnorr account, no privilege after `bind_token`) | `0x2c7a1312299762bab96e91d83c26c4bf1754959bf95854df117b42bca4e3c54b` |
| Miner salt / token salt | `0x0f4915a7…fa94c` / `0x17a20a0f…6c686` (full values in `deployments/testnet-2026-09-05.json`) |
| Miner class id / token class id | `0x20680945…bebb9` / `0x10fd5603…fecbf` |
| Rollup version (in the deploy domain) | 1821665230 |
| Fees | sponsored FPC (`SPONSORED_FPC_SALT`) |
| Deployed / launched | 2026-09-05T16:38:35.518Z / epoch 0 opened 2026-09-05T16:39:00Z (`launchAt` 1788626340, immediate: no notice or reveal window in this profile) |

## Archived — Elixir (pre-rename) public testnet, `testnet` profile (2026-09-04, hardened contract)

The protocol was renamed from Elixir to Yacana on 2026-09-05 (new domain separators, VK and token metadata), so this
deployment no longer matches the artifacts in the repo. It stays on chain; its record is kept byte-for-byte as
`deployments/elixir-testnet-2026-09-04.json`.

Supersedes the 01:27 UTC deployment of the pre-hardening contract (miner `0x1e57c929…90665f`), which stays on chain
but no longer matches the artifact; the 2 h soak in `docs/soak-report.md` ran against it.

| | |
|---|---|
| Node | `https://v5.testnet.rpc.aztec-labs.com` (L1 chain 11155111, node `5.2.0-nightly.20260815` at deploy time) |
| Miner (`ElixirMiner`) | `0x06ccc95e0260aa0cbd6c382ce0521563f6c2dead02470b5dd0332adbc3190015` |
| Token (aztec-standards `Token` v5.2.0, minter = miner, `bound_token()`) | `0x1fa8ff38a247fa569ef5c83109282491b64fbba4a81a77e684854a0ad4858f68` |
| Deployer (initializerless Schnorr account, no privilege after `bind_token`) | `0x2c7a1312299762bab96e91d83c26c4bf1754959bf95854df117b42bca4e3c54b` |
| Miner salt / token salt | `0x1b357136…9d75c` / `0x052b87dd…0d22` (full values in `deployments/elixir-testnet-2026-09-04.json`) |
| Miner class id / token class id | `0x25ce05d8…52ccd` / `0x10fd5603…fecbf` |
| Rollup version (in the deploy domain) | 1821665230 |
| Fees | sponsored FPC (`SPONSORED_FPC_SALT`) |
| Deployed / launched | 2026-09-04T15:04:27Z / epoch 0 opened 2026-09-04T15:05:24Z (`launchAt` 1788534324, immediate: no notice or reveal window in this profile) |

Parameters (the `testnet` profile, also embedded in the contract as compile-time globals):

| parameter | value |
|---|---|
| `N` (accepted claims per epoch) | 4 |
| `EXPECTED_EPOCH_SECONDS` | 300 |
| `T_MAX` (escape hatch, = 4 × expected) | 1200 |
| `REWARD` | 4 tELX (4 × 10^18, 18 decimals) |
| `INITIAL_TARGET` | 2^124 (≈ 16 proofs per winning ticket) |
| `GENESIS_SEED` | `0x454c582f746573746e6574` ("ELX/testnet") |
| `CHAIN_LEN` (work circuit) | 2048 |
| `VERSION` (domain separator) | 1 |
| `CLAIM_TTL_SECONDS` | 600 |
| `LAUNCH_NOTICE_SECONDS` / `REVEAL_WINDOW_SECONDS` | 0 / 0 (mainnet: 86400 / 600) |
| Token | "Elixir Testnet" / `tELX` |

Verify from public storage: `bun run epoch:stats -- deployments/elixir-testnet-2026-09-04.json` prints every
epoch's target, opening time, claim count, duration and retarget ratio.
