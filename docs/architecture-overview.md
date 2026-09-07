# Reasonix 智能体编排架构总览

> 使用 VSCode 或 Markdown Preview Enhanced 渲染 Mermaid 图表。

---

## 1. 整体架构：七层映射

```mermaid
flowchart TB
    subgraph Governance["治理与审计 (横向贯穿)"]
        Guardian[guardian.Session<br/>LLM 安全审查子智能体]
        Policy[permission.Policy<br/>Allow / Ask / Deny 三态]
        Sandbox[sandbox.Spec<br/>文件读写限制 + 网络开关]
        Evidence[evidence.Ledger<br/>操作凭据台账]
        CacheDiag[cache_shape.go<br/>Prefix 稳定性诊断]
        Audit["session .jsonl<br/>全会话持久化审计"]
    end

    subgraph Perception[" 感知层"]
        FileTools["read_file / grep / glob / ls<br/>built-in tools"]
        LSP["lsp_definition / references<br/>internal/lsp/"]
        CodeGraph["codegraph_context / trace<br/>MCP CodeGraph"]
        WebFetch["web_fetch<br/>外部网络"]
        EnvProbes["环境探测<br/>internal/environment/"]
        AtRefs["@ref 引用解析<br/>control/refs.go"]
        ProjectMemory["项目持久化记忆<br/>REASONIX.md + AGENTS.md<br/>internal/memory/ → prefix"]
        HistorySearch["历史会话检索<br/>internal/history/"]
        SessionHistory["Session 对话历史<br/>agent/session.go"]
    end

    subgraph PolicyLayer[" 策略规则层"]
        TaskClassifier["TaskClassifier<br/>启发式 + LLM 双级分类器<br/>区分任务 vs 聊天"]
        Gate["Gate 接口<br/>每次工具执行前门控"]
        PlanGate["Agent.planMode<br/>只读规划门"]
        MCPTrust["PlanModeReadOnlyTrustGate<br/>MCP 只读信任"]
        MaxSteps["maxSteps 预算<br/>+ grace round"]
        FinalReadiness["finalReadinessCheck<br/>证据签名验证"]
        Posture["审批姿态<br/>ask / auto / yolo"]
    end

    subgraph Orchestration[" 编排层"]
        AgentRun["Agent.Run()<br/>核心运行循环"]
        Coordinator["Coordinator<br/>双模型编排<br/>planner + executor"]
        TurnOrch["TurnOrchestrator<br/>turn 生命周期管理"]
        PlanMode["Plan Mode 流程<br/>规划 → 审批 → 执行"]
        GoalFSM["Goal FSM<br/>自主目标模式<br/>[goal:continue/complete/blocked]"]
        AutoPlan["Auto-Plan<br/>启发式评分 + LLM 分类"]
        MemCompiler["Memory Compiler v5<br/>输入 → 结构化执行契约"]
        SubAgents["task / read_only_task<br/>子智能体委托"]
        ParallelTasks["parallel_tasks<br/>并行子任务"]
        Compact["maybeCompact()<br/>上下文压缩摘要"]
        StreamRecovery["流式恢复<br/>中断重试最多 3 次"]
    end

    subgraph Execution[" 执行层"]
        LLMStream["Agent.stream()<br/>→ provider.Stream()"]
        ToolRegistry["tool.Registry<br/>内置 + MCP 插件"]
        ExecuteBatch["executeBatch()<br/>分区并行/串行"]
        Skills["run_skill / read_skill<br/>内联 + 子智能体技能"]
        MCP["plugin.Host<br/>MCP stdio JSON-RPC"]
        Bash["sandbox.Shell<br/>bash / powershell"]
    end

    subgraph Results[" 结果层"]
        EventStream["event.Sink<br/>类型化事件流"]
        TextSink["TextSink<br/>事件 → ANSI 终端"]
        OutputStyle["OutputStyle<br/>persona/tone 风格"]
        ReasoningDisplay["推理链展示<br/>reasoning_content 事件"]
        DesktopUI["Wails 桌面前端<br/>React 渲染"]
    end

    subgraph Action[" 行动层"]
        Todo["todo_write / complete_step<br/>任务列表 + 签名验证"]
        GoalLoop["GoalMachine<br/>自动完成检查 + 自我验证"]
        BackgroundJobs["jobs.Manager<br/>后台作业通知"]
        Hooks["hook.Runner<br/>Pre/PostToolUse 钩子"]
        Checkpoint["checkpoint<br/>文件快照 + Rewind"]
        Remember["remember / forget<br/>记忆持久化"]
        Notices["event.Notice<br/>系统通知"]
    end

    Perception --> PolicyLayer
    PolicyLayer --> Orchestration
    Orchestration --> Execution
    Execution --> Results
    Results --> Action
    Action -.->|turn-tail 注入| Perception
    Action -.->|记忆持久化| ProjectMemory

    Governance -.-> Perception
    Governance -.-> PolicyLayer
    Governance -.-> Orchestration
    Governance -.-> Execution
    Governance -.-> Results
    Governance -.-> Action
```

---

## 2. 主流程：Agent Run 循环

```mermaid
flowchart TB
    Start([用户输入]) --> C{Controller.Compose}
    C -->|注入| RL["<reasoning-language> 块"]
    C -->|注入| MU["<memory-update> 块<br/>turn-tail 笔记"]
    C -->|注入| BJ["<background-jobs> 块<br/>后台作业完成通知"]
    C -->|注入| PM["Plan Mode 标记"]
    C -->|注入| AG["<active-goal> 块"]
    C --> Composed[已编译输入]

    Composed --> TC{TurnOrchestrator}
    TC -->|检查| AutoPlan["shouldAutoPlan?<br/>→ 自动开启 Plan Mode"]
    TC -->|首次| SessionStart["maybeSessionStart<br/>会话启动 hook"]
    TC --> AgentRun["Agent.Run(ctx, input)"]

    subgraph AgentRunLoop["Agent.Run() 主循环"]
        direction TB
        Step0["0. 追加用户消息到 session"]
        Step0 --> Step1

        subgraph Loop["for step := 0; step < maxSteps; step++"]
            Step1["1. stream() → LLM"]
            Step1 --> Step2{结果类型}

            Step2 -->|ChunkReasoning| Reasoning["发射 reasoning 事件"]
            Step2 -->|ChunkText| Text["发射 text 事件"]
            Step2 -->|ChunkToolCall| ToolCalls["收集工具调用"]
            Step2 -->|ChunkUsage| Usage["记录 token 用量<br/>缓存命中状态"]
            Step2 -->|中断| StreamRecovery["重试最多 3 次"]

            ToolCalls --> Step3["3. 追加 assistant 消息到 session<br/>含 reasoning + text + tool_calls"]
            Step3 --> Step4{有工具调用?}

            Step4 -->|无| FinalCheck["finalReadinessCheck"]
            FinalCheck -->|就绪| Return["return nil<br/>turn 完成"]
            FinalCheck -->|就绪失败| RetryReadiness["重试最多 3 次"]

            Step4 -->|有| ExecuteBatch["4. executeBatch()"]
            ExecuteBatch --> Partition["分区并行/串行执行"]
            Partition --> ExecuteOne["executeOne()"]
            ExecuteOne --> Results["工具结果追加到 session"]
            Results --> Compact["5. maybeCompact()<br/>>80% 窗口 → 摘要压缩"]
            Compact --> Loop
        end

        Loop -->|grace round| Grace["超限后一轮 grace<br/>只输出最终回答"]
    end

    AgentRun --> TurnDone{Turn 后处理}

    TurnDone -->|Plan Mode| PlanApproval{"用户审批"}
    PlanApproval -->|批准| PlanExec["关闭 Plan Mode<br/>→ 合成 turn 自动执行"]
    PlanApproval -->|拒绝| StayPlan["保持 Plan Mode<br/>继续规划"]
    PlanExec --> StayPlan

    TurnDone -->|Goal Mode| GoalCheck{"解析末尾标记"}
    GoalCheck -->|[goal:continue]| GoalContinue["自动注入合成 turn"]
    GoalCheck -->|[goal:complete]| GoalEnd["结束目标"]
    GoalCheck -->|[goal:blocked]| GoalBlocked["停止并等待用户"]

    GoalContinue --> GoalSelfCheck["质量自检 round"]
    GoalSelfCheck --> GoalEnd

    TurnDone -->|普通| WaitNext[等待下一个用户输入]

    WaitNext --> Start
    GoalContinue --> Start
```

---

## 3. Plan Mode 规划 → 执行流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant C as Controller
    participant TA as TurnOrchestrator
    participant A as Agent
    participant LLM as LLM
    participant T as Tools

    U->>C: 输入任务
    C->>C: maybeAutoPlan → 开启 Plan Mode
    C->>C: Compose → 注入 PlanModeMarker
    C->>TA: runOrchestratedTurn

    TA->>A: Agent.Run(ctx, composed)
    Note over A: planMode = true
    
    loop 规划回合
        A->>LLM: stream() — 带 PlanModeMarker
        LLM-->>A: 只读工具调用 (read_file/grep/ask)
        A->>T: executeOne — Gate 放行只读工具
        T-->>A: 结果
        A->>LLM: 下一轮 stream
        LLM-->>A: 最终回答 + 分层计划
    end

    A-->>TA: return nil
    TA->>C: [Plan Mode 后处理]
    C->>C: requestApproval(plan)
    C-->>U: 呈现计划

    U->>C: 批准 ✓
    C->>C: SetPlanMode(false)
    C->>C: setPlanAutoApprove(true)
    C->>TA: runComposedSyntheticTurn(planApprovedMessage)

    TA->>A: Agent.Run — plan mode 已关闭
    
    loop 执行回合
        A->>LLM: stream() — 无规划标记
        LLM-->>A: 工具调用 (含 writer)
        A->>T: executeOne — Gate 自动放行
        T-->>A: 结果
        A->>LLM: 下一轮 stream
    end

    A-->>TA: return nil
    TA-->>U: 执行完成
```

---

## 4. 双模型 Coordinator 流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant C as Controller
    participant Co as Coordinator
    participant P as Planner<br/>(独立 session)
    participant E as Executor<br/>(独立 session)
    participant T as Tools

    U->>C: 输入任务
    C->>Co: Run(input)

    Co->>Co: shouldPlan(input)? → true

    Co->>P: plannerAgent.Run(input)
    Note over P: 仅只读工具 (read-only registry)
    P->>P: 探索代码库
    P->>P: 输出计划 + executor 指令
    P-->>Co: return nil

    Co->>C: 通知用户规划阶段完成
    
    Co->>E: executorAgent.Run(handoff)
    Note over E: 完整工具集
    Note over E: "Reasonix executor handoff" 标记

    E->>E: executeBatch() 执行工具
    E-->>Co: return nil

    Co-->>C: turn 完成
    C-->>U: 结果呈现

    Note over P,E: 两个 session 各自独立<br/>prompt prefix cache 互不干扰
```

---

## 5. Goal 目标 FSM

```mermaid
flowchart LR
    Idle[⚪ Idle] -->|用户设置目标| Running[🟢 Running]
    Running -->|模型回答 [goal:continue]| Turn["执行 turn"]
    Turn --> Running
    Running -->|模型回答 [goal:complete]| Complete["🟢 Goal Complete"]
    Complete --> SelfCheck["自动质量自检"]
    SelfCheck -->|通过| Done["✅ Done"]
    SelfCheck -->|发现问题| Fix["修复"]
    Fix -->|模型回答 [goal:continue]| Turn
    Running -->|模型回答 [goal:blocked]| Blocked["🟡 Blocked<br/>等待用户"]
    Blocked -->|用户输入| Running
    Running -->|用户取消 / 超 50 轮| Stopped["🔴 Stopped"]
```

---

## 6. 上下文压缩触发器

```mermaid
flowchart LR
    subgraph Context["Context Window"]
        P1["⚡️ Soft Notice<br/>> 50% 窗口<br/>报告但保持 cache"]
        P2["✂️ Tool Result Snip<br/>> 60% 窗口<br/>裁剪过期工具结果"]
        P3["🔔 Trigger<br/>> 80% 窗口<br/>执行摘要压缩"]
        P4["🚨 Force<br/>> 90% 窗口<br/>强制压缩"]
    end

    P3 --> Compact["maybeCompact()"]
    Compact --> Summary["LLM 摘要历史"]
    Summary --> KeepTail["保留最近 tail<br/>+ cache-stable prefix"]
    KeepTail --> Resume["继续执行<br/>前缀 cache 仍 warm"]
```

---

## 7. 子智能体系统架构

```mermaid
flowchart TB
    MainAgent["主 Agent<br/>Agent.Run()"]

    subgraph TaskTool["task 工具调用"]
        SubAgent["子 Agent<br/>过滤后的 ToolRegistry"]
        SubAgent --> SAInput["子 session + 输入"]
        SAInput --> SARun["子 Agent.Run()"]
        SARun --> SAResult["子结果 → 父工具结果"]
    end

    subgraph ReadOnlyTask["read_only_task 工具调用"]
        ROAgent["只读子 Agent<br/>仅读工具"]
        ROAgent --> RORun["只读研究"]
        RORun --> ROResult["研究结论 → 父工具结果"]
    end

    subgraph ParallelTasks["parallel_tasks 调用"]
        P1["子任务 1<br/>goroutine"]
        P2["子任务 2<br/>goroutine"]
        P3["子任务 3<br/>goroutine"]
        P1 --> Result["并发收集结果"]
        P2 --> Result
        P3 --> Result
    end

    MainAgent -->|task| TaskTool
    MainAgent -->|read_only_task| ReadOnlyTask
    MainAgent -->|parallel_tasks| ParallelTasks

    Note["⚠️ TaskTool 排除递归工具<br/>subagentMetaTools =<br/>task, read_only_task, parallel_tasks,<br/>run_skill, install_skill, ...]
```
