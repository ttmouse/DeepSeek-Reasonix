# local/dev 本地自定义合并记录

本文件记录 `local/dev` 分支在上游纯净版本之上合并的自定义分支清单。
维护规则：每次合并/移除本地 PR 分支后更新本表，并保证与 git 历史（`merge: * (本地 PR)` 标记的 merge commit）一致。

## 当前基线

- 上游基线：`upstream/main-v2 @ a8c41e239`（2026-08-20，Merge pull request #9190，含 v1.31.0 发布 + PR #8261 heartbeat 面板优化 + PR #9179 composer 相关）
- 生成报告：`bash tools/local-merge-report.sh local/dev`

## 合并清单

| 合并日期 | 分支 | 说明 | 上游状态 |
|---|---|---|---|
| 2026-08-20 | pr/switch-model-while-streaming | 回答运行中切换模型，下一轮生效（PR #9187，cherry-pick） | PR #9187（OPEN） |
| 2026-08-20 | feat/new-skin-custom | 右侧 dock 快捷指令面板（InstructionPanel，squash 提取） | 未合入 |
| 2026-08-20 | fix/qq-gateway-handshake | 修复 QQ 网关握手（drop unauthorized intents） | 未合入 |
| 2026-08-20 | feat/chat-history-sidebar | 类ChatGPT对话历史侧边栏（悬停浮层+滚动同步），保留 Virtuoso 结构替换 QuestionJumpBar | PR #5634（CONFLICTING） |
| 2026-08-20 | fix/workspace-tree-icon-gap | 清理 workspace 预览面板：移除 44px rail 列、冗余面包屑与空 meta 行（cherry-pick 功能提交） | PR #9193（OPEN） |

## 维护操作速查

```bash
# 合并一个新 PR 分支并记录
git merge <分支> -m "merge: <分支> (本地 PR)"
# 然后在上面表格追加一行

# 同步上游最新
git fetch upstream
git merge upstream/main-v2

# 重建 local/dev（上游变化大时）
git branch -f local/dev upstream/main-v2
git merge <分支1> <分支2> ...   # 重新合入，rerere 复用冲突解法
# 然后更新本文件基线 + 表格

# 查看历史记录（git 原生，不可篡改）
git log local/dev --grep="本地 PR" --format="%h %ad %s" --date=short
```
