# Spec Delta

## REMOVED Requirements

### Requirement: 平台 Adapter 在解析前验证请求

**Reason**: Repoctopus 不再接收 Webhook HTTP 请求，平台签名、请求体和监听入口整体退役。

**Migration**: 远端事实只通过 Delivery Provider 的短生命周期 API 查询读取。

### Requirement: 已验证投递先持久化再确认接收

**Reason**: 没有入站平台投递或 Event Inbox。

**Migration**: Publication 与 Consistency Receipt 只保存 Repoctopus 主动查询后的有界事实。

### Requirement: 平台投递幂等且允许乱序

**Reason**: 入站 Delivery Envelope、去重和乱序处理不再属于产品能力。

**Migration**: 发布动作按稳定 Publication identity 幂等；一致性审查总是读取当前平台事实。

### Requirement: Webhook 只作为唤醒信号

**Reason**: 产品没有 Webhook 或唤醒链。

**Migration**: 下一次任务启动或显式 `change reconcile` 执行按需拉取。

### Requirement: Event Inbox 支持崩溃恢复和死信诊断

**Reason**: Event Inbox、lease、retry、dead letter 和长驻 Runner 整体删除。

**Migration**: 短生命周期命令失败时返回诊断，下次命令重新查询当前事实。

### Requirement: 代码平台 Adapter 可替换

**Reason**: Webhook 验签和 Delivery Envelope Adapter 退役；代码平台 API Adapter 的可替换性已由 Delivery Governance 覆盖。

**Migration**: Provider 专有 MR API 调用继续停留在 Delivery Adapter 内。
