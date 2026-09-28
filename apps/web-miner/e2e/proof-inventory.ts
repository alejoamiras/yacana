// The suite's inventory: each spec file's test titles and the browser transaction proofs a pass
// necessarily makes. The meter fails a passing test under its floor or off the list; the runner and
// the merge compare executed titles against it; a unit test holds it to the sources. Titles are the
// identity, so they must be unique across files (the unit test asserts it). No imports: bun and
// Playwright's loader both read this file.

export interface ProofEvent {
  /** The prover's own duration for the proof; NaN when the event carried none. */
  durationMs: number;
  at: number;
  /** Who made it: the page's prover names Presto; the PXE's WASM event names nobody. */
  prover?: string;
  /** Presto's phases, as ms since the proof began. */
  phases?: Record<string, number>;
}
export interface SendRecord {
  startedAt: number;
  endedAt: number;
}
export interface ProofMeter {
  proofs: ProofEvent[];
  /** Every `aztec_sendTx` round trip the page made. */
  sends: SendRecord[];
}

/** Spec file → test title → the browser proofs a pass necessarily made (a floor: the easy target keeps winning). */
export const INVENTORY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'miner.e2e.ts': {
    'first visit creates an account, mines at the easy target, claims and shows the balance': 2,
    'the first visit’s strip: shown to a new visitor, put away by its ×, still away after a reload': 0,
    'a poisoned CRS cache is purged before proving': 1,
    'three power changes keep mining, the ledger grows, memory stays bounded': 0,
    'a prover crash surfaces as an error and mining restarts on the next start': 0,
    'the mini window: page fonts, its own loop, two lines that fit, open across pages; Start opens it when asked, and mines when refused': 0,
  },
  'passkey.e2e.ts': {
    'a passkey account: create, mine, claim, reload with one touch, the balance follows the account': 1,
    'a known account whose passkey is gone does not open; the record stays': 0,
  },
  // The reverted claim, then the one that mints, after the first.
  'states.e2e.ts': {
    'the node going away pauses mining after a minute; its return resumes it': 0,
    'a lost race: the claim reverts, the chain view is rebuilt, the next claim mints, the balance survives': 3,
    'a node behind the rollup on L1 pauses mining; its catching up resumes it': 0,
  },
  // One claim, two transfers.
  'withdraw.e2e.ts': {
    'withdraw: private to a second key on this device, public to an address': 3,
  },
  'words.e2e.ts': {
    'a words account: create, quiz, mine, sign out, restore, same address': 0,
  },
  'opening.e2e.ts': {
    'page first; a cancel mid-opening forgets the intent, a Start mining that opens the account spends it': 0,
  },
  'switch.e2e.ts': {
    'a live switch A → B while mining, a claim after it, and the banner on a dead node': 1,
    'another deployment’s node, or one that does not answer, is refused under the field; the node in use is kept': 0,
  },
  // The real-proving canary: a tampered claim refused at proving, then the same claim minting restored;
  // a pruned anchor, refused at simulation, then the claim's one proof.
  'canary.e2e.ts': {
    'a claim with a bound public input altered is refused at proving before it is sent; restored, the same claim mints': 1,
    'a pruned anchor under the real prover: the win is proved again, sent once, mints, and mining resumes': 1,
  },
  // Each recovery proves its claim once: the pruned anchor fails before proving, the adopted claim is never sent again.
  'claim-recovery.e2e.ts': {
    'a pruned anchor: the same win is proved again, sent once, and minted': 1,
    'a claim whose receipt comes back without its effects is found in its block: adopted, never sent again': 1,
  },
  // The claim is the page's, whichever prover found the ticket; its own proof goes to Presto too, or to
  // WASM when Presto is cut mid-proof or consent is withdrawn. The hard deployment's titles never win.
  'presto.e2e.ts': {
    'no request reaches Presto before the click: load, sign-in, Start, the first proof; again resuming on open': 0,
    'through Presto: the pill says ✦ presto after the first native proof, and power is Presto’s': 0,
    'remembered: a reload opens on "used last time" and Start goes native with no click': 0,
    'a win Presto proved is verified in the browser before it shows, then claimed through Presto too; both proofs went over the wire': 1,
    'use the browser: the next claim is proved in the page': 1,
    'Presto gone mid-proof: the claim’s transmit fails, the browser finishes it, nothing is sent twice': 1,
    'nothing answers: the billboard invites the install and the browser proves without the suffix': 0,
  },
  // The W claim for a balance, the exit's burn, the deposit's claim; the wallet cells prove nothing.
  'bridge-states.e2e.ts': {
    'the bridge through the page: an exit forwarded and minted; a deposit through the picker on the wrong chain, refused once, left open once, its account changed, then landed and claimed': 3,
  },
};

/**
 * Specs the upgrade rig runs (`bun run rig -- browser`), never a shard: they need the rig's flip and
 * two builds. The meter still holds them to their floors; the shard merge ignores them.
 */
export const RIG_ONLY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // V5: the W claim, the exit's burn, the deposit's claim, two send-aheads' burns. V6: the arrival's claim.
  'bridge.e2e.ts': {
    'on V5: a words account mines one claim, exits to Ethereum (forwarded and minted), deposits through the picker and claims, and sends ahead twice': 5,
    'on V5 after the flip: the migration card says mining has ended and what is left can still be sent ahead': 0,
    'on V6: the same words restore the account, the recovery file brings the held send-aheads, one is forwarded from the page with the holder’s signature and claimed, the other redeemed to Ethereum': 1,
  },
  // One passkey, two origins: nothing is proved.
  'origin.e2e.ts': {
    'the versioned origin: the same passkey restores the apex’s account there, creates nothing, and mines nothing': 0,
  },
};

export const SPEC_FILES: readonly string[] = Object.keys(INVENTORY);

/** The replay lane's tests (`e2e/replay/*.replay.ts`); sharded + `MOVED_TO_REPLAY` is the original nineteen plus the canary. */
export const REPLAYED: Readonly<Record<string, readonly string[]>> = {
  'dialog-geometry.replay.ts': ['the account screens and their notes fit the dialog at 720 px tall'],
  'lna.replay.ts': [
    'the boundary is real: a secure context, targetAddressSpace, the descriptor that answers, and a fresh context reads prompt',
    'under prompt nothing reaches Presto: load, Start, remembered or not',
    'denied with Presto remembered: zero hits, and the card reads blocked',
    'prompt, then Look: the request waits for a grant in the same context, and the card reads found without a reload',
    'granted with Presto remembered: a reload probes silently, exactly once',
  ],
  'signed-out.replay.ts': [
    'a malformed RPC payload is rejected, not acted on',
    'an old Presto answers: the update row, and Retry re-asks',
    'the public epoch poll reads again from the recording, and nothing else',
  ],
};
export const MOVED_TO_REPLAY: readonly string[] = [
  'the account screens and their notes fit the dialog at 720 px tall',
  'a malformed RPC payload is rejected, not acted on',
  'an old Presto answers: the update row, and Retry re-asks',
];

/** Title → floor, over every file, the rig's included. */
export const EXPECTED_PROOFS: Readonly<Record<string, number>> = Object.assign(
  {},
  ...Object.values(INVENTORY),
  ...Object.values(RIG_ONLY),
) as Record<string, number>;

/** The titles the given spec files hold; a file outside the inventory throws. */
export function titlesOf(files: readonly string[]): string[] {
  return files.flatMap((f) => {
    const titles = INVENTORY[f];
    if (!titles) throw new Error(`${f} is not in the inventory (e2e/proof-inventory.ts)`);
    return Object.keys(titles);
  });
}

export const wellFormed = (p: ProofEvent): boolean => Number.isFinite(p.durationMs) && p.durationMs > 0;

/**
 * Why a passed test's meter does not satisfy the inventory, or null when it does. Under a proverless
 * build the floors do not apply and any proof event at all means the build proved after all.
 */
export function proofShortfall(title: string, meter: ProofMeter, proverless = false): string | null {
  const expected = EXPECTED_PROOFS[title];
  if (expected === undefined) return `"${title}" is not in the proof inventory (e2e/proof-inventory.ts)`;
  if (proverless)
    return meter.proofs.length
      ? `"${title}": ${meter.proofs.length} proof event(s) from a build that was to skip proving`
      : null;
  const good = meter.proofs.filter(wellFormed).length;
  const malformed = meter.proofs.length - good;
  if (malformed > 0)
    return `"${title}": ${malformed} proof event(s) without a positive duration — the collector is reading the wrong thing`;
  if (good < expected)
    return `"${title}": ${good} browser proof event(s) seen, ${expected} expected — the prover's console events did not reach the meter`;
  return null;
}
