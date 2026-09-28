/** The stats page's reads from a terminal; the URL single-quoted, so a `&` or `?` in it never reaches the shell. */
export const reproduceCommand = (nodeUrl: string): string =>
  `AZTEC_NODE_URL='${nodeUrl.replace(/'/g, "'\\''")}' bun run epoch:stats`;
