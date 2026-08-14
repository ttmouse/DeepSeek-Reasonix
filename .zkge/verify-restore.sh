#!/usr/bin/env bash
# ============================================================
# 还原验证脚本：chat-panel-resize-min-400 分支的 9 项调整
# 用法：bash .zkge/verify-restore.sh [--verbose]
# 每次 rebase / merge / 上游同步后运行，逐项确认调整是否被还原。
# 任一 FAIL = 该项被改坏，按 C# 定位修复，不混在其他项里。
# 返回码：0 = 全部还原；非 0 = 有 FAIL
# ============================================================
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1
PASS=0; FAIL=0; FAILED_ITEMS=()

note() { [[ $VERBOSE -eq 1 ]] && echo "  … $1"; }
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_ITEMS+=("$1"); echo "  FAIL  $1"; }

cd "$ROOT/desktop/frontend" || { echo "无法进入 desktop/frontend"; exit 1; }

echo "=== 还原验证：9 项调整 ==="

# ---------- C1: chat 面板 400px 下限 ----------
note "C1 workspacePanelAvailableWidth 定义"
if grep -c "workspacePanelAvailableWidth" src/App.tsx 2>/dev/null | grep -q "^[4-9]\|[0-9][0-9]"; then
  ok "C1 chat 400px 下限（workspacePanelAvailableWidth 引用 ≥4 处）"
else
  bad "C1 chat 400px 下限（workspacePanelAvailableWidth 引用不足，可能被改坏）"
fi

# ---------- C2: TopicbarMoreMenu ----------
note "C2 TopicbarMoreMenu"
if [[ -f src/components/TopicbarMoreMenu.tsx ]] && grep -c "TopicbarMoreMenu" src/App.tsx 2>/dev/null | grep -q "^[2-9]"; then
  ok "C2 More 菜单（组件存在 + App 引用）"
else
  bad "C2 More 菜单（TopicbarMoreMenu 缺失或未引用）"
fi

# ---------- C3: 单宽度 dock ----------
note "C3 preferredWorkspacePanelWidth"
if grep -n "const preferredWorkspacePanelWidth" src/App.tsx 2>/dev/null | grep -q "rightDockTreeWidth" \
   && ! grep -n "const preferredWorkspacePanelWidth" src/App.tsx 2>/dev/null | grep -q "rightDockDetailActive"; then
  ok "C3 单宽度 dock（preferredWorkspacePanelWidth = rightDockTreeWidth，无 detail 分支）"
else
  bad "C3 单宽度 dock（可能被上游双宽度改回）"
fi

# ---------- C4: 选择隔离 ----------
note "C4 selectedChangePath"
if grep -c "selectedChangePath" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[5-9]\|[0-9][0-9]"; then
  ok "C4 文件/变更选择隔离（selectedChangePath ≥5 处）"
else
  bad "C4 文件/变更选择隔离（selectedChangePath 不足）"
fi

# ---------- C5: 树滚动恢复 ----------
note "C5 pendingScrollRestoreRef"
if grep -c "pendingScrollRestoreRef" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[4-9]"; then
  ok "C5 树滚动恢复（pendingScrollRestoreRef ≥4 处）"
else
  bad "C5 树滚动恢复（pendingScrollRestoreRef 不足）"
fi

# ---------- C6: 变更行 hover/徽章样式 ----------
note "C6 styles.css workspace-change"
if grep -c "workspace-change" src/styles.css 2>/dev/null | grep -q "^[1-9][0-9]"; then
  ok "C6 变更行 hover/徽章样式（workspace-change 类 ≥10）"
else
  bad "C6 变更行 hover/徽章样式（workspace-change 类不足）"
fi

# ---------- C7: 侧边栏暖白 ----------
note "C7 --sidebar-bg"
if grep -n '\-\-sidebar-bg' src/styles.css 2>/dev/null | grep -q '#f9f9f9'; then
  ok "C7 侧边栏暖白（--sidebar-bg = #f9f9f9）"
else
  bad "C7 侧边栏暖白（--sidebar-bg 非 #f9f9f9）"
fi

# ---------- C8: 面包屑 ----------
note "C8 workspace-current-file__crumb"
if grep -c "workspace-current-file__crumb" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^4$"; then
  ok "C8 面包屑（workspace-current-file__crumb = 4）"
else
  bad "C8 面包屑（workspace-current-file__crumb 非 4）"
fi

# ---------- C9: 分隔条细线 ----------
note "C9 resizer 规则"
if grep -c "sidebar-resizer\|workspace-panel-resizer" src/styles.css 2>/dev/null | grep -q "^[5-9]\|[0-9][0-9]"; then
  ok "C9 分隔条细线（resizer 规则 ≥5）"
else
  bad "C9 分隔条细线（resizer 规则不足）"
fi

# ---------- 自动化测试（C1/C4/C5 强相关） ----------
echo ""
echo "=== 自动化测试 ==="
for t in workspace-layout workspace-tree-scroll-restore workspace-changes-errors topicbar-controls; do
  f="src/__tests__/$t.test.tsx"
  [[ -f "$f" ]] || f="src/__tests__/$t.test.ts"
  if [[ -f "$f" ]]; then
    note "run $t"
    if npx tsx "$f" >/tmp/zkge-test-$t.log 2>&1; then
      ok "测试 $t"
    else
      bad "测试 $t（见 /tmp/zkge-test-$t.log）"
    fi
  else
    note "skip $t（无测试文件）"
  fi
done

echo ""
echo "=== 结果：$PASS 通过 / $FAIL 失败 ==="
if [[ $FAIL -gt 0 ]]; then
  printf '  FAIL 项: %s\n' "${FAILED_ITEMS[@]}"
  exit 1
fi
echo "  全部 9 项调整已还原 ✅"
exit 0
