#!/usr/bin/env bash
# Sync extension/ (source of truth) into the generated Safari project Resources dir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/extension/"

# Locate the Resources dir by finding the converter-produced manifest.json.
# Build products (build/, DerivedData/, *.appex bundles) also contain a
# Resources/manifest.json copy — exclude them, and refuse to guess if the
# match is still ambiguous.
MATCHES="$(find "$ROOT/SafariProject" -type f -name manifest.json \
  -path "*/Resources/manifest.json" \
  -not -path "*/build/*" -not -path "*/DerivedData/*" -not -path "*.appex/*" \
  2>/dev/null || true)"

if [[ -z "${MATCHES:-}" ]]; then
  echo "Error: no Resources/manifest.json found under $ROOT/SafariProject." >&2
  echo "Run Phase C (xcrun safari-web-extension-converter) first." >&2
  exit 1
fi

if [[ "$(wc -l <<<"$MATCHES")" -gt 1 ]]; then
  echo "Error: multiple Resources/manifest.json candidates found:" >&2
  echo "$MATCHES" >&2
  echo "Remove the stale copies (or narrow the find) so the sync target is unambiguous." >&2
  exit 1
fi

MANIFEST="$MATCHES"

DEST="$(dirname "$MANIFEST")"
rsync -av --delete "$SRC" "$DEST/"
echo "Synced extension/ -> $DEST"
