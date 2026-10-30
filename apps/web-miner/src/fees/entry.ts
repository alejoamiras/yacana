// When the flow's entry shows: only signed in, only on a network with no sponsor, and only while the
// account's private Fee Juice is below one claim's fee. A trade already under way is not an entry: its
// card stays until dismissed, whatever the standing says.

import type { Standing } from './provider';

export const entryShows = (signedIn: boolean, s: Standing): boolean =>
  signedIn && !s.sponsored && s.privateFeeJuice < s.claimCost;

/** `?fees-session=stand-in`: a signed-out flagged page acts for a fixed account, so every state is reachable without a node. */
export const standsIn = (search: string): boolean =>
  new URLSearchParams(search).get('fees-session') === 'stand-in';
