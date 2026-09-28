// The in-app navigation event: popstate reports back and forward, not the page's own pushState and
// replaceState, so every router and every URL-held view listens for both.
export const NAVIGATE = 'yacana:navigate';

export const dispatchNavigate = (): void => {
  window.dispatchEvent(new Event(NAVIGATE));
};

export function subscribeLocation(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAVIGATE, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAVIGATE, cb);
  };
}
