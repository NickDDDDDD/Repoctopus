# Runtime 架构

Repoctopus 将稳定的领域规则与容易变化的平台接入分开。Runtime 是 composition root：它调用纯 Engine、持久化端口、多仓探测和遥测端口，但 Engine 不访问文件、Git、网络或 IDE。

```text
IDE / Agent / CLI
        │ versioned JSON envelope
        ▼
app/cli ─────────────── workflows/*.yaml
        │
        ▼
domains/runtime
  ├─ domains/workflow-contract  工作流校验、规范化、摘要
  ├─ domains/engine             确定性决策、Guardrail、Eval
  ├─ domains/project            多仓快照与差异
  └─ domains/trajectory         事件、Checkpoint、Cursor 契约
domains/delivery
  ├─ Delivery Intent / Snapshot 多仓交付选择与批准事实
  ├─ Human Decision             IDE/CLI 人工决定协议
  └─ Publication Plan           可恢复的 push 与 MR 动作
        │ ports
        ▼
platform/
  ├─ git                        只读项目探测
  ├─ runtime + filesystem       Journal、原子写入、崩溃恢复
  ├─ telemetry/opentelemetry    OTLP Trace、Log、Metric
  ├─ delivery                   交付 Journal 与策略加载
  ├─ github                     GitHub MR Adapter
  └─ process                    受控子进程执行
```

## 关键边界

### Engine

Engine 接收不可变的 Workflow Package、Run State 和显式输入，返回新状态与候选动作。同一输入必须得到同一结果。动作 ID 由 Run、迭代和步骤稳定计算，Guardrail 在动作产生前执行。

### Runtime

Runtime 负责端口编排和副作用顺序。每次转换先写 Journal，再依次写 Trajectory、Run State 和 Checkpoint；任何中断都可由 Journal 重放为同一最终结果。

### 触手、吸盘、神经与眼睛

- **触手**由 Project Probe 实现，每条连接一个独立 Git 仓库。
- **吸盘**由证据与遥测端口承载；第一阶段已经接入 Git 事实和运行事件，测试、CI、浏览器画面与日志将在后续纵切接入。
- **神经**是版本化 CLI/事件协议，后续 IDE Adapter 与 Hook 只依赖该协议。
- **眼睛**是前端浏览器和后端运行反馈端口，当前只保留架构接点，尚未实现采集。

## 与上游来源的关系

Repoctopus 借鉴并改造了上游项目的确定性 Engine 算法，但没有沿用上游产品外壳。上游 Engine 把部分文件存储和 Skill 依赖放在同一域中；Repoctopus 保留适用的 Resolver、Guardrail、Eval 与循环算法，把工作流契约和持久化分别移到独立领域与平台层。精确来源、摘要和许可证见 `third_party/comet/`。

本架构允许后续加入 TDD、长任务恢复、IDE Adapter、OpenSpec/OpenWiki、人工决策、业务反馈和审计服务器，而不用让这些能力直接耦合到纯 Engine。

### Delivery Domain

Delivery Domain 与通用 Engine 平行。它只接受版本化交付意图、项目事实、策略、验证报告摘要和 Human Decision 事件，不直接执行 Git 或 HTTP。Runtime 通过 Git、Merge Request、Credential、Store 和 Telemetry 端口组合副作用。

本地 checkpoint 与远端发布使用不同信任边界。checkpoint 由共享策略约束分支、提交格式和快速检查；push 与 MR 只在整份交付快照获得有效人工批准后执行。平台端口不暴露 merge，因此具体 Adapter 不能绕过人工合入边界。
