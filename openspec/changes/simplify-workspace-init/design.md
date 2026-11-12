# Design

## Context

`project detect` 目前把仓库发现、Store 检查和 Verify 命令推断放在一起。共享配置 Schema 要求非空 Profile，接入 Domain 要求默认 Verify 覆盖，Design preflight 还会编译选定 Profile。因此只把现有命令交给 Agent 运行无法完成轻量接入。

## Goals / Non-Goals

**Goals:** 从已安装宿主一次调用接入，单仓和多仓复用同一工作流。没有 Profile 也能做开发，必要时恢复同一 Run 完成验证。

**Non-Goals:** 手工证据交付、缩减五阶段、改变 Store 规格权威、增加宿主插件或新增宿主支持。

## Decisions

1. 安装包提供可显式安装的个人级 Init 入口。宿主只调用 CLI、展示 Runtime 预览并传回用户选择。项目级 `repoctopus` 负责新建或恢复，另一个项目级 Skill 负责配置 Verify。个人级 Skill 安装和 Workspace 接入分别绑定自己的写入范围。
2. 平台适配器观察真实 Git 根、仓库边界和 Store。接入服务生成最小配置并复用批准、文件所有权、Intent 和 Receipt。单仓以业务仓为 Workspace，多仓选择明确的独立 Workspace 和业务仓。冲突先诊断再生成审批。普通接入省去构建文件和候选文件交接，底层 CLI 对误传探测草稿提供具体提示。
3. 配置服务保留同一共享 Schema 和审批权威。初始化不推断命令。Verify 配置 Skill 单独检查实际命令、仓库和覆盖范围，形成受审核的 Profile 更新。已有 Profile 随接入或补装保留。
4. Runtime 将 Profile 缺席作为独立可观察事实。已选 Profile 存在时继续执行 Design coverage preflight。无 Profile 时保留 Acceptance Set 和 Build 约束，在首次需要正式验证处返回配置入口。新 Profile 经批准后，同一 Run 在冻结 Verification Input 前编译当前覆盖。配置变化的影响按真实依赖判断，其他仓库、Store、代码和策略变化继续走现有恢复规则。Design 阶段应核对具体 checkpoint、持久化协议和配置摘要边界。
5. Cordis Service 承接已有配置和 Evidence 能力，领域模块表达接入与续跑约束，平台层负责 Git、Store 和文件观察，Engine 继续负责阶段与 Gate。按现有 trajectory 和 OTLP 核对等待与继续，验收结果进入正式 Evidence。

## Risks / Trade-offs

- 没有 Profile 时，开发者可以完成 Build，覆盖缺口会在交付前显式出现。已存在但无效的 Profile 仍应尽早报告。
- 在活动 Run 上补配可能同时改变共享配置摘要和 Git 提交。必须测试实际 commit/push 后的冷恢复、已完成工作包的有效性，以及真实作用域漂移的阻断。
- 打包验收需在产品源码之外运行。用 Windows 同级多仓和业务仓普通子目录复现 Issue，并覆盖单仓、同一请求中断、已有配置和拒绝审批。规格、公共接口或宿主官方约束冲突时先澄清。
