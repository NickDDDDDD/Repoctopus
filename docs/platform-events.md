# 平台事件处理

Repoctopus 先把已验证的代码平台事件提交到持久 Event Inbox，再由 Runner 异步处理。HTTP `202` 只表示 Inbox 已经保存事件，不表示下游交付动作已经完成。进程退出后，新实例从同一 Inbox 恢复，不依赖旧进程的内存状态。

需要执行恢复演练时，参阅[验证平台事件故障恢复](platform-event-recovery.md)。

## 事件处理链路

```text
GitHub
  │ signed POST
  ▼
HTTP Host → GitHub Adapter → PlatformEvents → Event Inbox
                                             │ durable lease
                                             ▼
                                           Runner → Processor
                                             │
                                             ▼
                                           Receipt
```

- HTTP Host 限制请求方法、路径和请求体大小，并保留未合并的多值 Header。
- GitHub Adapter 在解析 JSON 前读取 Credential Provider，并验证 `X-Hub-Signature-256`。
- `PlatformEvents` 以 `provider/source/deliveryId` 生成稳定 Envelope ID，并通过 Store 事务写入 Inbox。
- Runner 使用带 Token 的持久租约领取事件。长任务在租约到期前续租，旧 Token 不能提交结果。
- Processor 返回 `completed`、`retry` 或 `dead_letter`。Inbox 把结果和 Receipt 保存在同一个原子快照中。

Webhook 只负责唤醒处理链。未来的 PostMergeCoordinator 必须重新读取代码平台上的 MR、CI、评审和 merge commit，不得把 webhook payload 当作最终交付事实。

## Inbox 状态

每个 Delivery 保存在 `.repoctopus/events/<envelope-digest>/state.json`。该文件包含规范化 payload，因此应当把 `.repoctopus/events/` 视为敏感持久数据，限制文件系统访问并纳入数据保留策略。

| 状态          | 含义                                                     |
| ------------- | -------------------------------------------------------- |
| `pending`     | 事件已持久化，尚未领取                                   |
| `leased`      | 一个 Runner 持有有效租约                                 |
| `retry_wait`  | 上次处理可重试，等待 `nextAttemptAt`                     |
| `completed`   | Processor 已成功完成，不能人工重跑                       |
| `dead_letter` | 已达到重试上限或输入不可恢复，可通过管理命令显式重新排队 |

Store 使用每个 Delivery 独立的锁和 `transition.json`。如果进程在 Journal 或状态写入之间退出，下一次读取或事务会先重放 Journal。状态和 Receipt 不会形成跨版本组合。

## 去重与乱序边界

相同 Provider、Source 和 Delivery ID 的重复请求返回原 Envelope ID，不创建第二个 Inbox 条目。重复请求携带不同 payload 或事件类型时，入口返回 `409`，因为平台复用了同一个投递身份。

Inbox 不按 `receivedAt` 回退已有条目。不同 Delivery ID 仍代表不同平台投递；对同一 MR 的业务级乱序合并属于 PostMergeCoordinator。Coordinator 通过平台 API 读取当前权威状态后，才能决定是否推进同一个逻辑 Run。

## 安全边界

| 数据                           | 允许出现的位置                   | 禁止出现的位置                        |
| ------------------------------ | -------------------------------- | ------------------------------------- |
| Webhook secret                 | Credential Provider 和验签内存   | 配置文件、命令参数、Inbox、日志、OTel |
| 原始 Header 和签名             | HTTP Host 与 Adapter 的当前请求  | Inbox、状态命令、日志、OTel           |
| 已解析 payload                 | Inbox 持久快照和 Processor 输入  | CLI 状态、Receipt、普通日志、OTel     |
| Lease owner 和 Token           | Inbox 内部状态                   | `event status`、日志、OTel            |
| Envelope、Delivery、Receipt ID | Inbox、脱敏 CLI 状态和 OTel 日志 | OTel Metric 标签中的 Delivery ID      |

`event status` 返回显式允许列表形成的投影，不直接序列化 Inbox Entry。诊断只能使用稳定、低基数的 kebab-case 代码；自由文本和异常消息会替换为固定脱敏代码。OTel 导出发生在持久事务提交之后，导出失败不会回滚 Inbox 事实。

## 失败语义

| 失败位置                          | 外部结果                         | 恢复方式                                          |
| --------------------------------- | -------------------------------- | ------------------------------------------------- |
| 方法、Content-Type 或 Header 无效 | `400`、`405` 或 `415`            | 修正请求，不进入 Inbox                            |
| 请求体超过 Route 上限             | `413`                            | 缩小请求；入口不会读取 Credential                 |
| Credential 不可用或 Inbox 写失败  | `503`                            | 客户端使用相同 Delivery ID 重试                   |
| 相同 Delivery ID 的 payload 冲突  | `409`                            | 停止自动重试并调查平台身份冲突                    |
| Runner 处理失败                   | `retry_wait`，最终 `dead_letter` | 等待退避，或修复原因后执行 `event retry`          |
| Runner 在租约期间退出             | 条目暂时保持 `leased`            | 租约到期后由新 Runner 领取；旧 Token 不能提交结果 |
| OTel 端点不可用                   | Inbox 状态不变                   | 恢复端点后观察后续事件；Inbox 始终是权威事实      |

当前版本已经提供 Host、Route、Runner、Inbox 和管理命令的插件能力，但正式 `repoctopus.yaml` 平台事件配置和长期运行入口仍属于后续组合任务。不要把测试 fixture 当作生产守护进程。
