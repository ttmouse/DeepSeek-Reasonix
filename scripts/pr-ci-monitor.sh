#!/bin/bash
# pr-ci-monitor — 轻量 PR CI 监控脚本
# 检测 CI 通过后，写入指定格式消息供 AI 读取
set -euo pipefail

CMD="${1:-help}"
PR_NUM="${2:-}"
DIR=""

# 解析 --dir 参数
for arg in "$@"; do
  case "$arg" in
    --dir=*) DIR="${arg#*=}" ;;
    --dir) ;;
  esac
done

case "$CMD" in
  test)
    MSG_FILE="/tmp/pr-ci-test.msg"
    cat > "$MSG_FILE" <<EOF
🧪 pr-ci-monitor 推送测试：如果你看到这条消息，说明脚本推送机制工作正常 --dir ${DIR:-$(pwd)}
EOF
    echo "✅ 测试消息已写入 $MSG_FILE"
    echo "$(cat "$MSG_FILE")"
    ;;

  monitor)
    if [ -z "$PR_NUM" ]; then
      echo "用法: pr-ci-monitor monitor <PR_NUMBER> [--dir <path>]"
      exit 1
    fi
    REPO="esengine/DeepSeek-Reasonix"
    MSG_FILE="/tmp/pr-ci-${PR_NUM}.msg"
    MAX_POLLS=20
    POLL_INTERVAL=60

    echo "🔍 开始监控 PR #${PR_NUM} CI 状态，每 ${POLL_INTERVAL}s 检查一次"

    for i in $(seq 1 $MAX_POLLS); do
      CHECKS=$(gh pr checks "$PR_NUM" --repo "$REPO" --json name,state 2>/dev/null || echo "[]")
      PENDING=$(echo "$CHECKS" | python3 -c "import sys,json; c=json.load(sys.stdin); print(sum(1 for x in c if x['state']=='pending'))" 2>/dev/null)
      FAILED=$(echo "$CHECKS" | python3 -c "import sys,json; c=json.load(sys.stdin); print(sum(1 for x in c if x['state']=='fail' or x['state']=='failure'))" 2>/dev/null)

      if [ "$FAILED" -gt 0 ] 2>/dev/null; then
        cat > "$MSG_FILE" <<EOF
❌ pr-ci-monitor：PR #${PR_NUM} CI 检查失败 --dir ${DIR:-$(pwd)}
EOF
        echo "❌ CI 失败，已写入 $MSG_FILE"
        exit 1
      fi

      if [ "$PENDING" -eq 0 ] 2>/dev/null; then
        cat > "$MSG_FILE" <<EOF
✅ pr-ci-monitor：PR #${PR_NUM} CI 全部通过 --dir ${DIR:-$(pwd)}
EOF
        echo "✅ CI 全部通过，已写入 $MSG_FILE"
        exit 0
      fi

      echo "  [${i}/${MAX_POLLS}] ⏳ 还剩 ${PENDING} 项检查..."
      sleep "$POLL_INTERVAL"
    done

    cat > "$MSG_FILE" <<EOF
⏰ pr-ci-monitor：PR #${PR_NUM} CI 监控超时（${MAX_POLLS} 次）--dir ${DIR:-$(pwd)}
EOF
    echo "⏰ 监控超时"
    exit 2
    ;;

  *)
    echo "用法:"
    echo "  pr-ci-monitor test [--dir <path>]               — 测试推送机制"
    echo "  pr-ci-monitor monitor <PR_NUMBER> [--dir <path>] — 监控 PR CI 状态"
    ;;
esac
