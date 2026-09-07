# Mermaid 滚轮缩放交互问题分析

## 问题描述

在聊天历史记录中滚动查看消息时，如果遇到 Mermaid 流程图，鼠标滚轮事件会被 SVG 图表的 pan/zoom 机制拦截，导致页面停止滚动、变成对流程图的缩放。

## 根因分析

**关键代码：** `desktop/frontend/src/components/mermaidPanZoom.ts:111-114, 140`

```typescript
const onWheel = (event: WheelEvent) => {
    event.preventDefault();  // ← 阻止默认滚动行为
    zoomAt(event.clientX, event.clientY, ...);
};

svg.addEventListener("wheel", onWheel, { passive: false });
```

wheel 事件监听器直接附加在 SVG 元素上，**无差别拦截所有滚轮事件**。无论用户是：
- 滚动页面路过 Mermaid 图（期望：继续滚动页面）
- 有意在图内缩放（期望：缩放图表）

结果都是缩放图表，页面无法滚动。

## 方案对比

### 方案 A：移除 wheel 监听器，仅靠按钮缩放 ✅ 推荐

**改动：** 删除 `mermaidPanZoom.ts` 中的 wheel 事件监听器（`onWheel` + `addEventListener("wheel", ...)`），保留 zoom 按钮（`MermaidDiagram.tsx` 中已有的 +/-/reset 按钮）。

**优点：**
- 改动最小，2 行代码
- 零副作用，不引入新状态
- 滚轮路过 Mermaid 图时页面正常滚动
- 缩放功能仍可通过按钮使用

**缺点：**
- 失去鼠标滚轮直接在图上缩放的能力
- 需要用户点击按钮进行缩放

### 方案 B：交互门控（仅在有 pointerdown 后启用缩放）

**改动：** 在 `mermaidPanZoom.ts` 中增加一个 `interacted` 状态标志：
- 初始为 `false`（滚轮事件被忽略，页面正常滚动）
- 用户在 SVG 上按下鼠标（`pointerdown`）时设为 `true`
- 滚轮事件中检查 `interacted`：`true` 则缩放，`false` 则忽略（让事件冒泡）
- 用户离开 SVG（`pointerleave`）或一段时间无操作后重置为 `false`

**优点：**
- 保留了滚轮缩放能力
- 路过滚动时正常

**缺点：**
- 需要额外状态管理
- 用户体验有微妙变化：首次滚轮进图时不缩放，需要先点击图再滚轮
- 逻辑复杂度增加

### 方案 C：通过 deltaMode 或滚动意图检测

**思路：** 分析 wheel 事件的 `deltaMode`、`deltaY` 等属性，结合页面滚动位置判断用户意图。

**问题：** 不可靠。WheelEvent 无法区分"用户在页面滚动"和"用户在图内缩放"——二者都是 `deltaY` 变化。`event.target` 判断也不可靠，因为 SVG 内部元素都是图表的一部分。

## 推荐方案：方案 A

**理由：**
1. 用户明确说"预期是滚轮过程中不缩放，继续滚动"——方案 A 直接满足
2. 已有 zoom 按钮（+/-/reset）提供了显式的缩放入口
3. 改动最小，风险最低
4. 如果用户后续需要滚轮缩放，可以再按方案 B 迭代

## 实现步骤

### 改 `mermaidPanZoom.ts`
1. 删除 `onWheel` 函数
2. 删除 `svg.addEventListener("wheel", onWheel, { passive: false })`
3. 删除 `svg.removeEventListener("wheel", onWheel)`（在 `destroy()` 中）

### 测试
- 现有 pan/zoom 测试（`mermaidPanZoom.test.ts` 如果有）通过
- 手动验证：页面滚动路过 Mermaid 图时正常滚动
- 手动验证：zoom 按钮仍可缩放

## 不推荐方案

- **方案 B**（交互门控）：改动较大，增加复杂度，且用户需要额外点击才能激活缩放
- **CSS 方案**（`pointer-events: none`）：会使整个图表无法交互（不能点击链接、拖动等），过强
- **debounce 方案**：无法区分"路过"和"有意缩放"