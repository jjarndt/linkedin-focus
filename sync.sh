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
PROJECT_DIR="$(dirname "$(dirname "$DEST")")"
PROJECT="$PROJECT_DIR/$(basename "$PROJECT_DIR").xcodeproj/project.pbxproj"

if [[ ! -f "$PROJECT" ]]; then
  echo "Error: no Xcode project found at $PROJECT." >&2
  exit 1
fi

# Check the build phase before rsync can leave Xcode with missing resources.
EXTENSION_TARGET="$(basename "$(dirname "$DEST")")"
plutil -convert xml1 -o - "$PROJECT" | /usr/bin/python3 -c '
import plistlib
import sys
from pathlib import Path

source, target_name = sys.argv[1:]
objects = plistlib.loads(sys.stdin.buffer.read())["objects"]
target = next((
    obj for obj in objects.values()
    if obj["isa"] == "PBXNativeTarget" and obj["name"] == target_name
), None)
if target is None:
    sys.exit(f"Error: Xcode target {target_name} not found.")

bundled = set()
resource_sources = set()
for phase_id in target["buildPhases"]:
    phase = objects[phase_id]
    if phase["isa"] != "PBXResourcesBuildPhase":
        continue
    for file_id in phase["files"]:
        reference = objects[objects[file_id]["fileRef"]]
        path = Path(reference["path"])
        bundled.add(path.name)
        if path.parts[:1] == ("Resources",):
            resource_sources.add(path.relative_to("Resources"))

source = Path(source)
missing = sorted(
    path.name for path in source.iterdir()
    if not path.name.startswith(".") and path.name not in bundled
)
stale = sorted(str(path) for path in resource_sources if not (source / path).exists())
if missing:
    print("Error: the Xcode project does not bundle these extension resources:", file=sys.stderr)
    print("  " + "\n  ".join(missing), file=sys.stderr)
if stale:
    print("Error: the Xcode project still references removed resources:", file=sys.stderr)
    print("  " + "\n  ".join(stale), file=sys.stderr)
if missing or stale:
    sys.exit("Update the Copy Bundle Resources phase of the extension target or regenerate the Xcode project before syncing.")
' "$SRC" "$EXTENSION_TARGET"

rsync -av --delete "$SRC" "$DEST/"
echo "Synced extension/ -> $DEST"
