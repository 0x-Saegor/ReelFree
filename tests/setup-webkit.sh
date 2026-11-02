#!/usr/bin/env bash
# Installs Playwright WebKit and, without sudo, the system libs missing on this host
# (libavif16, libmanette-0.2-0 and their deps) by extracting the Ubuntu .debs into
# MiniBrowser's private lib dir. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
npx playwright install webkit >/dev/null 2>&1 || true   # host validation warning is expected
WK=$(ls -d "$HOME"/.cache/ms-playwright/webkit-* | sort -V | tail -1)
LIB="$WK/minibrowser-wpe/sys/lib"
missing() { LD_LIBRARY_PATH="$WK/minibrowser-wpe/lib:$LIB" ldd "$WK"/minibrowser-wpe/bin/* "$WK"/minibrowser-wpe/lib/*.so* 2>/dev/null | awk '/not found/{print $1}' | sort -u; }
[ -z "$(missing)" ] && { echo "webkit OK ($WK)"; exit 0; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for pkg in libavif16 libmanette-0.2-0 libyuv0 libgav1-2 libhidapi-hidraw0; do (cd "$TMP" && apt-get download "$pkg" >/dev/null 2>&1) || echo "warn: cannot download $pkg"; done
for f in "$TMP"/*.deb; do dpkg-deb -x "$f" "$TMP/x"; done
cp -a "$TMP"/x/usr/lib/x86_64-linux-gnu/*.so* "$LIB/"
m=$(missing); if [ -n "$m" ]; then echo "still missing: $m"; exit 1; fi
echo "webkit OK ($WK, libs patched)"
