# 右侧边栏按对话隔离改造方案

## 1. 背景

Reasonix 当前的右侧工作台（`workbench-dock`）以项目为状态作用域。同一项目中的多个对话共享：

- 已打开的 Dock 标签及其顺序；
- 当前激活的 Dock 标签；
- Dock 展开或折叠状态；
- 文件树展开目录、选中文件和滚动位置；
- Changes 视图的当前选择和最近访问路径。

这与 Codex 的交互模型不同。Codex 中，每个对话拥有自己的侧边栏工作现场；切换对话时，侧边栏随对话一起切换，返回原对话后恢复原来的状态。

本方案将右侧边栏从“项目级共享状态”改为“对话级工作现场”，同时保留真正属于窗口和项目的共享状态。

## 2. 目标

### 2.1 用户行为目标

1. 同一项目中的对话 A 和对话 B 可以拥有不同的 Dock 标签、当前文件和文件树展开状态。
2. 从 A 切换到 B，再返回 A，A 的侧边栏恢复到离开时的状态。
3. `/new`、新建对话和 fork 创建新的侧边栏工作现场。
4. 清空当前会话后，不残留被清空会话的文件选择和 Dock 标签。
5. 重启应用后，仍能按对话恢复侧边栏状态。
6. 快速切换对话时，旧对话的异步结果不能写入新对话。

### 2.2 非目标

本次不改变：

- 左侧对话列表的交互和持久化方式；
- 文件内容、Git 状态及文件监听的项目级数据模型；
- 右侧栏宽度、终端高度等窗口几何偏好；
- Dock 标签视觉样式、拖拽交互和面板业务功能；
- 后端会话模型或 Topic 索引格式。

## 3. 设计原则

### 3.1 内容随对话，项目数据继续共享

侧边栏中的“工作现场”属于对话；文件系统和 Git 数据仍属于项目。不能为了隔离 UI 状态而为每个对话复制文件缓存、Git 查询或 watcher。

### 3.2 几何偏好不随对话跳动

右侧栏总宽度、文件树分栏宽度、终端高度保留为窗口级偏好。若这些尺寸也按对话恢复，切换对话时聊天区域会发生明显位移，收益低且视觉成本高。

### 3.3 单一状态所有者

当前 `activityBarOpen` 与 `workspacePanelOpen` 同时表达 Dock 是否展开，并通过 effect 保持同步。改造后必须收敛为一个状态，避免切换对话时出现短暂错位或循环同步。

### 3.4 同步切换作用域

不能在 React 完成一次旧状态渲染后，再通过 `useEffect` 调用 `setWorkspaceRoot` 切换侧边栏。当前对话的 Dock 快照必须在该对话的首帧渲染前可用。

### 3.5 异步结果必须带作用域

文件预览、Changes 详情、搜索和面板回调都可能晚于对话切换完成。每个异步请求和返回结果必须携带发起时的 `conversationDockKey`；key 已变化时丢弃结果。

## 4. 状态归属

| 状态 | 当前归属 | 目标归属 | 说明 |
| --- | --- | --- | --- |
| Dock 标签列表与顺序 | 项目 | 对话 | A/B 对话独立 |
| 当前 Dock 标签 | 项目 | 对话 | 返回对话时恢复 |
| Dock 展开/折叠 | 项目 | 对话 | 每个对话保留自己的工作现场 |
| 文件树展开目录 | 项目 | 对话 | 属于导航上下文 |
| 当前文件/变更选择 | 项目 | 对话 | 不应串到其他对话 |
| 文件树滚动位置、最近路径 | 项目 | 对话 | 返回对话时恢复 |
| 最大化、预览展开 | 全局运行时 | 对话运行时 | 默认不持久化也可以，但必须隔离 |
| 浏览器 URL/导航状态 | 组件临时状态 | 对话 + Dock 标签 | 后续可完整持久化 |
| Dock 总宽度 | 全局 | 全局 | 防止切换对话时布局跳动 |
| 文件树/预览分栏宽度 | 混合 | 全局 | 作为操作习惯，而非对话内容 |
| 终端抽屉高度 | 全局 | 全局 | 窗口几何偏好 |
| Dock 入口排序 | 全局 | 全局 | 用户偏好 |
| 文件/Git/监听缓存 | 项目 | 项目 | 多对话复用数据层 |

## 5. 对话身份

### 5.1 统一生成身份键

新增一个纯函数模块，例如：

```text
frontend/src/lib/conversationDockIdentity.ts
```

建议接口：

```typescript
type ConversationDockIdentityInput = {
  tabId?: string;
  scope?: string;
  workspaceRoot?: string;
  topicId?: string;
  sessionPath?: string;
  sessionGeneration?: number;
  remote?: RemoteTabMetaFields;
};

function conversationDockKey(input: ConversationDockIdentityInput): string;
```

本地对话的逻辑身份：

```text
local:<scope>:<normalized-workspace-root>:<topic-id>:<session-generation>
```

远程对话的逻辑身份：

```text
remote:<host-id>:<workspace>:<topic-id-or-session-path>:<session-generation>
```

### 5.2 降级顺序

身份字段可能在启动或建会话早期尚未齐全，按以下顺序降级：

1. `topicId + sessionGeneration`；
2. `sessionPath + sessionGeneration`；
3. `tabId + sessionGeneration`，仅作为临时身份。

身份从临时 key 升级为正式 key 时，需要把临时状态原子迁移到正式 key，不能表现为侧边栏突然重置。

### 5.3 生命周期语义

- 切换 UI 标签：如果仍是同一 `topicId + sessionGeneration`，恢复同一状态。
- `/new`：Topic 更新，创建新状态。
- fork：Topic 不同，创建独立状态，不与源对话联动。
- clear：即使 Topic 被保留，`sessionGeneration` 更新，因此创建空状态。
- 普通 controller rebuild：不应改变身份；不能误清空侧边栏。
- 重启：后端持久化的 Topic 和 generation 应生成相同 key。

不能只使用 `activeTabId`。该 ID 属于桌面标签壳，同一个标签可以轮换到另一段对话。

## 6. 状态模块设计

### 6.1 新的深模块

将 `activityBarStore` 从“当前项目的一份 Dock 状态”改造成“按对话保存 Dock 快照”的模块。外部调用方只需要知道当前 `conversationDockKey` 和操作意图，不需要理解持久化、迁移或过期请求处理。

建议状态模型：

```typescript
type ConversationDockSnapshot = {
  tabs: TabItem[];
  activeTabId: string | null;
  open: boolean;
  maximized: boolean;
  previewActive: boolean;
  updatedAt: number;
};

type ConversationDockStore = {
  activeConversationKey: string;
  snapshots: Record<string, ConversationDockSnapshot>;
  activateConversation(key: string): void;
  migrateConversationKey(from: string, to: string): void;
  openEntry(key: string, ...): void;
  addTab(key: string, ...): void;
  updateTab(key: string, ...): void;
  closeTab(key: string, ...): void;
  activateTab(key: string, ...): void;
  moveTab(key: string, ...): void;
  setOpen(key: string, open: boolean): void;
};
```

所有 mutation 显式接收 key，或由 `useConversationDock(key)` 返回已经绑定 key 的 actions。禁止继续依赖模块级可变的 `workspaceRoot`，否则旧闭包和延迟回调仍有机会写错作用域。

### 6.2 消除重复状态

改造后：

- `ConversationDockSnapshot.open` 成为 Dock 展开状态的唯一来源；
- 删除或停止使用 `layoutStore.workspacePanelOpen`；
- `activityBarOpen` 改名为 `open`，不再单独存在；
- `rightDockMode` 从当前活动 Dock 标签的 `type` 派生；
- 没有活动标签时，使用默认入口决定首次打开的面板。

`layoutStore` 只保留窗口几何和真正的全局偏好。

### 6.3 WorkspacePanel 的两个 key

需要明确区分：

- `workspaceScopeKey`：数据请求作用域，继续包含 tab/session/cwd/controller epoch，用于缓存失效和拒绝旧请求；
- `workspaceMemoryKey`：导航现场作用域，改为 `conversationDockKey + dockTabId`。

这样既能共享同一项目的文件和 Git 数据，又能隔离每个对话、每个 Dock 文件标签的选择状态。

## 7. 持久化与迁移

### 7.1 新存储结构

建议新建版本化 envelope，不再把原始 workspace path 拼接为多个 localStorage key：

```typescript
type PersistedConversationDockEnvelope = {
  version: 1;
  conversations: Array<{
    key: string;
    dock: PersistedConversationDockSnapshot;
    workspaceNavigation: PersistedWorkspaceNavigationSnapshot;
    updatedAt: number;
  }>;
};
```

建议存储键：

```text
reasonix.conversationDock.v1
```

最多保留最近 100 个对话。每次写入按 `updatedAt` 淘汰最旧记录，避免长期使用后 localStorage 无限制增长。

瞬时状态不落盘：

- add menu 是否打开；
- resize 拖动中间值；
- loading/error；
- 请求 sequence；
- 临时 hover、拖拽位置。

### 7.2 旧数据迁移

旧数据包括：

- `reasonix.dock.tabs[.<workspaceRoot>]`；
- `reasonix.workspacePanel.open[.<workspaceRoot>]`；
- `reasonix.workspaceState.v2` 中的项目级导航状态。

采用惰性复制迁移：

1. 对话首次打开时检查是否已有 conversation snapshot；
2. 如果没有，从所属项目的旧状态复制一份作为初始快照；
3. 写入新 envelope 后，该对话完全独立；
4. 同一项目的其他对话首次打开时也可从旧状态复制，但之后不再联动；
5. 当前版本不删除旧 key，至少保留一个发布周期作为回滚保障。

旧状态损坏、类型不合法或超出大小限制时，回退到默认空状态，不能阻止应用启动。

## 8. 渲染与切换流程

### 8.1 激活对话

```text
active TabMeta 变化
  -> 同步计算 conversationDockKey
  -> 读取或初始化该 key 的 Dock snapshot
  -> 使用该 snapshot 渲染首帧
  -> WorkspacePanel 按新的 workspaceMemoryKey 恢复导航现场
```

不要保留以下流程：

```text
先渲染旧 Dock
  -> useEffect(setWorkspaceRoot)
  -> 再渲染新 Dock
```

### 8.2 异步请求防串写

```text
对话 A 发起文件读取，请求记录 key=A
  -> 用户切换到 B
  -> A 的请求返回
  -> currentKey !== A，丢弃 UI 写入
```

数据缓存可以正常接收项目级结果，但选择状态、标签标题和预览状态只能写回 A 的 snapshot。

### 8.3 身份轮换

`/new` 或 clear 返回新身份后，先完成旧 key 到新 key 的生命周期决策，再绘制新会话：

- `/new`、fork、clear：初始化空 snapshot；
- 启动阶段临时 key 升级：迁移原 snapshot；
- 普通 metadata 补全或 controller rebuild：保持 snapshot。

## 9. 实施阶段

### Phase 1：身份与纯状态模型

1. 新增 `conversationDockIdentity.ts` 和纯函数测试。
2. 定义 `ConversationDockSnapshot` 默认值、校验和迁移函数。
3. 明确 `/new`、clear、fork、远程对话的 key 行为。

完成标准：不接 UI，仅通过单测证明身份和状态转换正确。

### Phase 2：Dock Store 按对话隔离

1. 重构 `store/activityBar.ts`，去掉模块级 `workspaceRoot`。
2. 所有 mutation 绑定或显式传入 conversation key。
3. 把展开状态并入 Dock snapshot。
4. 保持现有标签新增、关闭、激活和拖拽行为不变。

完成标准：同进程中 A/B/A 切换可恢复独立标签集合。

### Phase 3：App 接入和重复状态收敛

1. 在 `App.tsx` 统一计算 conversation key。
2. 删除 `useEffect(setWorkspaceRoot)` 切换方式。
3. 合并 `workspacePanelOpen` 与 `activityBarOpen`。
4. 从 active Dock tab 派生 `rightDockMode`。
5. 给所有异步 Dock 回调增加 scope fence。

完成标准：快速切换时没有旧 Dock 闪现和跨对话写入。

### Phase 4：Workspace 导航现场隔离

1. `workspaceTreeMemoryKey` 改为 conversation-scoped。
2. 调整 `workspaceTreeMemory.ts` 的 envelope 和容量限制。
3. 保持项目级 refresh/cache/watch 逻辑不变。
4. 接入旧项目状态的惰性迁移。

完成标准：同项目对话可分别保持文件树、当前文件和滚动位置。

### Phase 5：生命周期和远程场景

1. 接入 `/new`、clear、fork 的身份轮换。
2. 处理临时 key 升级为 Topic key。
3. 覆盖 global、remote、read-only conversation。
4. 验证应用重启恢复。

完成标准：所有会话类型均使用一致的对话级语义。

## 10. 测试计划

### 10.1 纯函数与 Store 测试

1. 相同 Topic 和 generation 生成相同 key。
2. 不同 Topic 生成不同 key。
3. 相同 Topic、不同 generation 生成不同 key。
4. 临时 key 可原子迁移到正式 key。
5. A/B/A 切换恢复各自 snapshot。
6. A 的 mutation 不能修改 B。
7. 标签关闭、激活回退、排序和 ID 唯一性保持现有行为。
8. 持久化损坏时回退默认状态。
9. 超过容量时淘汰最久未访问的对话。
10. 旧项目状态只作为初始复制来源，不形成共享引用。

### 10.2 React 集成测试

1. 同项目两个对话显示不同 Dock 标签。
2. 切换时首帧不出现上一对话的 Dock。
3. 文件读取晚返回时不覆盖当前对话。
4. Changes detail 晚返回时不覆盖当前对话。
5. 返回旧对话时恢复选中文件、展开目录和滚动位置。
6. 关闭最后一个 Dock 标签只折叠当前对话的 Dock。
7. 当前对话 Dock 折叠不影响其他对话。
8. `/new`、clear 和 fork 创建独立状态。

### 10.3 重启与迁移测试

1. 重启后按对话恢复 Dock。
2. 旧项目级 tabs/open/tree 状态能迁移。
3. 旧数据非法时应用仍正常启动。
4. global 对话不会共用旧的空 workspace key。
5. remote host 下的不同 session 不会互相覆盖。

## 11. 风险与对策

### 风险 1：只替换 storage key，仍然首帧显示旧状态

对策：状态读取按当前 conversation key 同步完成，不通过 effect 延迟切换。

### 风险 2：旧异步回调污染新对话

对策：mutation 和异步 completion 都携带 conversation key；scope 不匹配时拒绝 UI 写入。

### 风险 3：`/new` 后沿用旧 Dock

对策：身份基于 Topic 和 session generation，而不是只使用桌面 tab ID。

### 风险 4：持久化记录无限增长

对策：版本化 envelope、最近访问时间和固定容量上限。

### 风险 5：把项目数据错误复制到每个对话

对策：只隔离导航和展示状态；文件、Git、watcher、refresh store 继续以项目/运行时 scope 复用。

### 风险 6：切换对话导致布局跳动

对策：面板宽度和分栏尺寸保持全局，仅切换内容状态。

## 12. 验收标准

满足以下条件才算完成：

1. 同一项目内至少三个对话可保持完全独立的右侧栏工作现场。
2. A/B 快速往返切换 20 次，不出现错误标签、错误文件或旧内容闪现。
3. `/new`、clear、fork 均不会继承不应继承的旧侧边栏状态。
4. 重启后能够准确恢复每个对话的 Dock 标签和文件导航状态。
5. 旧版本用户升级后不会丢失原有 Dock 初始布局。
6. 右侧栏宽度在对话切换时保持稳定。
7. 文件和 Git 刷新仍然按项目复用，没有产生按对话重复 watcher。
8. 现有 Dock 标签操作、文件预览、Changes、Context、Instructions、Remote、Terminal 测试全部通过。

## 13. 预期涉及文件

核心修改：

- `desktop/frontend/src/App.tsx`
- `desktop/frontend/src/store/activityBar.ts`
- `desktop/frontend/src/store/layout.ts`
- `desktop/frontend/src/lib/workspaceTreeMemory.ts`
- `desktop/frontend/src/components/TabContainer/TabContainer.tsx`
- `desktop/frontend/src/components/WorkspacePanel.tsx`

建议新增：

- `desktop/frontend/src/lib/conversationDockIdentity.ts`
- `desktop/frontend/src/lib/conversationDockPersistence.ts`
- `desktop/frontend/src/__tests__/conversation-dock-identity.test.ts`
- `desktop/frontend/src/__tests__/conversation-dock-store.test.ts`
- `desktop/frontend/src/__tests__/conversation-dock-switching.test.tsx`
- `desktop/frontend/src/__tests__/conversation-dock-migration.test.ts`

可能需要扩展：

- `/new`、clear、fork 和 remote session 相关集成测试；
- `activity-bar-store.test.ts`；
- `workspace-selection-isolation.test.tsx`；
- `app-chrome-tabs.test.ts`。

## 14. 最终决策摘要

本次改造的核心不是把 `workspaceRoot` 替换成 `topicId`，而是重新定义右侧边栏的状态所有权：

- 对话拥有 Dock 和导航工作现场；
- 项目拥有文件与 Git 数据；
- 窗口拥有几何偏好；
- 一个模块拥有 Dock 展开、标签和持久化的唯一真相；
- 所有异步 UI 写入都受 conversation key 约束。

按这个 seam 实现后，右侧边栏才能真正具备与 Codex 一致的“随对话切换并恢复”语义，而不是表面上的分 key 持久化。
