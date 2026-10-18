# Human Decision 协议

Repoctopus 使用版本化 `HumanDecisionRequest/Response` 表达必须由人确认的边界。Agent 可以准备材料，不能伪造用户批准。

## 可信通道

当前可信来源是交互式 CLI 和经过认证的 IDE Adapter。响应必须同时匹配待处理请求的 `requestId` 与 `snapshotDigest`。用户无需复制摘要；IDE Adapter 应把请求渲染为原生卡片或弹窗，并从已认证会话取得主体身份。

非交互式参数、环境变量、标准输入批量批准、Agent 文本和过期摘要都不能替代确认。无法提供可信交互时，Runtime 保持等待状态。

## 项目配置

`project prepare` 把完整候选、reconcile diff、未决项、候选摘要和当前正式配置摘要组成请求。批准后才写 `repoctopus.yaml`。等待期间正式配置变化会使请求失效。流程见 [项目接入](project-onboarding.md)。

```powershell
node bin/repoctopus.js project review --workspace . --request <request-file>
```

## 交付发布

本地 checkpoint commit 是可回退的开发检查点。push 和 MR 创建或更新属于对外发布，必须先提交绑定当前多仓快照的验证报告，并通过交互式审批。merge 始终由人执行。详情见 [交付治理](delivery.md)。

```powershell
node bin/repoctopus.js approval review --workspace . --change <change-id>
```

## 权威资料冲突

OpenSpec、设计图、接口契约或其他权威依据出现实质冲突时，Runtime 创建 `requirements-conflict` 请求，不提供默认选择。只暂停冲突节点及其下游；独立分支可以继续。用户选择后应同步相应规范或设计依据，避免后续 Agent 再次遇到同一冲突。

相关 JSON Schema 位于：

- [交付请求](schemas/human-decision-request.schema.json)与[交付响应](schemas/human-decision-response.schema.json)
- [项目配置决定](schemas/project-configuration-decision.schema.json)
- [需求冲突决定](schemas/requirements-conflict-decision.schema.json)
