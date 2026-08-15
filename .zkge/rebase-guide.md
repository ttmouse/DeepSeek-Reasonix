# 清单驱动的 Rebase 流程（C1-C18 为裁决依据）

> 目的：把「rebase 后本地特性被上游覆盖」从**事后发现**变成**事前可控**。
> 每个冲突不再是「凭感觉选边」，而是「查清单 → 按 oracle/counterexample 裁决 → 验证」。
> 本流程与 `.zkge/` 配套使用：rebase 前、中、后都跑 `verify-restore.sh`。

## 核心原则（回答「是不是可以放心了」）

**可以放心，但放心来自机制而非运气**：
1. **18 项调整全部有可执行断言**（grep 探针 + 测试），任何一项被覆盖 → `verify-restore.sh` 立即 FAIL，指明是 C#，不混在其他项里
2. **冲突裁决有依据**：每个冲突区域先问「它保护哪个 C#」，再按该 C# 的 oracle 决定选边——不再凭感觉
3. **hard_gate 兜底**：C1/C2/C3/C4/C5/C12/C14/C15/C16/C17 是硬门禁，rebase 后必须全绿才允许继续

---

## 流程（四阶段）

### 阶段 0：rebase 前（基线）

```bash
# 0.1 确认分支干净、上游最新
git status -sb
git fetch upstream main-v2

# 0.2 基线验证——当前 18 项全绿是唯一合法起点
bash .zkge/verify-restore.sh        # 必须 "22 通过 / 0 失败"

# 0.3 记录基线快照（存入 evidence/）
mkdir -p .zkge/evidence/pre-rebase-$(date +%Y%m%d-%H%M%S)
bash .zkge/verify-restore.sh > .zkge/evidence/pre-rebase-*/baseline.txt
git log --oneline -1 > .zkge/evidence/pre-rebase-*/head.txt
```

### 阶段 1：rebase（逐提交，有冲突就解决）

```bash
git rebase upstream/main-v2
```

rebase 会逐个重放 14 个提交。**每个冲突必须走「裁决三步」**（见下节），禁止直接 `--ours`/`--theirs` 选边。

### 阶段 2：每个冲突的裁决三步

```
第 1 步 归属判断：这个冲突区域保护哪个 C#？
  ├─ 找到对应 C# → 走第 2 步
  ├─ 上游新增功能（本地无对应 C#）→ 合入上游，不选边（上游功能必须保留）
  └─ 纯上游内部改动（与 C1-C18 无关）→ 跟随上游即可

第 2 步 按 oracle 裁决：该 C# 的 counterexample 会不会被触发？
  ├─ 选「保留本地」→ 用 git checkout --ours <file> 或手动保留本地片段
  ├─ 选「跟随上游」→ 用 git checkout --theirs <file>（仅当上游实现满足该 C# 的 oracle）
  └─ 选「手动合并」→ 本地逻辑 + 上游新 API 适配（最常见，见下）

第 3 步 立即验证：解决完这一个冲突后，跑该 C# 对应的探针
  └─ grep 该 claim 的探针符号 → 确认没被这次解决丢掉
```

### 阶段 3：rebase 完成后的全量验证（验收门）

```bash
# 3.1 全量能力清单
bash .zkge/verify-restore.sh        # 必须 22 通过 / 0 失败

# 3.2 编译 + 测试
cd desktop && go build ./... && cd frontend && npx tsc --noEmit

# 3.3 自动化测试（rebase 前跑过的全部重跑）
npx tsx src/__tests__/workspace-layout.test.ts
npx tsx src/__tests__/workspace-tree-scroll-restore.test.tsx
npx tsx src/__tests__/workspace-changes-errors.test.tsx
npx tsx src/__tests__/topicbar-controls.test.ts

# 3.4 结果记录
mkdir -p .zkge/evidence/post-rebase-$(date +%Y%m%d-%H%M%S)
bash .zkge/verify-restore.sh > .zkge/evidence/post-rebase-*/result.txt
```

### 阶段 4：人工验收（唯一人类闸门）

按 `capability-questions.md` 的「触发入口」手测重点项：
- C3/C12/C14/C15/C16：切标签/切项目/关面板重开/重启后宽度与状态是否保持
- C8：面包屑 hover 完整路径
- C11：改动面板行 hover/revert/徽章
- C1：窗口变窄 chat 是否保持 400px

---

## 冲突裁决速查表（按文件）

| 文件 | 保护的 C# | 裁决要点 |
|---|---|---|
| `App.tsx` | C1/C2/C3/C14 | `workspacePanelAvailableWidth`（C1）、`TopicbarMoreMenu`（C2）、`preferredWorkspacePanelWidth = rightDockTreeWidth` 单宽度（C3）、`saveWorkspacePanelOpen(open, activeWorkspaceRoot)`（C14）——**这些符号必须保留本地** |
| `WorkspacePanel.tsx` | C4/C5/C8/C12/C16/C17/C18 | `selectedChangePath`（C4）、`pendingScrollRestoreRef`（C5）、`previewCrumbs`（C8）、`treeWidthMode/savedTreeWidth`（C12）、`WORKSPACE_*_KEY` + `workspacePanelSession`（C16/17/18）——**本地持久化体系优先** |
| `store/layout.ts` | C3/C14/C15 | `workspacePanelOpenStorageKey(workspaceRoot)`（C14）、`saveRightDockTreeWidth`（C15） |
| `styles.css` | C6/C7/C9/C10/C11/C13 | 类名探针见各 claim；**上游等价样式可跟随上游，不等价必须保留本地** |
| `lib/workspaceSplit.ts` | C12 | `shouldInitializeWorkspaceSplitOnFileSelect`/`savedTreeWidth` 保留 |

## 上次失败的教训（必须规避）

| 上次错误 | 本次对策 |
|---|---|
| 冲突时直接选 HEAD（上游）侧，丢掉本地持久化 | 阶段 2 第 1 步先查归属；C16/C17 明确要求 `WORKSPACE_*_KEY` 存在 |
| `workspacePanelAvailableWidth` 定义在冲突中被删，运行时崩溃 | C1 oracle 明确 grep 探针 ≥4 处，rebased 后立即 FAIL |
| rebase 完才发现丢特性 | 阶段 3 全量验证在 rebase 完成瞬间执行，不拖到人工 |
| 上游 `workspaceTreeMemory` 重构覆盖本地 `workspacePanelSession` | 这是**架构级冲突**：若上游已推进到 workspaceTreeMemory，需在 C16/17/18 的 oracle 下做「本地语义 → 上游新 API」适配移植，而非简单选边（见下） |

## 架构级冲突的特例：上游重命名持久化机制

若上游把 `workspacePanelSession`/localStorage key 重构为 `workspaceTreeMemory`（envelope 格式）：
1. **不直接选边**——两套机制语义不同
2. **本地语义必须保留**（C16 打开文件记忆、C17 最近文件、C18 滚动位置是产品行为，不是实现细节）
3. 适配方式：把本地语义映射到上游新 API（如 recentPaths 加入上游 snapshot），rebase 完成后补一个移植提交
4. 验证：跑 verify-restore.sh 对应探针，确认语义还原（如 recentFiles 来自 recentPaths 而非 openTabs）
