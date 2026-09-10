# 本地 vs 上游差异分析

> 最后更新：2026-09-10
> 本次更新：已整合 DeepSeek V4.1 Flash 适配（价格表/模型列表/计费调度）
> 上游基线：`upstream/main-v2` (`680e00e5b`)
> 本地基线：`local/dev` (`e0384c64c`)
> 合并基点：`f824321e846ca6ce5cb552bf117f53aa52417d3e`

---

## 数据概览

| 指标 | 值 |
|------|-----|
| 上游领先 commit 数（本地落后） | **784** |
| 本地领先 commit 数（本地发明） | **158** |
| 合并基点 | `f824321e846` |

---

## 更新方法

```bash
cd /Users/douba/Projects/DeepSeek-Reasonix

# 1. 同步最新
git fetch upstream main-v2
git fetch origin main-v2

# 2. 重新统计 commit 数
echo "上游领先本地：" && git rev-list --count local/dev..upstream/main-v2
echo "本地领先上游：" && git rev-list --count upstream/main-v2..local/dev

# 3. 查看新增内容
echo "===== 上游新增 ====="
git log --oneline local/dev..upstream/main-v2 --grep="Merge pull" | head -20
echo ""
echo "===== 本地新增 ====="
git log --oneline upstream/main-v2..local/dev | head -20

# 4. 更新后修改本文件头部
#   - 更新 "最后更新" 日期
#   - 更新上游和本地的 commit hash
#   - 更新 commit 数
#   - 如有新增重要功能，追加到对应分区
#   - 已经整合的功能移至 "已整合" 分区
```

---

## 一、本地主动做的优化（Local Inventions）

上游没有的本地自主功能、优化和修复。

### 1.1 ⭐ 核心特色功能

| # | 功能 | commit | 说明 | 状态 |
|---|------|--------|------|------|
| 1 | **@ Mention 统一面板** | `feat/at-mention-panel` (~35 commits) | 统一 @ 和 + 引用面板，跨项目会话搜索，键盘导航，命令描述展示 | ✅ 活跃 |
| 2 | **Browser Relay 浏览器扩展** | ~15 commits | 完整浏览器扩展实现（CDP 连接 + 远程控制面板 + 手机控制面板） | ✅ 活跃 |
| 3 | **Provider 故障转移** | `b3f9c103a` | provider failover 机制，主 provider 不可用时自动切换备用 | ✅ 活跃 |
| 4 | **心跳任务 Precheck 门禁** | ~10 commits | 三态 precheck gate、执行历史、测试按钮、独立模型选择 | ✅ 活跃 |
| 5 | **Widget 流式渲染** | `2c55c02d0` | widget 逐块流式渲染系统 | ✅ 活跃 |
| 6 | **聊天历史侧边栏** | ~10 commits | ChatGPT 风格的对话历史侧边栏 + 悬停预览面板 | ✅ 活跃 |
| 7 | **QQ 网关握手修复** | `fix/qq-gateway-handshake` | 修复 QQ IM 通道的握手协议 | ✅ 活跃 |
| 8 | **阿里云百炼 Provider** | `ce5f445e3` | 阿里云 Model Studio compatible-mode 地址自动补全 | ✅ 活跃 |
| 9 | **右侧 Dock 重设计** | `feat/right-sidebar-redesign` (~20 commits) | Activity bar + tab 容器、拖拽排序、折叠 Dock 布局侧栏、文件树彩色图标 | ✅ 活跃 |
| 10 | **Deep-link 支持** | `19fbe8bfc` | `reasonix://` 协议深度链接打开会话 | ✅ 活跃 |
| 11 | **会话概览面板** | `812a0f875` | 接管状态栏数据、Cmd+G 未读跳转 | ✅ 活跃 |
| 12 | **侧边栏归档** | `5768b6fc9` | 一键归档 3 天以上非活跃聊天 | ✅ 活跃 |
| 13 | **切换模型下一轮生效** | `34170f4fb` | 运行时切换模型从下一轮生效（已合入上游 PR #9187） | ✅ 已提交上游 |
| 14 | **远程连接** | ~8 commits | 远程面板 + 手机控制面板 | ✅ 活跃 |
| 15 | **快捷指令面板** | `feat/new-skin-custom` | 右侧 dock 快捷指令（instruction）面板 | ✅ 活跃 |
| 16 | **输入框样式菜单** | `feat/input-style-menu` | 输入框可选择不同样式 | ✅ 活跃 |

### 1.2 🛠️ UI/UX 微调与修复

| # | 改动 | commit |
|---|------|--------|
| 1 | IME 组合中拦截 Enter，避免候选词确认误提交 | `833952eb1` |
| 2 | 自定义滚动条固定窗口右缘、消息与输入框像素级对齐 | `aa5d5e4e4` |
| 3 | 消息操作按钮改为纯图标 + Tooltip | `6487b0034` |
| 4 | macOS 透明 webview 前端自绘窗口圆角 | `9b6c23e6a` |
| 5 | 文件预览区二级文件标签条移除 | `e19b83a53` |
| 6 | 顶级三点菜单移入标题行并弱化浮层 | `e919eb2a3` |
| 7 | Dock 切换按钮状态化图标与 accent 高亮 | `ac915aec6` |
| 8 | 指令面板右键卡片仅插入文本到输入框 | `80b002c65` |
| 9 | 远程窗口 macOS 拖拽区 | `f5bfdcb5a` |
| 10 | Ask 卡片交付失败显示错误并恢复交互 | `51a72fe56` |
| 11 | 浅色主题下顶栏按钮与菜单项悬停不可见修复 | `9baf5cea3` |
| 12 | Composer 模式控件在会话运行中保持可用 | `ea253cf99` |
| 13 | 侧边栏底部工具行收纳远程入口 | `65b4485ba` |
| 14 | Mermaid 滚轮缩放改为点击激活 | `17d9e9e4b` |
| 15 | 历史消息文件路径可点击并在工作区面板打开 | `566070ec1` |

### 1.3 🔧 底层优化

| # | 改动 | commit |
|---|------|--------|
| 1 | **度量体系移除** — 移除前端诊断埋点体系，保留本地崩溃诊断分桶 | ~5 commits |
| 2 | **i18n 性能** — `t()` 复用已解析 locale，避免每次 `detectLocale` | `c5f3abf09` |
| 3 | **Provider Alibaba 地址补全** — 自动补全阿里云百炼完整端点 | `ce5f445e3` |

---

## 二、被动落后于上游的部分（Upstream Improvements）

上游已完成的、本地还没整合的改动。按整合价值排序。

### 2.1 🏗️ Electron 壳迁移（重大架构变化）

上游将桌面壳从 Wails 迁移到 Electron（OpenCode Go），涉及整套构建/打包/渲染/窗口管理。

| 关键 PR | 描述 | 文件影响 | 整合建议 |
|---------|------|---------|---------|
| #10015 | Wails → OpenCode Go/Electron 集成 | `desktop/` 大量重写 | **需先评估** — 本地已深度绑定 Wails（browser relay、worktree、远程连接等） |
| #10041 | Right dock launcher tabs → shell bar 全宽行 + 移除 classic layout | `desktop/frontend/` | ⚠️ 与本地 dock 重设计冲突 |
| #10032 | Electron native zoom stub routing | `desktop/` | Electron 专属，Wails 不适用 |
| #10040 | 硬件加速设置 + 图形偏好恢复 | `desktop/` + settings | Wails 下可能不需要 |

> **决策待定：** 是否跟进 Electron 迁移，影响所有后续桌面端开发方向。

### 2.2 🔐 Agent 可信证据系统（Operation / Evidence）

近期上游最大的后端改进，直接提升 agent 工具调用的可追溯性和可靠性。

| PR | 文件路径 | 说明 | 整合优先级 |
|----|---------|------|-----------|
| #10015 之后 | `internal/agent/` | **Operation lifecycle** — 操作生命周期管理器，工具调用可追踪 | **P0** |
| #10049 | `internal/agent/evidence/` | **Evidence receipts** — 证据收据系统 + source tokens | **P0** |
| #10039 | `internal/agent/` | **Durable tool recovery** — 跨桌面/远程持久化工具恢复 | **P0** |
| #10038 | `internal/agent/` | **Read evidence lifecycle** — 读策略与证据生命周期集成 | P1 |
| — | `internal/agent/` | Settlement (自动结算普通工作) + delivery gap 报告 | P1 |

> **整合建议：** P0 优先。与本地已有的 provider failover 结合，能显著提升 agent 执行的鲁棒性。

### 2.3 📊 Turn Metrics 实时展示

| PR | 说明 | 整合难度 | 优先级 |
|----|------|---------|-------|
| #10059 | 运行条速率展示 + composer 上方实时指标 | 低-中 | **P1** |

### 2.4 🔧 Provider / AI 能力更新

| PR | 说明 | 整合难度 | 优先级 |
|----|------|---------|-------|
| #10062 | DeepSeek V4.1 Flash 适配（规格/计费/图像输入） | **低** | **P0** |

### 2.5 🧹 Bug 修复和清理（精选）

按价值拣选，不是全部都需要整合。

| 类别 | 数量 | 拣选建议 |
|------|------|---------|
| CI 修复（Windows/coverage） | ~20+ | 低优先，本地主要以 macOS 开发 |
| MCP 相关（连接/信任/超时/启动） | ~30+ | **P1** — 选中与本地无冲突的修复 |
| Session 存储（冲突/快照/恢复） | ~20+ | **P1** — 数据完整性相关 |
| 恢复路径/崩溃处理 | ~15+ | **P1** |
| Windows 兼容 | ~15+ | 低优先 |
| 死代码/清理 | ~10+ | 低优先 — 本地已做 metrics 等清理 |
| 依赖更新（Go/npm） | ~50+ | 低优先 |

### 2.6 🔄 与本地重叠但实现不同

| 上游 commit | 上游做什么 | 本地状态 |
|-------------|-----------|---------|
| `62e40d591` | Conversation-scoped right dock (Phases 1-5) | 本地有独立 dock 重设计，实现路径不同 |
| #9988 | Electron desktop shell / 运行中 composer 控件 | 本地 Composer 有自定义控件实现 |
| #10007 | Remove dead code | 本地已移除 metrics 等 |

---

## 三、整合优先级矩阵

| 优先级 | 上游功能 | 涉及路径 | 整合难度 | 拣选策略 |
|--------|---------|---------|---------|---------|
| **P0** | ~~DeepSeek V4.1 Flash 适配~~ | ~~`internal/provider/`, `internal/config/`~~ | ~~✅ 低~~ | ✅ **已完成** |
| **P1** | Evidence/Operation 系统 | `internal/agent/` | ⚠️ 中-高 | 待决策
| **P1** | Turn metrics 实时展示 | `desktop/` | ✅ 低-中 | 拣选核心改动 |
| **P1** | MCP/Session/Crash 修复 | 多路径 | ⚠️ 中 | 按文件名拣选 |
| **P2** | Electron 迁移评估 | 全桌面端 | ❓ 高 | 先决策再动作 |
| **P3** | 依赖更新/死代码/Windows | 多路径 | ✅ 低 | 按需拣选 |
| **忽略** | Classic layout 移除等 | `desktop/frontend/` | — | 本地已有不同实现 |

---

## 四、文件层面影响

> 以下是本地/上游各自由的文件改动范围，用于快速判断冲突面。

### 4.1 本地独有文件/目录（上游没有的）

| 路径 | 说明 |
|------|------|
| `desktop/browserrelay.go` | Browser Relay 扩展核心 |
| `desktop/browser_broker*.go` | Browser 代理层 |
| `desktop/browser_executor*.go` | 浏览器执行器 |
| `desktop/browser_file_relay.go` | 文件中继 |
| `desktop/browser_upload_files*.go` | 上传文件 |
| `desktop/browser_broker_remote.go` | 远程 Broker |
| `desktop/blank_project.go` | 空白项目模板 |
| `desktop/bot_bridge.go` | Bot 桥接 |
| `desktop/frontend/src/custom/` | 自定义前端隔离层（@ mention panel / dock 等） |
| `tools/` | 辅助工具脚本（remote-panel 等） |

### 4.2 上游有改动但本地也有改动的重叠文件

| 文件 | 上游改动 | 本地改动 | 冲突风险 |
|------|---------|---------|---------|
| `desktop/app.go` | Electron 集成 | Browser relay + 心跳等 | ⚠️ **高** |
| `desktop/frontend/src/` dock/composer 相关 | Electron shell 重构 | 本地 dock 重设计 | ⚠️ **高** |
| `internal/agent/` | 证据/恢复系统 | 少量无冲突 | ✅ 低 |
| `internal/provider/` | V4.1 Flash | 阿里云百炼 | ✅ 低 |

---

## 五、已整合记录

> 本地从上游 cherry-pick 或合并的功能在此记录。

| 功能 | 上游 PR/Commit | 本地合并 commit | 日期 |
|------|---------------|----------------|------|
| DeepSeek V4.1 Flash 适配（新模型列表/价格表/计费调度/Vision 重构） | `c1cec65e6` | 手动应用 | 2026-09-10 |
| 切换模型下一轮生效 | #9187 | `34170f4fb` | 2026-08 |
| 上游 66 commits 同步 | — | `e5be2bd9c` | 2026-08 |
| Session catalog idle CPU 修复 | #9697 | `23679420a` | 2026-08 |

---

*本文件由 AI 生成并维护，每次同步上游后请更新。*