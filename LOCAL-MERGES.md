# local/dev 本地自定义合并记录

本文件记录 `local/dev` 分支在上游纯净版本之上合并的自定义分支清单。
维护规则：每次合并/移除本地 PR 分支后更新本表，并保证与 git 历史（`merge: * (本地 PR)` 标记的 merge commit）一致。

## 当前基线

- 上游基线：`upstream/main-v2 @ 3bc93c07a`（2026-08-20，Merge pull request #8748）
- 生成报告：`bash tools/local-merge-report.sh local/dev`

## 合并清单

| 合并日期 | 分支 | 说明 | 上游状态 |
|---|---|---|---|
| 2026-08-20 | feat/new-skin-custom | 右侧 dock 快捷指令面板（InstructionPanel，squash 提取） | 未合入 |
| 2026-08-20 | fix/qq-gateway-handshake | 修复 QQ 网关握手（drop unauthorized intents） | 未合入 |

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
