#!/usr/bin/env bash
# 生成 local/dev 本地自定义合并报告。
# 用法: tools/local-merge-report.sh [分支名]
set -euo pipefail

BRANCH="${1:-local/dev}"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/main-v2}"

cd "$(git rev-parse --show-toplevel)"

echo "=== 分支: $BRANCH ==="
echo
echo "=== 上游基线 (merge-base) ==="
git merge-base "$BRANCH" "$UPSTREAM_REF" | xargs git log -1 --format="%h %ad %s" --date=short
echo
echo "=== 落后/领先上游 ==="
git rev-list --left-right --count "$UPSTREAM_REF"...$BRANCH | awk '{print "落后上游: "$1" 个提交, 领先上游: "$2" 个提交"}'
echo
echo "=== 本地自定义合并 (merge: * (本地 PR)) ==="
git log "$BRANCH" --grep="本地 PR" --format="%h %ad %s" --date=short || echo "(无)"
