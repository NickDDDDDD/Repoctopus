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

Webhook 只负责唤醒处理链。PostMergeCoordinator 会重新读取代码平台上的 MR、CI、评审和 merge commit，不把 webhook payload 当作最终交付事实；它只返回规范化平台事实，不创建或推进 Run。原 Change Run 通过 Archive 命令接受完整 Business MR 集合后继续。Webhook 丢失时，短生命周期的 `post-merge reconcile` 和 `run start` 前置检查调用同一个 Coordinator，提供最终一致兜底。

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

## 启动生产 Runner

正式 `repoctopus.yaml` 必须配置 `platformEvents.storeProvider`、HTTP 地址、GitHub Credential 引用和 Runner 租约策略；需要自动收尾时再配置引用同一 Runner 的 `postMerge`。完整示例见[项目配置](examples/repoctopus.yaml)。设置配置中引用的环境变量后启动：

```powershell
node bin/repoctopus.js runner start --workspace . --json
```

就绪 envelope 的 `origin` 与配置的 GitHub `path` 组成 webhook URL。Runner 可以由开发者前台启动，也可以由操作系统服务或进程管理器托管；健康判定以 `ready` 输出和 HTTP 可达性为准。使用 `SIGINT`/`SIGTERM` 正常关闭，不要通过删除 `.repoctopus/events/` 来停止或重试任务。多个 Runner 可以并存：同一 Inbox 的 Lease 防止重复领取，独立状态卷之间允许重复计算并由 Change 分支远端 OID 栅栏收敛；当前版本不承诺共享数据库调度或生产级自动扩缩容。

Runner 装配、Credential、目录权限和自举流程见[自举与 Runner 部署](self-hosting.md)。测试 fixture 仍只用于恢复演练，不是生产守护进程。
