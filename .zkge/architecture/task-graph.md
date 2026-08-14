# task-graph.md —— 任务图谱（阶段⑧ 可执行规约 · 任务图谱）
# 模板来源：renheng B2B 订单履约验证项目 docs/01-core-graph.html §2.1-2.7（已实战验证）
#
# 任务图谱回答「系统如何工作」：主流程怎么编排、每个子流程状态机长什么样、
# 哪些节点是人工闸门、哪些是自动。与 ontology.yaml（世界知识图谱）互为两半：
#   🧠 世界知识图谱 = 系统记住什么（ontology.yaml）
#   ⚙️ 任务图谱     = 系统如何工作（本文件）

# ── 主流程编排图（mermaid flowchart TD）────────────────────────────────────
# 用编号节点表达强顺序：T0 入口 → T1 段① → T2 段② → … → 完成；虚线表达失败/退回/升级分支。
# 每个 T 节点标注：所属段、人工闸门数量（Signal 等待）、自动处理（Timer）。
# 示例（B2B 订单履约 ORD→STK→SHP→INV 四段）：
#   T0["⓪ 入口分流<br/>预订单确认 / 快速下单<br/>(幂等键)"]
#   T1["① ORD 段<br/>校验→审价→(C/D)董事长→合同<br/>(人类闸门×2, Signal)"]
#   T2["② STK 段<br/>商务备货→仓管确认→(款到)财务→发货命令"]
#   T3["③ SHP 段<br/>商务分配→仓管实际发货<br/>(库存联动单事务)"]
#   T4["④ INV 段<br/>回单四分流→开票→回款→归档"]
#   T5["⑤ 完成<br/>OrderClosed"]
#   T0 --> T1 --> T2 --> T3 --> T4 --> T5
#   T1 -.->|退回/拒绝| F["❌ FAILED/REJECTED"]
#   T4 -.->|无回单超5天| E["例外子流程"]

mermaid: |
  ```mermaid
  flowchart TD
    <!-- 在此粘贴主流程编排图 -->
  ```

# ── 子流程状态机（每段一个 stateDiagram-v2）─────────────────────────────────
# 命名规范：<段>_<状态>（如 ORD_REQUESTED / STK_WAREHOUSE_CONFIRMING），
# 跨段联合状态用阶段前缀避免重名（RETURNED 在 DB 单列中必须无歧义）。
# 纪律：
#   1. 穷举合法迁移 + 显式禁止迁移（CQ-04 依赖）
#   2. 人工闸门用 Signal 等待，标注 ✅ 通过 / 退回 / 拒绝 三分支
#   3. 每个迁移必须对应 ontology.yaml events 中一个事件（状态迁移与事件同事务）
#   4. Timer 驱动的迁移（超时/升级/例外触发）必须显式画出
# 示例（ORD 段）：
#   [*] --> ORD_REQUESTED: 预订单确认 / 快速下单（幂等键）
#   ORD_REQUESTED --> ORD_PRICE_REVIEWING: 基础校验通过
#   ORD_PRICE_REVIEWING --> ORD_PRICE_APPROVED: ✅ 主管通过（Signal）
#   ORD_PRICE_REVIEWING --> ORD_RETURNED: 退回修改（Signal）
#   ORD_PRICE_APPROVED --> ORD_CONTRACT_GENERATING: A/B 级跳过董事长
#   ORD_PRICE_APPROVED --> ORD_CHAIRMAN_REVIEWING: C/D 级
#   ORD_CHAIRMAN_REVIEWING --> ORD_CONTRACT_GENERATING: ✅ 董事长通过（Signal）
#   ORD_CONTRACT_GENERATING --> ORD_CONTRACTED: 合同生成校验通过
#   ORD_CONTRACTED --> STK_READY_FOR_STOCK: 进入备货段

```mermaid
stateDiagram-v2
  <!-- 段1：在此粘贴（每段一个，复制本块） -->
```

```mermaid
stateDiagram-v2
  <!-- 段2：在此粘贴 -->
```

# ── 编排规则四要素（每个子流程/主流程对照填写）──────────────────────────────
# 这是任务图谱的灵魂：Graph Engineering 四规则在本项目的落地，每条都要有具体答案。
orchestration_rules:
  - rule: parallel_fan_out
    question: "哪些可以并行扇出，哪些必须串行？"
    answer: ""   # 例：数量守恒走单事务串行（业务一致性优先）；通知类副作用（催办/提醒）可扇出
  - rule: independent_verifier
    question: "授权/校验是否独立成 Activity 并在每个业务副作用前重复验证？"
    answer: ""   # 例：授权检查是独立 Activity，业务副作用前重复验证（纵深防御）；AI 只产候选 + 确定性代码校验
  - rule: stop_rule
    question: "每个等待节点/超时的停止规则是什么？"
    answer: ""   # 例：审批 Signal 等待 + Timer 催办升级（24h/48h）；Activity 全局超时 + 重试上限；例外 Timer 自动分流
  - rule: human_gate
    question: "哪些节点是人工闸门？AI/自动化是否可能绕过？"
    answer: ""   # 例：三方审批全部 Signal 人工节点；Agent 预订单必须人工确认才生成正式订单（无旁路）

# ── 任务图 ↔ 世界图 roundtrip（阶段⑨ 的验证闭环）───────────────────────────
# 实施后回填：代码 → code-review-graph 读回 → 回答每个能力问题 → 答不出 → 修正 ontology / 状态图。
# 验证终点：代码实现后必须能回答 ontology 中全部业务层能力问题；答不出的就是设计裂缝。
roundtrip_checklist:
  - "每个状态机的合法/禁止迁移都有能力问题覆盖（CQ-04 类）"
  - "每个事件在 events 中有声明，且状态迁移与事件同事务"
  - "每个守恒约束有 claims/ 中的 oracle"
  - "人工闸门无自动旁路（Signal 之外无旁路）"
