#!/usr/bin/env bash
# Sync extension/ (source of truth) into the generated Safari project Resources dir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/extension/"

# Locate the Resources dir by finding the converter-produced manifest.json.
MANIFEST="$(find "$ROOT/SafariProject" -type f -name manifest.json \
  -path "*/Resources/manifest.json" 2>/dev/null | head -n1 || true)"

if [[ -z "${MANIFEST:-}" ]]; then
  echo "Error: no Resources/manifest.json found under $ROOT/SafariProject." >&2
  echo "Run Phase C (xcrun safari-web-extension-converter) first." >&2
  exit 1
fi

DEST="$(dirname "$MANIFEST")"
rsync -av --delete "$SRC" "$DEST/"
echo "Synced extension/ -> $DEST"
