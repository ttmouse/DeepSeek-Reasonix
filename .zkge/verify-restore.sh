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

echo "=== 还原验证：18 项调整 ==="

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

# ---------- C10: 文件树图标位置/样式 ----------
note "C10 FolderTree / workspace-tree__icon"
if grep -c "workspace-tree__icon" src/styles.css 2>/dev/null | grep -q "^[4-9]\|[0-9][0-9]" \
   && grep -n "toggleTreeRail" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q . \
   && grep -c "FolderTree" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[1-9]"; then
  ok "C10 文件树图标（workspace-tree__icon ≥4 + toggleTreeRail 按钮存在 + FolderTree 图标 ≥1）"
else
  bad "C10 文件树图标（workspace-tree__icon 不足或 FolderTree 按钮位置改变）"
fi

# ---------- C11: 改动面板行结构/hover/revert/徽章 ----------
note "C11 workspace-change-row/revert/badge/active"
row_n=$(grep -c "workspace-change-row" src/styles.css 2>/dev/null || echo 0)
revert_n=$(grep -c "workspace-change__revert" src/styles.css 2>/dev/null || echo 0)
badge_n=$(grep -c "workspace-change__badge" src/styles.css 2>/dev/null || echo 0)
active_n=$(grep -c "workspace-change--active" src/styles.css 2>/dev/null || echo 0)
if [[ $row_n -ge 5 && $revert_n -ge 5 && $badge_n -ge 3 && $active_n -ge 3 ]]; then
  ok "C11 改动面板样式（row=$row_n revert=$revert_n badge=$badge_n active=$active_n）"
else
  bad "C11 改动面板样式（row=$row_n revert=$revert_n badge=$badge_n active=$active_n，回退阈值 row≥5 revert≥5 badge≥3 active≥3）"
fi

# ---------- C12: 文件树宽度保持（列表↔详情布局） ----------
note "C12 savedTreeWidth / treeWidthMode / shouldInitializeWorkspaceSplitOnFileSelect"
if grep -c "treeWidthMode" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[5-9]\|[0-9][0-9]" \
   && grep -c "shouldInitializeWorkspaceSplitOnFileSelect" src/lib/workspaceSplit.ts 2>/dev/null | grep -q "^[1-9]" \
   && grep -c 'savedTreeWidth: treeWidthMode === "manual" ? treeWidth : null' src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[1-9]"; then
  ok "C12 文件树宽度保持（treeWidthMode ≥5 + shouldInitializeWorkspaceSplitOnFileSelect + savedTreeWidth=manual）"
else
  bad "C12 文件树宽度保持（treeWidthMode/shouldInitialize/savedTreeWidth 缺失，手动宽度会重置）"
fi

# ---------- C13: 面板内部边界线 ----------
note "C13 split-preview border + workspace-tree-resizer"
if grep -A3 "workspace-panel--split-preview" src/styles.css 2>/dev/null | grep -q "border-left" \
   && grep -c "workspace-tree-resizer" src/styles.css 2>/dev/null | grep -q "^[3-9]\|[0-9][0-9]"; then
  ok "C13 面板内部边界（split-preview 去左边框 + workspace-tree-resizer ≥3）"
else
  bad "C13 面板内部边界（split-preview border-left 或 workspace-tree-resizer 缺失）"
fi

# ---------- C14: dock 开合按项目记忆 ----------
note "C14 workspacePanelOpenStorageKey"
if grep -c "workspacePanelOpenStorageKey" src/store/layout.ts 2>/dev/null | grep -q "^[1-9]" \
   && grep -c "saveWorkspacePanelOpen(true, activeWorkspaceRoot)\|saveWorkspacePanelOpen(false, activeWorkspaceRoot)" src/App.tsx 2>/dev/null | grep -q "^[1-9]"; then
  ok "C14 dock 开合按项目记忆（workspacePanelOpenStorageKey + 按 workspaceRoot 保存）"
else
  bad "C14 dock 开合按项目记忆（workspacePanelOpenStorageKey 或按 root 保存缺失）"
fi

# ---------- C15: dock 宽 + 树宽持久化 ----------
note "C15 saveRightDockTreeWidth + WORKSPACE_TREE_WIDTH_KEY"
if grep -c "saveRightDockTreeWidth" src/store/layout.ts 2>/dev/null | grep -q "^[1-9]" \
   && grep -c "WORKSPACE_TREE_WIDTH_KEY" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[2-9]\|[0-9][0-9]"; then
  ok "C15 dock 宽 + 树宽持久化（saveRightDockTreeWidth + WORKSPACE_TREE_WIDTH_KEY ≥2）"
else
  bad "C15 dock 宽 + 树宽持久化（saveRightDockTreeWidth 或 WORKSPACE_TREE_WIDTH_KEY 缺失）"
fi

# ---------- C16: 打开的文件状态记忆 ----------
note "C16 WORKSPACE_SELECTED_PATH_KEY"
if grep -c "WORKSPACE_SELECTED_PATH_KEY" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[3-9]\|[0-9][0-9]" \
   && grep -c "workspacePanelSession" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[3-9]\|[0-9][0-9]"; then
  ok "C16 打开的文件状态记忆（WORKSPACE_SELECTED_PATH_KEY ≥3 + workspacePanelSession）"
else
  bad "C16 打开的文件状态记忆（WORKSPACE_SELECTED_PATH_KEY 或 workspacePanelSession 缺失）"
fi

# ---------- C17: 最近文件列表独立持久化 ----------
note "C17 WORKSPACE_RECENT_PATHS_KEY + recentPaths"
if grep -c "WORKSPACE_RECENT_PATHS_KEY" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[1-9]" \
   && grep -c "recentPaths" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[3-9]\|[0-9][0-9]" \
   && grep -c "const recentFiles = useMemo(() => \[...recentPaths\]" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[1-9]"; then
  ok "C17 最近文件列表独立持久化（RECENT_PATHS_KEY + recentPaths ≥3 + recentFiles 用 recentPaths）"
else
  bad "C17 最近文件列表独立持久化（RECENT_PATHS_KEY/recentPaths/recentFiles 缺失）"
fi

# ---------- C18: 树滚动位置持久化 ----------
note "C18 WORKSPACE_TREE_SCROLL_KEY + latestScrollTopRef"
if grep -c "WORKSPACE_TREE_SCROLL_KEY" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[2-9]\|[0-9][0-9]" \
   && grep -c "latestScrollTopRef" src/components/WorkspacePanel.tsx 2>/dev/null | grep -q "^[2-9]\|[0-9][0-9]"; then
  ok "C18 树滚动位置持久化（WORKSPACE_TREE_SCROLL_KEY ≥2 + latestScrollTopRef ≥2）"
else
  bad "C18 树滚动位置持久化（WORKSPACE_TREE_SCROLL_KEY 或 latestScrollTopRef 缺失）"
fi

# ---------- 自动化测试（C1-C6/C12/C14-C18 相关） ----------
echo ""
echo "=== 自动化测试 ==="
for t in workspace-layout workspace-tree-scroll-restore workspace-changes-errors topicbar-controls workspace-tree-memory workspace-split workspace-change-status workspace-preview-css; do
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
echo "  全部 18 项调整已还原 ✅"
exit 0
