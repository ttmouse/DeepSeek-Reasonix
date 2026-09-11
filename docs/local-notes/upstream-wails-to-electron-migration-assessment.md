# 只是有驯化和被训，有没有被驯化的区别。上游 Wails → Electron 迁移评估

评估上游把桌面壳从 Wails v2 换成 Electron 的改动，以及把该能力改造到本地分支是否必要。

**结论：不移植。** 迁移的核心价值（窗口内可脚本化的浏览器表面）在本地没有对应需求，而代价（固定内存、前端交互指标）与本地"性能、稳定性优先"的定位冲突。

---

## 一、评估对象

| 项 | 值 |
| --- | --- |
| 上游仓库 | `esengine/DeepSeek-Reasonix`，分支 `main-v2` |
| 评估时上游 HEAD | `44c92ffc7`（2026-09-09），即 PR #10015 `feature/opencode-go-v10-electron-integration` 的合并提交 |
| 迁移基线 commit | `7717f3eeab47f66560ea85cc7dbe27426c3adf47`（分支切出时冻结） |
| 原型 commit | `e2298bd78`（隔离的 Electron + Go 浏览器实验） |
| 发布状态 | 已随 v1.38.x 发布，不是实验分支 |
| 本地分支 | `local/dev`，相对 `upstream/main-v2` ahead 156 / behind 706 |
| 规模 | 1636 文件、+121k / −59k |

---

## 二、上游做了什么

不是替换渲染引擎，而是**换壳不换内核**的架构级重构：Go 内核、Go 桌面业务层、React UI 全部保留，只把 Wails 外壳换成 Electron。

```text
React UI ──typed IPC via preload──▶ Electron main ──stdio JSON-RPC──▶ Go desktop service
                                        │                                │
                                        ├─ WebContentsView (websites)    └─ control.Controller, sessions,
                                        ├─ remote Serve windows              tools, leases, recovery, billing
                                        └─ menu, tray, dialogs, clipboard
Remote Reasonix agent ◀── restricted host RPC over the existing SSH channel ──▶ Go desktop service
```

Go 桌面层变成独立服务进程，与壳之间只有一条私有 JSON-RPC 连接。

| 层 | 拥有的职责 |
| --- | --- |
| React UI | 渲染、意图、布局、状态投影；不持有 Electron 或 Go 全局 |
| Electron main | 窗口、浏览器视图、菜单、托盘、对话框、剪贴板、通知、原生生命周期 |
| Go desktop service | 全部桌面业务命令、controller 所有权、审批、设置、终端、SSH、扩展、更新协调 |
| Go kernel | 不变的 agent、provider、tool、持久化、lease、recovery、billing 语义 |
| Remote adapter | 转发经会话授权的宿主能力；不重复实现浏览器 |

上游明确不维护双壳产品：开发分支直接替换 Wails，`REASONIX_DESKTOP_SHELL=wails` 回退路径已删除。

---

## 三、迁移动机（上游原文）

`docs/DESKTOP_SHELL_MIGRATION.md` 的 Decision 一节：

> Reasonix Desktop moves from Wails v2 (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux) to Electron with a Chromium renderer, **because the product needs a native browser that the user and the agent operate together, and no system webview offers a second, isolated, scriptable web surface with a stable engine across all four release targets.**

需要三个属性的交集：

1. **窗口内**的原生网站表面
2. **用户与 Agent 共同操作**同一表面
3. **隔离、可脚本化、四平台同一引擎**

系统 webview 给不了这个交集——每平台一套引擎，且没有"第二个隔离可脚本化的 web 表面"。

**注意**：动机不是"多端 UI 一致"。跨平台渲染一致性是附带结果，不是决策理由。

---

## 四、被否决的替代方案

同文档 "Alternatives considered and rejected"，三条原文：

> - **Keep Wails and embed a browser through CDP to a system Chrome.** Depends on an external browser install, cannot share a login partition safely, and gives no control over the surface geometry inside the app window.
> - **Wails v3 multi-window.** Still one system engine per platform, no `WebContentsView` equivalent, and the WebKitGTK/WebView2 rough edges that motivated the recovery code stay.
> - **Rewrite the desktop layer in TypeScript.** Discards the controller, lease, recovery and remote logic that the CLI, Serve and bot frontends share.

### 第 1 条：Wails + 通过 CDP 内嵌系统 Chrome

这也是本地 Browser Relay 的形态。三条理由的实质：

**① Depends on an external browser install**
核心产品能力押在一个既不能打包、不能锁版本、也不保证存在的外部程序上。用户没装 Chrome（企业只有 Edge、mac 只有 Safari、Linux 只有 Firefox）则能力消失；Chrome 自动更新改行为则功能跟着坏；验收矩阵要乘上外部浏览器的版本数。

**② cannot share a login partition safely**
关键词是"共享与隔离的两难"，而非"共享不安全"。上游的分区由**应用自己拥有**（`persist:browser` 共享登录 / `temp:<id>` 纯内存），这才能同时做到"登录一次多任务共用"与"任务结束彻底丢弃"。走系统 Chrome + CDP 时浏览器进程所有权在用户与 Google，于是只剩两个选项：

- 接用户日常 profile：Agent 拿到用户全部真实登录态，并污染其 cookie、历史、标签；因为那是用户的真实浏览器，无法回滚
- 单开 profile 隔离：隔离有了，但"共享登录分区"没了——应用管理的登录态与用户日常浏览器割裂，用户要重新登录，且该 profile 不受应用生命周期管理

另有攻击面：CDP 调试端口本机任意进程可连。

**③ gives no control over the surface geometry inside the app window**
不是能力问题，是**几何控制权**问题。要的是网页作为窗口内一个面板：参与 React 布局、随窗口缩放、被对话框/菜单/命令面板正确遮盖。原生视图在 z-order 上永远盖在 DOM 之上，上游为此专门设计"单一覆盖状态"隐藏全部原生网站视图。系统 Chrome 的窗口不归应用管，只能浮在外面，"人机看同一块画面并直接接管"这个交互前提因此不成立。

### 第 2 条：Wails v3 多窗口

升大版本只买到"多窗口"，买不到"多个 web 引擎"——每平台仍是那一个系统引擎。后半句是关键：等于承认**那些恢复机制本身就是系统 webview 缺陷的补偿**，换 v3 后这些边角原样保留。

### 第 3 条：用 TypeScript 重写桌面层

这条否决的不是 Electron，而是**重写内核**——会把 `controller`、`lease`、`recovery`、`remote` 这些 CLI / Serve / bot 三个前端共享的逻辑一起丢掉。所以上游选择"只换壳"。

---

## 五、代价：实测数据

全部来自上游基线文件 `docs/desktop-migration/baseline/`，同一台 darwin/arm64 机器、同一采集脚本（`scripts/desktop-shell-metrics.sh`）。

### 5.1 常驻内存

`rssKiB` 原始采样值，括号内为 MiB 换算。

| 运行 | Wails | Electron |
| --- | --- | --- |
| run1 | 398608 (389.3) / 389040 (379.9) / 413792 (404.1) | 675856 (660.0) / 681168 (665.2) / 673024 (657.3) |
| run3 | 395888 (386.6) / 394736 (385.5) / 427072 (417.1) | 682720 (666.7) / 767264 (749.3) / 724976 (708.0) |

区间对比：Wails 约 380–417 MiB，Electron 约 657–749 MiB，**增幅约 +70%**。

### 5.2 启动

| 指标 | Wails run1 | Wails run2 | Electron run1 | Electron run2 |
| --- | --- | --- | --- | --- |
| `readyMs` | 1248 | 332 | 1597 | 313 |
| `healthyMs` | 4563 | 3692 | 4796 | 3742 |

**启动时间两者接近，量级相同**——run1 中 Electron 慢约 28%，run2 中 Electron 反而更快。不存在"Electron 启动慢数倍"的现象。

### 5.3 退出

| 指标 | Wails run1 | Wails run2 | Electron run1 | Electron run2 |
| --- | --- | --- | --- | --- |
| `terminatedWithinMs` | 11130 | 10714 | 257 | 239 |
| `clean` | false | false | true | true |

**这是 Electron 明确占优的一项**：Wails 退出约 11 秒且不干净，Electron 约 0.25 秒且干净。

### 5.4 前端交互 bench

来自 `electron-frontend-bench-run1.json`。

| 检查项 | 门限 | 实测 | 结果 |
| --- | --- | --- | --- |
| first-paint P95 | 100 ms | 20 ms | 通过 |
| interactive P95 | 300 ms | 943.6 ms | **未通过** |
| switch latency P95（click→目标会话渲染） | 300 ms | 471.2 ms | **未通过** |

### 5.5 上游自认的代价

同文档 "Consequences accepted"：

> a larger fixed memory and package footprint, measured across the complete process tree and reported honestly; two runtimes to keep in one version unit; Chromium sandbox requirements on Linux.

即：更大的固定内存与包体积、两个运行时必须保持在同一版本单元、Linux 上的 Chromium sandbox 要求。

---

## 六、删除了什么（实证清单）

F 阶段实际移除的旧 Wails 机制，这些是为绕开系统 webview 而积累的补偿设施：

| 被删除项 | 说明 |
| --- | --- |
| Wails 入口 | `wails.Run`、`native_host_wails.go`、`wails.json`、生成的 `wailsjs` bindings |
| 进程内远程窗口子进程 | 远程窗口原先靠子进程实现 |
| WebView2 / WebKitGTK recovery coordinators | 自写的渲染恢复协调器 |
| diagnostics observers | 自写诊断观察者 |
| 原生冒烟工具 | `cmd/transcript-native-smoke`、`cmd/transcript-selection-smoke` |
| vendored `go-webview2` fork | 为绕开上游绑定库自维护的分叉 |
| `webkit2_41` build tag | Linux 侧为 WebKitGTK 版本差异做的编译标签 |
| CI WebKitGTK toolchain steps | CI 中专门安装 WebKitGTK 工具链 |
| `REASONIX_DESKTOP_SHELL=wails` | 回退开关 |

删除后 `go list -m all` 为 Wails-free；前端只经 `window.reasonixDesktop`（由 `check-desktop-host-boundary.mjs` 强制）。

**有意保留**：`startNativeShellSupport` 后的 fyne systray 进程内回退、legacy crash-report 解码字段、`com.wails.reasonix-desktop` bundle identity、更新辅助程序里的 `wails-app-` 单实例查找（用于识别从 Wails 版本升级）。

---

## 七、能力分类（能力矩阵摘录）

上游为每个入口点标注类别：`keep-business`（Go 实现不变）、`migrate-host`（原生步骤搬到 Electron 宿主）、`delete-shell`（随旧壳删除）、`new`（新增）。

| 能力 | 原（Wails） | 目标（Electron） | 类别 |
| --- | --- | --- | --- |
| Sessions：发送、停止、模型/档位切换、历史、recovery、lease | `App` 方法经 Wails bindings | 同样的方法经 `desktop/invoke` | keep-business |
| 项目、worktree、文件预览、工作区监听 | Go + asset middleware | Go + `reasonix://app` 转发 | keep-business |
| 终端 | Go PTY/ConPTY、事件 | 不变，经 `desktop/event` | keep-business |
| 设置、MCP、MCP Apps、技能、插件 | Go | 不变 | keep-business |
| 远程工作区与远程 Serve 窗口 | SSH manager + 每窗口一个 Wails 子进程 | SSH manager 不变；每主机一个隔离分区 `BrowserWindow` | migrate-host |
| 窗口几何、主题、拖拽区、快捷键、缩放 | Wails runtime | `host/window.*`、preload window API、`-webkit-app-region` | migrate-host |
| 文件拖放、剪贴板、外链、对话框 | Wails runtime | preload native API、`host/dialog.*` | migrate-host |
| 菜单、托盘、后台关闭、第二实例 | Wails menu、fyne systray、Wails lock | Electron menu、`Tray`、按 canonical home 的 `requestSingleInstanceLock` | migrate-host |
| 更新器 | Go 协调器 + Wails 重启 | Go 协调器 + `host/app.relaunch` | migrate-host |
| **渲染恢复（WebView2 / WebKitGTK）** | Go recovery coordinators | Electron `render-process-gone` 处理 | **delete-shell** |
| **供 Agent 使用的原生浏览器** | 仅原型 | `WebContentsView` 面板 + `BrowserExecutor` | **new** |

---

## 八、桌面浏览器的产品契约

来自 `docs/DESKTOP_BROWSER.md`。这不是"嵌个网页"，是一整套人机共用表面的治理设计。

### 表面与信任

- 应用窗口可信；网站视图不可信：sandbox 开、context isolation 开、无 Node integration、无应用 preload、不能访问 `reasonix://`
- 网站视图唯一的 preload 只观察可信用户输入以请求接管，不向页面暴露任何东西
- 分区：`persist:browser` 为同一 Reasonix 数据目录下共享的登录分区；`temp:<id>` 只存在于内存，最后一个标签关闭即丢弃
- `BrowserSurfaceManager` 拥有创建、可见性、边界、焦点与销毁；React 面板提交布局矩形，壳按窗口校验后应用
- 任何应用覆盖层（对话框、菜单、命令面板）设置单一覆盖状态，隐藏所有原生网站视图，页面永远不能盖住应用
- 一个任务拥有自己的标签，携带 `{tabID, taskID, sessionID, epoch, partition}`

### 工具集（13 个）

| 工具 | 读/写 | 用途 |
| --- | --- | --- |
| `browser_tabs` | 读 | 列出任务标签及 URL、标题、加载状态 |
| `browser_open` | 写 | 在共享或临时分区打开标签到某 URL |
| `browser_navigate` | 写 | 导航绑定标签（URL、后退、前进、刷新） |
| `browser_snapshot` | 读 | 带元素引用的结构快照 |
| `browser_screenshot` | 读 | 视口或元素的 PNG，作为图像返回 |
| `browser_click` | 写 | 点击引用元素（在其中心派发可信鼠标事件） |
| `browser_type` | 写 | 用可信键盘事件向引用元素输入文本，可选提交 |
| `browser_press` | 写 | 按键或组合键 |
| `browser_scroll` | 写 | 滚动视口或元素 |
| `browser_select` | 写 | 选择下拉选项 |
| `browser_upload` | 写 | 把任务文件附加到文件输入 |
| `browser_download` | 读 | 等待或列出标签的下载 |
| `browser_close` | 写 | 关闭标签 |

每个写操作都走正常审批策略，没有独立的浏览器审批系统。输入与点击由壳以可信输入事件派发，从不给元素赋值，因此 React 受控输入与自定义控件的行为与真实用户一致。

### 接管与未知写入

- 授权 `{sessionID, taskID, runtimeGeneration, tabIDs, expiresAt}` 由 Go 签发，在服务重启、会话变化、连接世代变化或任务结束时撤销
- "接管"按钮把标签切为 `human` 模式并递增 epoch，旧 epoch 的待执行与排队动作被取消；"恢复"交回 Agent 并再次递增 epoch
- 登录页、验证码与 passkey 始终交由用户：标签处于 `human` 模式时 Agent 不能读取或操作
- 每个写操作在壳执行前先在账本中预留 `{operationID, sessionID, generation, tabID, epoch, documentToken, action, digest}`；壳报告 `executed` 或带原因的 `not_executed`
- 回复丢失、崩溃或服务重启使操作保持 `unknown`，**展示给用户且绝不自动重放**；重复的 `operationID` 永久拒绝

### 数据兼容

- 浏览器元数据与操作日志是新版本化文件（`browser/tabs-v1.json`、`browser/operations-v1.json`），旧壳从不读取
- 网站登录态存于 Chromium 持久分区；**cookie 值从不进入配置、日志或模型上下文**
- 恢复的标签只保留安全导航条目 `{url, title}`，不持久化表单状态、凭据或可重放提交

---

## 九、本地现状：Browser Relay

本地已有一套浏览器能力，**上游没有**（`internal/browserrelay` 是本地自定义，上游代码树中不存在）。

| 项 | 实现 |
| --- | --- |
| 机制 | 本地 WebSocket bridge，浏览器扩展主动连入 |
| 监听 | `127.0.0.1:23002` |
| 认证 | 启动时生成随机 token，持久化到 `~/.reasonix/browser-relay.json`（重启不变，扩展只需配置一次） |
| 并发 | 一次只接受一个扩展连接；未认证连接有 `authGrace` 超时（CSWSH 占位保护） |
| 与浏览器进程的关系 | **Relay 不启动 Chrome、不接触 profile**——只等扩展连入 |
| 工具集 | 29 个 `browser_*` 工具 |

本地工具集明显更宽（CDP 直连，不受"受控表面"约束）：

`browser_navigate`、`browser_click`、`browser_type`、`browser_read`、`browser_read_dom`、`browser_screenshot`、`browser_take_snapshot`、`browser_scroll`、`browser_press_key`、`browser_hover`、`browser_drag`、`browser_fill_form`、`browser_select_page`、`browser_upload_file`、`browser_handle_dialog`、`browser_go_back`、`browser_go_forward`、`browser_eval`、`browser_emulate`、`browser_resize`、`browser_wait`、`browser_status`、`browser_list_pages`、`browser_new_page`、`browser_close_page`、`browser_attach_page`、`browser_attached_pages`、`browser_list_console_messages`、`browser_list_network_requests`

### 工具集对照

| 维度 | 上游内嵌浏览器 | 本地 Browser Relay |
| --- | --- | --- |
| 工具数量 | 13 | 29 |
| 覆盖差异 | 受控动作，无 eval / console / network / emulate / dialog | 额外含 `browser_eval`、`browser_list_console_messages`、`browser_list_network_requests`、`browser_emulate`、`browser_handle_dialog`、`browser_drag`、`browser_hover` |
| 运行位置 | 应用窗口内 `WebContentsView` | 用户自己的 Chrome（独立窗口） |
| 登录态 | 应用管理的分区（`persist:browser`） | 用户日常浏览器的真实会话 |
| 人机协作 | 共享同一表面 + 接管状态机 | 无共享表面，用户自行操作浏览器 |
| 任务隔离 | `temp:<id>` 分区，关标签即丢 | 无 |
| 写操作保护 | 账本预留/结算，`unknown` 不重放 | 无 |

**结论**：内嵌带来的不是操作能力增量（本地反而更强），而是**窗口内共享表面、几何控制、任务级分区隔离、跨平台同引擎**这四项形态能力。

---

## 十、两种形态：托管表面 vs 借用会话

评估时必须区分两种不同的产品形态，否则会用错标尺：

| | 上游：托管表面（managed surface） | 本地：借用会话（borrowed session） |
| --- | --- | --- |
| 浏览器表面所有权 | 应用 | 用户 |
| 应用是否必须管理分区生命周期 | 是 | 否 |
| 分区隔离 | 必要产物 | 与"复用用户已有登录态"直接冲突 |
| 用户登录态 | 应用管理的资产 | 用户自有的资产，被借用 |
| 共享用户会话的评价 | 缺陷（应用无法保证分区受控） | **核心价值** |

上游 "cannot share a login partition safely" 中的 "safely" 是**站在应用方**说的——应用无法掌控一个不由它启动的浏览器进程与分区。对使用者而言，用自己已经登录的浏览器反而是最自然、无中间人的路径。

同一个技术事实在两种形态下评价相反。把托管形态的完整性标准套到借用形态上，会得出"缺隔离、缺接管、缺账本"这类**伪短板清单**。

---

## 十一、关于"隔离"的判断

### 11.1 隔离不是默认正确答案

隔离的收益（防污染）只在一次性、不涉及登录的任务中明显；代价则是要求用户重建登录态。而登录态是用户长期积累、且**不可快速重建**的资产：

- 企业后台常为 SSO + 多因素 + 设备绑定，重新登录可能直接不可行
- 部分系统绑定设备或环境特征，换运行时触发二次验证或被拒绝
- 大量独立 SaaS 账号需逐个重建

考虑两端的场景：

| 场景 | 隔离 vs 复用 |
| --- | --- |
| 一次性抓取/验证，不涉及登录 | 隔离更优（不污染） |
| 操作已登录的后台 | 复用登录态是刚需，隔离构成障碍 |

用户场景横跨两端，因此"是否隔离"取决于用户当下要做什么，**不应由实现方单方面设定默认值**。合适形态是由用户按任务可见地选择，而非预设。

### 11.2 cookie 导入不能作为等价替代

即便内嵌方案通过导入 cookie 来弥补隔离缺口，也有三层局限：

| 局限 | 内容 |
| --- | --- |
| 补不全 | 会话状态分散在 cookie、localStorage、IndexedDB、内存态 token 中，只导 cookie 则 SPA 类站点仍是未登录 |
| 补不了绑定的 | OAuth/OIDC refresh token、passkey/WebAuthn 凭据绑定 RP 与凭据存储位置，跨运行时不一定可用；部分风控还会校验环境特征 |
| 语义错 | 导入的 cookie 是某一时刻的静态快照，而真实会话是活的：会过期，服务端可能视为同账号双设备登录而触发风控或踢掉一方 |

此外，**导出 cookie 这个动作本身正是上游明确要防的**——`DESKTOP_BROWSER.md` 写明 "cookie values never enter configuration, logs or model context"。为弥补一个自身设定的隔离缺口而导出 cookie，等于打开一个已被专门关闭的口子。

---

## 十二、结论

**不移植 Electron。** 依据：

1. **迁移的核心价值在本地没有对应需求。** 上游换壳是为了"窗口内、人机共用的可脚本化浏览器表面"。本地不做窗口内浏览器面板，已有的 Browser Relay 覆盖了"让 Agent 操作浏览器"这一需求，且在工具覆盖面上更宽。
2. **代价落在本地最在意的两项上。** 固定内存约 +70%（380–417 MiB → 657–749 MiB），前端交互 bench 的 interactive P95（943.6 ms）与 switch latency P95（471.2 ms）双双未过门禁。退出行为是唯一明确占优项（11 s 不干净 → 0.25 s 干净）；启动时间两者接近，不构成理由。
3. **迁移成本接近桌面端重写。** 本地 `local/dev` ahead 156 个提交，含大量桌面端自定义（dock、工作区树、本地化 UI 等），全部建立在被上游删除的旧 Wails 机制之上。
4. **上游迁移中与 Electron 无关的设计值得单独跟踪**，不必以换壳为前提：
   - 写操作账本（预留/结算，`unknown` 不自动重放，重复 `operationID` 永久拒绝）
   - 接管语义（`human` 模式 + epoch，登录页/验证码/passkey 强制人工）
   - 审批与证据统一（浏览器动作走既有 capability 注册表）
   - Go 服务与壳通过 `--host-rpc` / DesktopContract 解耦

   前三项不预设用户环境如何组织，只补"人机同时操作同一页面"与"写操作不重复执行"的一致性；第四项是未来若需换壳或加远程能力时的架构参考。

---

## 附：证据来源与核对说明

| 结论 | 来源 |
| --- | --- |
| 迁移动机、被否决方案、自认代价 | `docs/DESKTOP_SHELL_MIGRATION.md`（上游 `44c92ffc7`） |
| 架构分层、能力分类 | 同上 + `docs/desktop-migration/INVENTORY.md` |
| 内存、启动、退出实测 | `docs/desktop-migration/baseline/wails-darwin-arm64-run{1,2,3}.json`、`electron-darwin-arm64-run{1,2,3}.json` |
| 前端 bench 门限与实测 | `docs/desktop-migration/baseline/electron-frontend-bench-run1.json` |
| 删除清单 | `docs/DESKTOP_SHELL_MIGRATION.md` F 阶段小节 |
| 浏览器产品契约 | `docs/DESKTOP_BROWSER.md` |
| 本地 Relay 实现 | `internal/browserrelay/server.go`、`desktop/browserrelay.go` |
| 本地工具集 | `internal/tool/builtin/browser.go` |

核对说明：

- 内存与启动/退出数值为直接读取上述 baseline JSON 的原始字段，未经换算以外的加工；MiB 由 `rssKiB ÷ 1024` 得出。
- 上游文档记录了"系统 webview 的具体粗糙之处促使了恢复代码的编写"，但**未列出症状清单**；症状描述不可作为上游理由引用。
- 未核对项：本地分叉中触及 `desktop/` 的提交细分数。
