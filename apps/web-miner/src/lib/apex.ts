// The apex as the old origin names it: the retired version's page points at the live app for the
// claim, the stats and the FAQ, none of which it serves itself. On the apex the same links stay
// on this origin.
import { isOldRole } from '../bridge/env';

const root = (import.meta.env.BASE_URL ?? '/').replace(/\/mine\/?$/, '/');

/** `https://yacana.network`: the relying party is the apex's host on every origin of the site. */
export const apexOrigin = (): string => {
  const id = import.meta.env.VITE_RP_ID;
  return id.startsWith('http') ? new URL(id).origin : `https://${id}`;
};

/** "yacana.network", for a sentence. */
export const apexHost = (): string => new URL(apexOrigin()).host;

/** The stats app: beside this one on the apex, on the apex alone from the old origin. */
export const statsHref = isOldRole() ? `${apexOrigin()}/stats/` : `${root}stats/`;

export const HOW_HREF = `${root}#how`;

/** The FAQ on the landing: served by the apex's root SPA fallback, which the old origin has not. */
export const FAQ_HREF = isOldRole() ? `${apexOrigin()}/faq` : `${root}faq`;
