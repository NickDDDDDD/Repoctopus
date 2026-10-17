# Human Decision 协议

Repoctopus 使用版本化 `HumanDecisionRequest` 请求人类决定。IDE Adapter 应把请求渲染为原生卡片或弹窗，并提供批准、要求修改和拒绝三种选择。用户不需要复制快照摘要；Adapter 返回的响应必须引用请求和快照，主体身份来自已认证的会话上下文。

```json
{
  "apiVersion": "repoctopus/v1alpha1",
  "kind": "HumanDecisionRequest",
  "requestId": "018f-request",
  "decisionType": "delivery-approval",
  "changeId": "add-agent-monitoring",
  "snapshotDigest": "sha256:0123456789abcdef",
  "reportDigest": "sha256:fedcba9876543210",
  "repositories": [],
  "actions": [],
  "options": ["approve", "request_changes", "reject"]
}
```

Adapter 不得允许 Agent 在没有用户操作的情况下构造批准响应。无法提供可信交互时，Runtime 保持 `awaiting_approval`。终端降级入口为：

```shell
repoctopus approval review --change add-agent-monitoring
```

该命令要求交互式 TTY，不提供 `--yes`、环境变量批准或标准输入批量批准。

JSON Schema 位于 [human-decision-request.schema.json](schemas/human-decision-request.schema.json) 和 [human-decision-response.schema.json](schemas/human-decision-response.schema.json)。
