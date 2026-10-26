// Where the page is served decides what it may do with keys. This gate steers honest bundles: the
// preview suffix trusts the account's matching workers.dev namespace, not the code's provenance.
// `versioned` is the origin a version's last build moves to after a flip (`v<N>.yacana.network`): a
// fully trusted sibling built by the same pipeline, where an account is restored, never created —
// its passkeys are the apex's (the RP ID), so the same master opens there after user verification.
export type HostKind = 'production' | 'preview' | 'local' | 'versioned' | 'unknown';

const LABEL = /^[a-z0-9-]+$/;

const isPreview = (hostname: string): boolean => {
  const suffix = import.meta.env.VITE_PREVIEW_HOST_SUFFIX;
  if (!suffix || !hostname.endsWith(suffix)) return false;
  return LABEL.test(hostname.slice(0, -suffix.length));
};

/** The versioned origin's host, or '' when the build names none. */
export const versionedHost = (): string => {
  try {
    return new URL(import.meta.env.VITE_OLD_APP_ORIGIN).hostname;
  } catch {
    return '';
  }
};

export const hostKind = (hostname: string): HostKind => {
  if (hostname === import.meta.env.VITE_RP_ID) return 'production';
  if (hostname !== '' && hostname === versionedHost()) return 'versioned';
  if (isPreview(hostname)) return 'preview';
  if (hostname === 'localhost') return 'local';
  return 'unknown';
};

/** The WebAuthn relying party for this host: the preview host itself, else the pinned production RP ID (eligibility is `keysAllowed`). */
export const relyingParty = (hostname: string): string =>
  hostKind(hostname) === 'preview' ? hostname : import.meta.env.VITE_RP_ID;

/** Twelve words are the same account on every host, so the preview banner warns against carrying them over. */
export const previewNotice = (hostname: string): string | null => {
  switch (hostKind(hostname)) {
    case 'preview':
      return `Preview on ${hostname}. Use a new account for testing; never reuse twelve words between this preview and ${import.meta.env.VITE_RP_ID}.`;
    case 'unknown':
      return `This is not ${import.meta.env.VITE_RP_ID}. Accounts cannot be created or restored here.`;
    default:
      return null;
  }
};

/**
 * Whether this host may create a key, or restore one: the apex and its previews do both, localhost
 * outside production does both, the versioned origin restores only (a key made there would be
 * stranded on a version about to stop), and anything else does neither.
 */
export const keysAllowed = (hostname: string, purpose: 'create' | 'restore' = 'create'): boolean => {
  const kind = hostKind(hostname);
  const eligible =
    kind === 'production' ||
    kind === 'preview' ||
    kind === 'versioned' ||
    (kind === 'local' && import.meta.env.VITE_SITE_MODE !== 'production');
  if (!eligible) return false;
  // The old role restores wherever it is eligible, its previews included; it never makes an account.
  if (kind === 'versioned' || import.meta.env.VITE_APP_ROLE === 'old') return purpose === 'restore';
  return true;
};
