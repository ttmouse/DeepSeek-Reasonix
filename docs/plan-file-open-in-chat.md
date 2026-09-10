# 计划：历史消息内文件路径/引用 → 点击在右侧工作区面板打开

> 日期：2026-09-09
> 状态：方向已确认，待实现
> 参考：Alma 桌面 app 同款机制考古 + 8 条实测判别（2026-09-08，见文末）

## 1. 背景与目标

Reasonix 桌面（`desktop/`，Wails + vite + React）中，历史消息（会话 Transcript）渲染的 markdown 是**纯静态**的——消息里出现的文件路径/引用只是文本，不能点击。

目标：对标 Alma——消息中形似文件路径的文本（含行内代码）渲染为可点击链接（下划线样式），点击后在**右侧工作区面板（WorkspacePanel）**定位并打开该文件。不落库、不改消息原文、不影响复制语义。

### 非目标
- 不做 `@[label](uri)` 双链引用体系（那是第二期；本期只做"路径链接化"）。
- 不做跨 workspace 打开（见 4.3 决策）。

## 2. 参考：Alma 机制复盘（已考古确认）

Alma 实际行为分两层：

1. **触发层（链接化）**：纯前端形状启发式，渲染时对文本做判定，不做存在性预检（不存在也渲染链接样式）。
2. **点击层**：resolve + stat → 存在 → `files` 面板 + `selectFile`；不存在 → 静默无反应。

实测判定规则（8 条判别实验收敛）：

| 输入形态 | 链接化 | 点击结果 |
|---|---|---|
| 相对路径带扩展名（存在） | ✅ | 打开 |
| 相对路径带扩展名（不存在） | ✅ | 静默无反应 |
| 目录 / 无扩展名 | ❌ | 不可点 |
| 绝对路径命中**任一已注册 ws** 前缀 | ✅ | 打开（仅当前 ws 真有效） |
| 绝对路径非 ws（如 /etc/hosts） | ❌ | 不可点 |
| 裸文件名（basename 匹配文件树） | ✅ | 打开同 basename 文件 |
| 中文名文件 | ✅ | 正常 |
| markdown 链接指向本地相对/绝对路径 | ❌ | 走外部链接逻辑，不开面板 |

关键实现细节：
- **链接化不 stat、不落库**（`reference_links` 无 auto 来源），纯渲染层判定。
- 判定条件 = 带扩展名（`/\.[a-zA-Z0-9]{1,10}$/` 一类）+（相对路径/裸文件名 **或** 绝对路径且前缀命中已知 workspace 根）。
- 点击后经统一 openReference 分发 → `artifact.setActiveTab("files") + setIsOpen(true) + selectFile(path)`。
- 跨 ws 的绝对路径虽可链接化，但 selectFile 只对当前 ws 文件树有效 → 定位失败（实测现象：面板停留在之前打开的文件上）。

## 3. Reasonix 桌面现状（接点盘点）

已存在、可直接复用的能力：

| 层 | 位置 | 现状 |
|---|---|---|
| 历史消息渲染 | `desktop/frontend/src/components/MarkdownHistory.tsx`（虚拟窗口 blocks）→ `MarkdownRenderer.tsx`（基于 react-markdown `ReactMarkdown`） | 纯渲染，无路径链接化 |
| markdown 定制注入点 | `components/markdownComponents.tsx`、`lib/markdownPipeline.ts`、`markdownUrlTransform`（img src / url 安全转换，已在用） | 可同级注入 code/a 定制 |
| 打开文件通道 | `components/WorkspacePanel.tsx`：`selectFile(path, "files")`；外部经 prop `revealPathRequest?: WorkspaceRevealRequest = { id, path }` 触发 | 已工作（workspace 验证/变更定位在用） |
| 面板装配 | `App.tsx` 渲染 `<WorkspacePanel … verificationRevealRequest={…} onOpenInTerminal={…} />` | App 持有面板控制 |
| 输入框 @ 文件 | `components/FileReferenceMenu.tsx` + `Composer.tsx`（SearchFileRefsForTab） | 独立体系，本期不动 |
| 后端文件能力 | Go bridge（app.go）+ 工作区文件树 | stat/列表能力已具备（文件树刷新在用） |

**缺口**：MarkdownHistory → MarkdownRenderer 渲染链中没有任何"路径文本 → 链接 + onClick → 打开文件"的处理；App 也没有把"消息内打开请求"接到 `revealPathRequest` 的通用入口（现只有 verification 专用）。

## 4. 方案设计

### 4.1 架构：三层，全部前端；Go 侧仅复用现有文件 stat/树接口

```
MarkdownHistory blocks
   └─ MarkdownRenderer (ReactMarkdown)
        ├─ 注入: inlineCode/文本 → 路径形状判定 (looksLikeWorkspaceFile)
        │        └─ 命中 → 渲染 <a class="md-path-link"> + data-path
        └─ onClick (委托或组件级) → onOpenChatFileRequest(pathText)
                                      └─ App → resolve → WorkspacePanel.selectFile(revealPathRequest)
```

### 4.2 触发层：路径形状判定（`lib/chatPathLinkify.ts` 新文件）

纯函数 `looksLikeFilePath(text, ctx): { kind: 'relative'|'abs'|'basename', raw } | null`：

- 前置过滤：长度 ≤ 512、无空白/换行、不以 `http(s)://`、`data:`、`@` 开头（避免误包 URL/邮箱）。
- **相对/裸名分支**：带扩展名（`\.[A-Za-z0-9]{1,10}$`）→ 命中。
- **绝对分支**：`/` 开头 → 前缀必须命中当前已知 workspace 根集合（App 层传入；本期**仅当前会话 workspace 根**，见 4.3）。
- 排除：以 `/` 结尾（目录形态）、纯 `.`/`..` 段。
- 不做 stat（与 Alma 一致；不存在也出链接，点击层兜底）。

注入方式：MarkdownRenderer 的 ReactMarkdown 定制 `components`（与现有 `markdownUrlTransform` 同级）。作用于：行内代码（`inlineCode`/`code` inline 分支）与普通文本节点（walk mdast text/inlineCode）。整段 fenced code block **不处理**（代码块内多为样例路径，误包率高；如需可二期加）。

样式：`.md-path-link`——下划线 + `text-decoration-color` 弱化，复用现有 markdown 链接视觉（对齐 Alma 实测：下划线链接，非 chip）。

### 4.3 点击层：打开通道

方案对比：

| 方案 | 做法 | 成本 | 取舍 |
|---|---|---|---|
| **A（推荐）** | 新增通用回调 `onOpenChatFile(pathText, kind)`：MarkdownHistory ← App 透传；App 内 resolve（当前 ws 根拼接相对路径/裸名在文件树 basename 匹配）→ stat → 存在则 `setRevealPathRequest({id, path})` 走 WorkspacePanel 现有通道 | 低 | 复用现成 selectFile；面板已能自动开文件；改动集中 App + MarkdownRenderer |
| B | 复用/泛化 `verificationRevealRequest` prop | 中 | 语义混淆（那是完成摘要验证专用），不推荐 |
| C | 直接前端调 Go bridge stat → 自定义打开 | 高 | 绕过面板复用逻辑，重复造轮子 |

选 **A**：
- `WorkspaceRevealRequest` 的 `path` 语义：相对当前 workspace 根的路径（与 selectFile/文件树一致）。绝对路径命中当前 ws 根 → 转相对后同路。
- resolve 失败（不存在 / 不在当前 ws）→ **静默**（对齐 Alma 实测 2/8 号：无 toast、无报错；可后续加 debug 日志）。
- 跨 ws 绝对路径：本期**不链接化**（与 Alma 的"能链但开不了"相比，我们选择更诚实的"直接不可链"——单 ws 上下文的产品语义更干净）。
- 裸文件名（无 `/`）：本期在文件树内做 basename 精确匹配，唯一命中才链接化（防误包）；歧义多命中 → 不链接。（对齐实测 7 号，但收紧为"唯一命中"）

### 4.4 不改动项
- 消息存储原文（chat JSON）不动 → 复制语义不变（Alma 复制会带出 token 的教训，Reasonix 纯路径方案天然免疫）。
- MarkdownHistory 虚拟窗口/缓存不动，只在其渲染叶子接定制。
- 输入框 @ 文件体系（FileReferenceMenu）不动。

## 5. 任务拆分

| Phase | 任务 | 验收 |
|---|---|---|
| 0 | 接点确认：App→WorkspacePanel `revealPathRequest` 装配处；MarkdownRenderer components 注入点实测跑通（空组件透传不回归） | dev 起服务，历史消息渲染无回归 |
| 1 | `lib/chatPathLinkify.ts` 纯函数 + 单测（判定矩阵：存在/不存在/目录/绝对非ws/裸名唯一/裸名歧义/URL/中文/长文本） | 单测全绿 |
| 2 | MarkdownRenderer 注入链接渲染（inlineCode + 文本 mdast walk）；样式 `.md-path-link` | 历史消息中路径出现下划线；点无反应的先不管 |
| 3 | App 接线：`onOpenChatFile` → resolve（当前 ws 根/文件树 basename/stat）→ `revealPathRequest`；失败静默 | 端到端：存在文件点击 → 右侧面板定位打开 |
| 4 | 打磨：行内多路径、中英文路径、性能（渲染 walk 不阻塞：≤2ms/块，超标走 idle）、复制文本无残留 | 对照 §7 验收表全过 |

## 6. 风险与边界

- **误包**：聊天正文提到 `foo.py`（不存在）也会出链接 → 已接受（对齐 Alma；点击无反应，代价低）。若实际观感差，二期加"文件树缓存内存在才链接"开关。
- **性能**：MarkdownHistory 是大历史虚拟窗口，walk 需在现有 worker/block 管线内做，勿在主线程大文本 regex 全扫（Phase 4 压测）。
- **中文/空格路径**：链接文本原样展示、点击传原文（不 URL 编码；打开层按原文 stat）。带空格路径可能被误判 → 白名单内可，复杂 case 二期。
- **多 workspace**：本期单当前 ws；未来多 ws 时把"已知 ws 根集合"传入判定函数即可扩展（函数签名预留 `ctx.roots`）。
- **Go 侧**：预计零改动；若 stat 需新增 bridge 方法，Phase 3 再加。

## 7. 验收测试（对齐 Alma 8 条实测）

在会话历史中生成含下列路径的消息，逐条验证：

| # | 目标 | 期望 |
|---|---|---|
| 1 | `click-test/测试文档.md`（存在） | 下划线，点击打开 |
| 2 | `click-test/不存在.md` | 下划线，点击无反应 |
| 3 | `click-test`（目录） | 无链接 |
| 4 | `click-test/data.json`（存在） | 下划线，点击打开 |
| 5 | `/Users/douba/Projects/XM/CLAUDE.md`（跨 ws） | **无链接**（Reasonix 单 ws 语义，与 Alma 差异点，记录在案） |
| 6 | `/etc/hosts`（非 ws） | 无链接 |
| 7 | `data.json`（裸名，唯一命中 click-test/data.json） | 下划线，点击打开 |
| 8 | `/Users/douba/.../click-test/不存在.md` | 下划线，点击无反应 |

## 8. 备注：二期候选（不在本期）

- `@[label](alma://file/...)` 双链 token + chip + reference_links 索引（完整复刻 Alma 引用体系）。
- 消息内引用悬停 backlinks（谁引用了该文件）。
- 代码块内路径不处理 → 如需加"复制后手动识别"，单开。
