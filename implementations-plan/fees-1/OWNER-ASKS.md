# fees-1 owner asks

None of these blocks a1. Each option ships behind the development flag in the form "what ships now" describes, and
the decision page shows that form. The page also says the captures are signed out, on a stand-in account. The
owner's answers land in a2.

## OA1: what the flow says becomes public

- **Surface**: the quote of whichever option is picked (the dialog's rows in A and B, the tile's rows in C).
- **Fact**: funding an account's own fees makes three things public. The deposit names the Aztec account on
  Ethereum. The Fee Juice balance is public. Every transaction the account pays for names it as the fee payer, its
  private claims included. Today the sponsor pays, so none of this is true of a Yacana account yet.
- **What ships now**: a row "Visible on Ethereum: your wallet, the amount and this account", in the place
  FromEthereum's dialog uses for the same row. Under it, a `Note`: "When this account pays its own fees, each
  transaction shows it as the payer." Funding changes nothing about who pays today: the sponsor still pays every
  transaction until a later lane changes that.
- **Options**:
  - (a) Keep both, as above.
  - (b) Keep the row, and drop the note.
  - (c) Say it once, behind a `Tip` on the words "pays its own fees".
- **Recommendation**: (a). The bridge dialog already tells visitors what Ethereum sees, and the fee payer is the new
  fact a private miner would not guess.

## OA2: what the visitor asks for, and what the quote says it buys

- **Surface**: the quote screen of every option (its input and its "you get" row), and the done state.
- **What ships now**: the visitor types an amount of the chosen token. The quote answers in Fee Juice ("about 12.4
  Fee Juice, at least 12.2"), and says nothing about how far it goes.
- **Options**:
  - (a) As it ships: spend an amount of a token.
  - (b) Ask for an amount of Fee Juice, and the quote says what it costs in the token.
  - (c) Ask for a number of claims ("enough for about 50 claims"). That needs a per-transaction fee estimate from
    the provider: one more field in the interface, mocked now.
- **Recommendation**: (c) once a real provider can estimate it, because a miner thinks in claims, not in Fee Juice.
  Until then (a), since a mocked count would read as a promise.

## OA3: when the entry shows

- **Surface**: the entry of whichever option is picked (A's balance line, B's card, C's tile).
- **What ships now**: under the flag, the entry shows whenever `?fees=` names the option, signed in or signed out
  (on a stand-in account), at any Fee Juice balance. This is a development affordance, not a rule.
- **Options for the rule the flag flip will need**:
  - (a) Only signed in, only on a network with no sponsor, and only while the account's Fee Juice is below what a
    claim costs.
  - (b) As (a), but also signed out, as a preview that leads to sign-in.
  - (c) Always on a network with no sponsor, with the balance shown beside it.
- **Recommendation**: (a). It keeps B a card that leaves once its job is done, and it says nothing to a visitor the
  sponsor already covers. The rule lands with the flag flip, in a later lane.
