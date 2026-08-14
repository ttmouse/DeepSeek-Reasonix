# ============================================================
# zk-ge-verification 技能模板：roles.md
# 对应 A4 文件布局中 .zkge/roles.md
# A3 角色与隔离的本项目实例：谁担任什么角色、隔离方式是什么
# ============================================================
# A3 角色矩阵（规则内建，见 SKILL.md）：
#   ORCHESTRATOR / SPECIFIER / BUILDER / CHALLENGER / VERIFIER / SKEPTIC / ATTESTOR
# 隔离铁律：同一 Agent 实例或同一上下文 MUST_NOT 同时承担 BUILDER 与 CHALLENGER。

roles:
  orchestrator:                      # 调度：全部输入，输出摘要/状态/公开结果
    who: ""                          # 如 "reasonix 主会话"
    isolation: ""
  specifier:                         # 定问题：用户输入/外部事实 → Meta/claim/架构/验证计划
    who: ""                          # 如 "需求负责人（人类）"
    isolation: ""
  builder:                           # 实现：已冻结公开规格 → 源码/制品
    who: ""                          # 如 "AI 子上下文 A"
    isolation: "MUST_NOT 读取隐藏挑战；MUST_NOT 修改策略或阈值"
  challenger:                        # 挑毛病：Meta/claim/风险/历史缺陷 → 隐藏挑战/故障计划
    who: ""                          # 如 "AI 子上下文 B（与 builder 不同上下文）"
    isolation: "MUST_NOT 读取 Builder 推理记录"
  verifier:                          # 验证：候选制品/挑战/固定工具链 → 原始结果
    who: ""
    isolation: "MUST_NOT 修改制品或重跑到绿"
  skeptic:                           # 怀疑：图/git/历史 → 排序/异常/候选规则
    who: ""
    isolation: "MUST_NOT 直接改变 claim_status"
  attestor:                          # 见证：摘要/原始结果 → 签名 manifest
    who: ""                          # 如 "项目负责人（人类），最终签字放行"
    isolation: "MUST_NOT 生成缺失的原始证据"

# R2/R3 项目的额外隔离要求
high_risk_isolation:
  - "BUILDER 与 CHALLENGER 使用不同模型"
  - "BUILDER 与 CHALLENGER 使用不同工具实现"
  - "或独立专家参与"
