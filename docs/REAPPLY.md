# 自定义皮肤 — 改动清单 & 重新应用指南

## 改动概览

`feat/new-skin-custom` 分支在上游 `main-v2` 基础上新增了第四个皮肤 **"custom"（自定义）**。
共改动 **7 个现有文件** + 新增 **2 个文档/脚本文件**。

## 改动的文件（按层）

每一处改动都带有 `// [CUSTOM-SKIN]` 或 `/* [CUSTOM-SKIN] */` 注释标记，
方便 git merge/rebase 时快速定位。

### Go 后端（4 个文件）

| 文件 | 改动 | 行数 |
|---|---|---|
| `internal/config/config.go:156` | `normalizeDesktopLayoutStyle()` 添加 `case "custom"` | +1 |
| `internal/config/edit.go:208-209` | `SetDesktopLayoutStyle()` 添加 case + 更新 error msg | +2 |
| `internal/config/render.go:95` | 注释文案中加上 `custom` | +0（文案） |
| `desktop/tabs.go:2406` | `singleSurfaceLayoutStyle()` 加 `"custom"` | +0（字符串） |

### 前端（4 个文件）

| 文件 | 改动 |
|---|---|
| `desktop/frontend/src/App.tsx:176` | 类型 `DesktopLayoutStyle` union 加 `"custom"` |
| `desktop/frontend/src/App.tsx:179-181` | `normalizeDesktopLayoutStyle()` 加 case |
| `desktop/frontend/src/App.tsx:2552` | 新增 `sidebarCustom` 变量 |
| `desktop/frontend/src/App.tsx:2589` | CSS class `app--custom` 加到根元素 |
| `desktop/frontend/src/components/SettingsPanel.tsx:841` | 类型 union 加 `"custom"` |
| `desktop/frontend/src/components/SettingsPanel.tsx:843-847` | normalize 加 case |
| `desktop/frontend/src/components/SettingsPanel.tsx:1116` | UI 按钮数组加 `"custom"` |
| `desktop/frontend/src/lib/types.ts:910` | 注释加 `"custom"` |
| `desktop/frontend/src/locales/{en,zh,zh-TW}.ts` | 三个语言各加一条翻译 |

### 新增文件

| 文件 | 用途 |
|---|---|
| `docs/reapply-custom-skin.sh` | rebase 后验证所有标记是否存在的脚本 |
| `docs/REAPPLY.md` | 本说明文档 |

## 设计决策

### "custom" 皮肤的行为

- **布局继承 "workbench"** — 无顶部标签栏、侧边栏改为 workbench 风格、右侧 dock 面板
- **独立的 CSS class** — 在 workbench 所有 CSS class（`app--workbench`、`sidebar--workbench`、`layout--workbench`） 之外，额外添加 `.app--custom` class，可以针对它写 CSS 覆盖来定制外观
- **独立的选择项** — 在设置面板中与 classic/workbench/creation 并列

### 为什么不做成配置驱动？

Linus 原则：不要为了一个用例引入抽象框架。三个现有皮肤的 switch-case 是稳定的，
加一个 case 的代价远低于把整个系统重构为配置注册表。"custom" 直接复用 workbench 的完整渲染路径，
只需改一处 boolean 定义即可继承全部行为——这是最朴实、改动最小的做法。

## Rebase 后的重新应用

```bash
# 1. 拉取最新上游
git fetch upstream main-v2
git rebase upstream/main-v2

# 2. 验证标记
bash docs/reapply-custom-skin.sh

# 3. 如果有缺失，手动加回来（见下方精确 diff）
```

## 精确 diff（每个文件的改动）

### `internal/config/config.go`
```go
case "creation":
    return "creation"
case "custom": // [CUSTOM-SKIN]
    return "custom"
```

### `internal/config/edit.go`
```go
case "creation":
    c.Desktop.LayoutStyle = "creation"
case "custom": // [CUSTOM-SKIN]
    c.Desktop.LayoutStyle = "custom"
default:
    return fmt.Errorf("desktop layout style %q: must be classic|workbench|creation|custom", style)
```

### `internal/config/render.go`
```go
layout_style = %q   # desktop layout: classic|workbench|creation|custom
```

### `desktop/tabs.go`
```go
case "workbench", "creation", "custom": // [CUSTOM-SKIN]
    return true
```

### `desktop/frontend/src/App.tsx`
```typescript
// 行 176
type DesktopLayoutStyle = "classic" | "workbench" | "creation" | "custom";

// 行 178-182
function normalizeDesktopLayoutStyle(style: string | undefined): DesktopLayoutStyle {
  if (style === "workbench") return "workbench";
  if (style === "creation") return "creation";
  if (style === "custom") return "custom";
  return "classic";
}

// 行 852
const singleSurfaceLayout = desktopLayoutStyle === "workbench" || desktopLayoutStyle === "creation" || desktopLayoutStyle === "custom";

// 行 2553
const sidebarCustom = desktopLayoutStyle === "custom";

// 行 2568 — custom 继承 workbench 的全部渲染路径
const sidebarWorkbench = desktopLayoutStyle === "workbench" || desktopLayoutStyle === "custom";

// 行 2590 — app--workbench 已生效，额外加 app--custom 供 CSS 覆盖
sidebarWorkbench && sidebarCustom ? "app--custom" : "",
```

### `desktop/frontend/src/components/SettingsPanel.tsx`
```typescript
// 行 841
type DesktopLayoutStyle = "classic" | "workbench" | "creation" | "custom";

// 行 843-848
function normalizeDesktopLayoutStyle(style: string | undefined): DesktopLayoutStyle {
  if (style === "classic") return "classic";
  if (style === "creation") return "creation";
  if (style === "custom") return "custom";
  return "workbench";
}

// 行 1116
{(["classic", "workbench", "creation", "custom"] as const).map((style) => (
```

### 语言文件
```json
// locales/en.ts
"settings.desktopLayoutStyle.custom": "Custom",

// locales/zh.ts
"settings.desktopLayoutStyle.custom": "自定义",

// locales/zh-TW.ts
"settings.desktopLayoutStyle.custom": "自定義",
```

## CSS 自定义指南

选中 "自定义" 皮肤后，根元素上会同时存在 `app--workbench` 和 `app--custom` 两个 class。
你可以针对 `.app--custom` 写覆盖规则来定制外观，而不用动 workbench 的基础样式。

```css
/* [CUSTOM-SKIN] 自定义皮肤覆盖 — 覆盖 workbench 的特定部分 */
.app--custom .sidebar {
  /* 自定义侧边栏样式，覆盖 workbench 默认 */
  background: var(--bg);
  border-right: 1px solid var(--border);
}

.app--custom .topicbar {
  /* 自定义主题栏 */
  background: var(--surface);
}

.app--custom .workbench-dock {
  /* 自定义右侧 dock */
  background: var(--surface);
}
```

> **注意**：CSS 文件需要被引入才能生效——可以在 `main.tsx` 或 `App.tsx` 中添加 import：
> ```typescript
> import "./styles-custom.css";
> ```
> 这一行不包含在当前改动中，留给用户按需自行添加。
