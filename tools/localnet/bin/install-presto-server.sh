#!/usr/bin/env bash
# Installs the pinned headless Presto (`presto-server`) for the miner's live test and its e2e lane.
# The release and every asset's SHA-256 are committed here: a checksum fetched beside the binary
# would only guard against corruption, not against a replaced release. Every run downloads and
# verifies the archive: a binary already in place is not trusted on the strength of its own output.
#   tools/localnet/bin/install-presto-server.sh [dest-dir]   (default ~/.local/bin; CI passes the runner's PATH dir)
set -euo pipefail

VERSION="1.2.1"
TAG="presto-v${VERSION}"
REPO="alejoamiras/presto"
DEST="${1:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  ASSET="presto-server-${VERSION}-linux-x86_64.tar.gz";  SHA="87008a9ad2a27c68d03be41957503d0aa31143a21b35d0411932178389e5bb62" ;;
  Linux-aarch64) ASSET="presto-server-${VERSION}-linux-arm64.tar.gz";   SHA="c18d3f84a4ff4ca5944ef233c53db0233b0ca2fc13e6064efb2a039fc44f7880" ;;
  Darwin-arm64)  ASSET="presto-server-${VERSION}-macos-arm64.tar.gz";   SHA="20680164a5ea81fc0b3b0e2bf2557f35a4c69c54c8b244389030b37910ef1d48" ;;
  Darwin-x86_64) ASSET="presto-server-${VERSION}-macos-x86_64.tar.gz";  SHA="740c484fa51bba6383fdb95a4c24ec12ac36f5c2a119b51756cdc451350419d2" ;;
  *) echo "no presto-server ${VERSION} build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 3 -o "$WORK/$ASSET" "https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
echo "${SHA}  $WORK/$ASSET" | sha256sum -c - >/dev/null
tar -xzf "$WORK/$ASSET" -C "$WORK"
BIN="$(find "$WORK" -type f -name 'presto-server*' ! -name '*.tar.gz' | head -1)"
[ -n "$BIN" ] || { echo "the archive holds no presto-server binary" >&2; exit 1; }
mkdir -p "$DEST"
install -m 0755 "$BIN" "$DEST/presto-server"
echo "presto-server ${VERSION} → $DEST/presto-server"
