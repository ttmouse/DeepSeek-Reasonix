#!/usr/bin/env bash
set -euo pipefail
UPSTREAM_REPO="${UPSTREAM_REPO:-esengine/DeepSeek-Reasonix}"
SEEN_FILE="${HOME}/.reasonix/upstream-seen.json"
LIMIT=100
LABEL_FILTER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL_FILTER="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
GH_ARGS=(--repo "$UPSTREAM_REPO" --state open --limit "$LIMIT" --json number,title,labels,updatedAt,url)
if [[ -n "$LABEL_FILTER" ]]; then
  IFS=',' read -ra LABELS <<< "$LABEL_FILTER"
  for lbl in "${LABELS[@]}"; do
    GH_ARGS+=(--label "$lbl")
  done
fi
gh issue list "${GH_ARGS[@]}" 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
seen_file = '$SEEN_FILE'
seen = set()
try:
    with open(seen_file) as f:
        seen = set(json.load(f).get('seen', []))
except: pass
candidates = [i for i in data if i['number'] not in seen]
candidates.sort(key=lambda x: x.get('updatedAt', ''), reverse=True)
print(json.dumps({
    'meta': {
        'total_upstream': len(data),
        'new_candidates': len(candidates),
        'already_seen': len(seen),
        'upstream': '$UPSTREAM_REPO',
        'label_filter': '${LABEL_FILTER:-all}'
    },
    'candidates': candidates
}, indent=2, ensure_ascii=False))
"
