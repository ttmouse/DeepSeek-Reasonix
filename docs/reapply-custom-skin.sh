#!/usr/bin/env bash
# reapply-custom-skin.sh - Re-apply [CUSTOM-SKIN] changes after rebase/merge
#
# Usage:  ./docs/reapply-custom-skin.sh
#
# After rebasing feat/new-skin-custom on top of a new upstream/main-v2,
# run this script to verify all custom-skin markers are still in place.
# If a marker is missing, the command to re-apply it is shown.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MISSING=0

check_marker() {
  local file="$1" marker="$2" hint="$3"
  if grep -q "$marker" "$file"; then
    echo "  ✓  $file  ($marker)"
  else
    echo "  ✗  $file  MISSING $marker"
    echo "     → $hint"
    MISSING=$((MISSING + 1))
  fi
}

echo "=== Verifying [CUSTOM-SKIN] markers ==="
echo ""

check_marker "internal/config/config.go" \
  "// \[CUSTOM-SKIN\]" \
  "Add:  case \"custom\": return \"custom\"  // [CUSTOM-SKIN]"

check_marker "internal/config/edit.go" \
  "// \[CUSTOM-SKIN\]" \
  "Add:  case \"custom\": c.Desktop.LayoutStyle = \"custom\"  // [CUSTOM-SKIN]"

check_marker "desktop/tabs.go" \
  "// \[CUSTOM-SKIN\]" \
  "Add:  case \"workbench\", \"creation\", \"custom\":  // [CUSTOM-SKIN]"

check_marker "desktop/frontend/src/App.tsx" \
  "// \[CUSTOM-SKIN\]" \
  "Add type union + normalize + sidebarCustom + CSS class (see docs/REAPPLY.md)"

check_marker "desktop/frontend/src/components/SettingsPanel.tsx" \
  "// \[CUSTOM-SKIN\]" \
  "Add type union + normalize + UI button"

echo ""

if [ $MISSING -eq 0 ]; then
  echo "✅ All [CUSTOM-SKIN] markers are present."
else
  echo "⚠️  $MISSING marker(s) missing — re-apply per hints above."
  exit 1
fi
