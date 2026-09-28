// The explorer links the stats pages show, from the build's configured base.
import { explorer, explorerBase } from '@yacana/web-kit/browser/explorer';
import { l1Explorer } from '@yacana/web-kit/browser/l1-explorer';

export const links = explorer(explorerBase(import.meta.env.VITE_EXPLORER_URL));
/** The Ethereum side's links: YACA, the portal, the keys. */
export const l1Links = l1Explorer(import.meta.env.VITE_L1_EXPLORER_URL);
