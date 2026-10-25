# Vendored from aztec-packages v6.0.0

`l1-contracts/src` at tag `v6.0.0` (the commit `toolchain.lock.json` pins for the Noir dependencies):

| here | there |
|---|---|
| `DataStructures.sol` | `core/libraries/DataStructures.sol` |
| `Hash.sol` | `core/libraries/crypto/Hash.sol` |
| `IInbox.sol`, `IOutbox.sol` | `core/interfaces/messagebridge/` |
| `IRegistry.sol` | `governance/interfaces/IRegistry.sol` (the reward distributor typed as `address`) |
| `Errors.sol` | the message-box and Merkle subset of `core/libraries/Errors.sol` (same signatures, same selectors) |
| `Constants.sol` | the six constants the boxes check, from `core/libraries/ConstantsGen.sol` |
| `TimeLib.sol` | the three user types of `shared/libraries/TimeMath.sol` |

Under `test/aztec/`: the real `Outbox.sol`, `Inbox.sol` and `MerkleLib.sol` with imports rewritten to this
layout and the rollup typed as `address`; `FeeJuicePortalStub.sol` stands in for the portal
the Inbox constructs. The portal's tests consume messages against these, not against mocks.

Refresh on an Aztec bump: copy, rewrite the imports, rerun the tests.
