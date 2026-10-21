# 验证平台事件故障恢复

本指南使用真实子进程、TCP HTTP 请求、GitHub HMAC 签名和文件 Inbox 验证平台事件恢复。演练会在收到 `202` 后强制终止入口进程，重启入口确认幂等，再由另一个 Runner 进程完成同一 Delivery。

该流程面向维护 Repoctopus 事件入口的工程师。它使用测试 fixture 验证当前能力，不启动生产守护进程。架构和数据边界参阅[平台事件处理](platform-events.md)。

## 开始之前

在 Repoctopus 仓库根目录准备 Node.js `22.16+` 或 `24+`，并安装锁定依赖：

```powershell
npm install
npm run build
```

演练只监听 `127.0.0.1` 的临时端口。Webhook secret 通过子进程环境传递，不写入命令参数、fixture 文件或 Inbox。

## 运行恢复演练

1. 在仓库根目录运行进程外恢复测试：

   ```powershell
   npm run test:platform-event-recovery-e2e
   ```

2. 确认 Vitest 报告一个测试文件和一个测试通过：

   ```text
   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

3. 如果测试失败，保留失败输出并按[定位失败阶段](#定位失败阶段)处理。测试会删除临时 workspace 和临时 fixture bundle，不会删除 `.repoctopus/` 中已有的项目数据。

测试按以下顺序执行，每一步都跨越真实进程边界：

1. 编译 `test/fixtures/platform-event-process.ts`，并启动只包含 HTTP Host、GitHub Route 和文件 Inbox 的入口进程。
2. 计算请求体的 SHA-256 HMAC，通过真实 TCP 连接发送 GitHub 风格 Header 和 JSON 请求体。
3. 等待入口返回 `202` 和 `duplicate: false`。该响应证明 Inbox 事务已经完成。
4. 使用强制终止结束入口进程。
5. 在独立 CLI 进程中执行 `event status`，确认 Delivery 仍为 `pending`。
6. 启动新的入口进程，并重发相同 Delivery。入口返回同一个 Envelope ID 和 `duplicate: true`。
7. 启动独立 Runner 进程，使用持久租约领取并完成 Delivery。
8. 在另一个 CLI 进程中执行 `event status`，确认状态为 `completed`、尝试次数为 `1`，并且只有一个完成 Receipt。
9. 检查所有捕获输出，确认没有 webhook secret、签名 Header、Lease Token 或 payload 标记。

## 检查已有 Delivery

当入口返回 `envelopeId` 后，使用该 ID 查询脱敏状态：

```powershell
node bin/repoctopus.js event status `
  --workspace C:\path\to\workspace `
  --envelope sha256:<digest> `
  --json
```

如果状态是 `dead_letter`，先修复诊断原因，再把同一个 Delivery 重新排队：

```powershell
node bin/repoctopus.js event retry `
  --workspace C:\path\to\workspace `
  --envelope sha256:<digest> `
  --json
```

不要对 `completed`、`leased` 或 `retry_wait` 条目执行人工重试。命令会拒绝这些状态，防止重复执行下游副作用。

## 定位失败阶段

如果入口没有返回 `202`：

1. 检查 HTTP 状态和稳定错误代码。
2. 对 `401` 检查发送方与 `GITHUB_WEBHOOK_SECRET` 是否使用相同字节。
3. 对 `409` 停止重试，并检查平台是否对不同 payload 复用了 Delivery ID。
4. 对 `503` 使用相同 Delivery ID 重试。不要生成新的 Delivery ID，否则 Inbox 会创建另一个逻辑投递。

如果重启后 `event status` 找不到 Delivery：

1. 确认新进程使用与入口相同的 workspace 根目录。
2. 检查 `.repoctopus/events/<digest>/state.json` 或 `transition.json` 是否存在。
3. 运行只读状态命令触发 Journal 核对。不要手工编辑或删除 Journal。

如果 Delivery 长时间保持 `leased`：

1. 等待 `leaseExpiresAt` 到期。
2. 确认新 Runner 的系统时间正确。
3. 启动新 Runner 重新领取。不要复制旧 Lease Token 或直接修改 `state.json`。

如果 Delivery 进入 `dead_letter`：

1. 根据 `diagnostic` 修复 Processor、仓库映射或外部服务。
2. 使用 `event retry` 追加人工重试 Receipt。
3. 再次运行 Runner，并使用 `event status` 确认新的尝试结果。

## 清理演练资源

测试在 `afterEach` 中删除系统临时 workspace 和仓库内临时 bundle 目录。测试结束后运行以下命令，确认没有遗留文件：

```powershell
git status --short
```

空输出表示演练没有修改受 Git 管理的工作树。自举 Run、Evidence 和真实项目 Inbox 是审计资料，不属于临时演练资源，不应随测试清理。
