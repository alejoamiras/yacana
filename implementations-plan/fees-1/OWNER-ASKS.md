# fees-1 owner asks

## Settled (2026-10-30)

- OA1, what the flow says becomes public: superseded by ask25 (the visibility row names only the Ethereum wallet and
  the amount; no payer note).
- OA2, what the visitor asks for: P3-03 = S, "As it ships: spend an amount of a token, read the Fee Juice it buys."
- OA3, when the entry shows: P3-04 = I, "Only signed in, only on a network with no sponsor, and only while the
  account's Fee Juice is below what a claim costs."

## Open (a2 ships each in its "what ships now" form behind the flag; a3 applies the answers)

ask27's options D, E and F are not here: they go on the lane's next decision page from the shots.

### OA4: resuming a funding once the entry has gone

- **Surface**: the restore control of the picked option (the entry card in D and F, the dialog's first screen in E).
- **Fact**: P3-04 hides the entry while the account's Fee Juice covers a claim. A visitor who funded once, then lost
  the page during a second funding, holds enough Fee Juice and sees no entry, so no restore.
- **What ships now**: the restore lives only where the option puts it, so only while the entry shows.
- **Options**: (a) as it ships; (b) a "Resume a funding" line in Settings, always there in a flagged build;
  (c) the entry card also shows, with only its restore control, while a saved funding has not been claimed (needs
  the page journal of OA5 to know that).
- **Recommendation**: (b). It is the one place a visitor looks for a file-shaped chore, and it needs no new state.

### OA5: whether the page remembers a funding across a reload

- **Surface**: the card after a reload mid-funding.
- **Fact**: the real provider writes its record to local storage before any signature, so a closed tab loses
  nothing; the bridge journals its crossings in IndexedDB before the wallet is asked. Under the flag a2 keeps no
  record: a reload forgets a mocked funding unless its file is loaded.
- **What ships now**: no page memory; a reload shows the entry again (its restore control brings the funding back
  from the file).
- **Options**: (a) as it ships; (b) the record is kept in this browser from the save on, and a reload resumes it
  without the file; the file stays the way back after cleared site data.
- **Recommendation**: (b) for the real lane: losing a funding to a reload is the failure the file exists to prevent,
  and the bridge already keeps a journal. It adds persistent state, so it is yours to approve.

### OA6: the claim's minimum and fee on the quote

- **Surface**: the quote of every option.
- **Fact**: a funding's claim on Aztec needs a minimum amount (about 30 Fee Juice on the real provider's testnet),
  and the claim pays its own fee from the Fee Juice it claims (ask25).
- **What ships now**: a row "Least to claim · 30 Fee Juice"; when the least the quote delivers is below it, the row
  turns `warn`, a line under the amount says "Too little to claim: at least 30 Fee Juice must arrive", and "Fund
  fees" stays disabled. The claim's fee is a cost row, "Claim on Aztec · paid from what arrives".
- **Options**: (a) as it ships; (b) only the refusal line, no row while the amount is enough; (c) the minimum as the
  amount field's placeholder, in the token ("at least 60 USDC").
- **Recommendation**: (a). The minimum is a fact a visitor needs before typing, and the refusal without the row reads
  as arbitrary.

### OA7: three small details the options carry

- **Surface**: the quote's visibility row, the cockpit as the entry appears, the wallet chip.
- **What ships now**:
  - (a) A payment from Base Sepolia keeps ask25's row, "Visible on Ethereum: your wallet and the amount", although
    the payment is public on Base Sepolia first. Alternative: name the chain the payment leaves from ("Visible on
    Base Sepolia and Ethereum: your wallet and the amount").
  - (b) The entry card appears when the account's standing (sponsor, private Fee Juice, a claim's cost) is read, so
    the cockpit's rows move down once. Alternative: hold the card's place with a skeleton while the read runs.
  - (c) The chip's × disconnects the page's one Ethereum connection, the bridge's included, as it does in Wallet;
    this follows from ask27's "on the miner's existing injected-wallet connection". Alternative: no × in the flow.
- **Recommendation**: (a) name the chain, since a visitor paying from Base should know Base sees it; (b) as it
  ships, because under P3-04 the card shows on a few visits only; (c) as it ships.
