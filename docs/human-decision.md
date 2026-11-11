# Human Decision 协议

Repoctopus 使用版本化 `HumanDecisionRequest/Response` 表达必须由人确认的边界。Agent 可以准备材料，不能伪造用户批准。

## 可信通道

Change 生命周期的 Host 可以使用原生提问工具，或在没有此工具时展示对话选项并等待你的真实答复，再通过公开 CLI 回传。Runtime 核对 Run、请求、提案、阶段和允许选项；Open 与 Design 保持两个独立审批。

Host 负责如实关联真实答复或仍覆盖当前提案的明确委托。CLI 从本机执行上下文取得主体，来源记为 `cli`，另记 `native | conversation` 渠道和授权依据；响应文件不是独立的人类点击证明，也不会被冒充为经过 IDE SDK 认证的会话。默认选项、没有回复和普通 Work Outcome 都不构成批准。

项目配置、交付与需求冲突使用各自原有合同，不由新增生命周期入口批准。没有真实用户交互上下文时，继续使用交互式终端。

## Change 生命周期

Host 遇到 `ask` 时，先读取当前请求。以下命令中的 `<run-id>` 使用启动或恢复输出中的身份：

```powershell
repoctopus run decision --workspace . --run <run-id> --json
```

视图提供评审材料、允许选择、条件输入、`responseTemplate`、完整命令 argv 和 Host 指引。Host 展示材料并取得真实答复后，填写模板，将其保存为本机响应文件，再提交：

```powershell
repoctopus run decide --workspace . --run <run-id> --response-file ./response.json --json
```

响应合同见 [生命周期决定 Schema](schemas/lifecycle-human-decision-response.schema.json)。文件上限 64 KiB，拒绝未知字段；`decision`、渠道、授权依据和答复引用必须填写。Open 与意图替换的批准还要求选择 `current | branch | worktree` 隔离。引用只保存摘要，自由评论不能超过 4096 字符。

共享的规划批准属于同一规格根、Change、阶段和规划语义；每个 Run 仍须有请求参与事实及自己的执行隔离。`authorityScope` 和 `recordedViaRunId` 如实展示原批准来源。若 `requiresSubmission=true`，Host 仍需收集条件输入；不要因共享记录显示 `accepted` 就跳过该 Run 尚未选择的隔离。

接受决定后按返回的 `commands.next` 发起下一次 pull。提交不执行下一项 Agent Work，也不允许 Host 选择目标 phase。若回包丢失，先用原请求身份核对结果：

```powershell
repoctopus run decision --workspace . --run <run-id> --request-id <request-id> --proposal-hash <proposal-hash> --json
```

相同选择的重试返回原决定；冲突选择或隔离拒绝。`superseded` 是历史事实，不能授权当前内容。没有待决定请求时返回 `none`，读取不会新建审批。

终端回退保持原有用法：

```powershell
repoctopus run decide --workspace . --run <run-id>
```

## 项目配置

`project prepare` 把完整候选、reconcile diff、未决项、候选摘要和当前正式配置摘要组成请求。批准后才写 `repoctopus.yaml`。等待期间正式配置变化会使请求失效。流程见 [项目接入](project-onboarding.md)。

```powershell
node bin/repoctopus.js project review --workspace . --request <request-file>
```

## 交付发布

开发 checkpoint 会立即把当前 HEAD 普通 push 到策略远端并核对精确 OID，这项备份动作不需要逐次人工批准。创建或更新 MR 仍必须先提交绑定当前多仓快照的验证报告，并通过交互式审批；merge 始终由人执行。详情见 [交付治理](delivery.md)。

```powershell
node bin/repoctopus.js approval review --workspace . --change <change-id>
```

## 权威资料冲突

OpenSpec、设计图、接口契约或其他权威依据出现实质冲突时，Runtime 创建 `requirements-conflict` 请求，不提供默认选择。只暂停冲突节点及其下游；独立分支可以继续。用户选择后应同步相应规范或设计依据，避免后续 Agent 再次遇到同一冲突。

相关 JSON Schema 位于：

- [交付请求](schemas/human-decision-request.schema.json)与[交付响应](schemas/human-decision-response.schema.json)
- [项目配置决定](schemas/project-configuration-decision.schema.json)
- [需求冲突决定](schemas/requirements-conflict-decision.schema.json)
