# Evidence

Evidence 是 Repoctopus 对“实现已经获得正确反馈”的可审计证明。Agent 的文字说明不能替代 Receipt 或 Bundle。

## 核心对象

- **Attempt**：一次显式 Profile 执行，保留成功、失败、中断和恢复历史。
- **Receipt**：一个节点的一次 Adapter 结果，绑定输入指纹、可信等级、新鲜度、Artifact 与 finding。
- **Artifact**：按 SHA-256 内容寻址的输出引用。相同内容只保存一次。
- **Bundle**：一个 Attempt 的有序检查集合，结果为 `passed`、`failed`、`incomplete` 或 `passed_with_warnings`。
- **Acceptance Trace**：把当前 Change 的每条验收身份绑定到 Profile 中明确声明的 required 节点及其实际 Receipt；它不是第二套任务账本。
- **Gate Projection**：Runtime 提供给 Engine 的最小门禁事实，不包含日志或文件正文。

## 可信等级与新鲜度

`verified` 表示 Runtime 可以核对执行身份和输入；`observed` 表示反馈可用于开发诊断，但身份不足以满足正式门禁。`fresh` 来自当前采集，`reused` 只用于完全相同且仍在有效期内的确定性命令 Receipt，`superseded` 表示采集期间输入发生变化。

## Repository 输入边界

Evidence 不再把“Git 是否忽略”当成唯一输入边界。Project composition 中的
`RepositoryInputPolicy` Contributor 会把每个仓库的输入分成四类：

- **product**：Git HEAD、index、已跟踪改动，以及没有被策略认领的未知文件；进入正常产品 dirty fingerprint。
- **control-plane**：Host 为本次执行读取、但不属于交付物的已登记未跟踪文件；不污染产品 dirty 集合，但文件内容和策略摘要进入独立的 control-plane manifest。
- **runtime-state**：`.repoctopus/` 中的 Run、Journal、Receipt 与 Artifact；由对应 Store 管理，不作为被验证产品源码。
- **unknown**：没有 Contributor 明确认领的文件；默认按 product 处理，不能因为位于 `.codex/` 等目录就被静默排除。

内建策略当前登记 Codex Hook/rules、Agent Skill installation、Agent instructions 和
Skill lock。Git 已跟踪的 `AGENTS.md`、`.agents/skills/**` 与 `skills-lock.json` 是团队维护的
双用途产品输入；已跟踪的 `.codex/hooks.json` 或 `.codex/rules/**` 则是所有权冲突并
fail closed。未跟踪但已登记的 Host 文件即使被本机 `.gitignore` 隐藏，也会被显式枚举、
竞态安全散列并绑定到 Evidence。符号链接、目录联接、越界解析、超出文件数或大小上限的
控制面输入都会被拒绝。

每次 Evidence 采集都会同时冻结 policy digest 和逐仓 control-plane digest；任一策略、
内容、仓库 HEAD/tree 或普通 dirty 输入变化，都会改变 Verification Input，使旧 Receipt、
Verify 结果和 Archive 重验失效。不要通过移动 Host 目录、临时修改 ignore 或手工改
fingerprint 来恢复流程；应保留文件原位并重新采集 Evidence。

## 零测试

命令节点可以设置：

```yaml
zeroTests: warning # ignore | warning | blocking
```

Repoctopus 识别 npm 测试生态、Maven Surefire 和 Gradle 的常见结构化摘要。退出码为零但执行数为零时生成 `no-tests-detected`；`warning` 产生 `passed_with_warnings`，`blocking` 产生 `incomplete`。没有可识别摘要时不会猜测测试数。

## 统一反馈 DAG

用于 Change Verify 的节点必须用 `covers` 显式声明语义覆盖：

```yaml
- id: runtime-e2e
  type: command
  repository: workspace
  covers: ['task:2.1', 'requirement:dashboard#live-state']
  executable: npm
  args: [run, test:e2e]
```

selector 可以是精确 `acceptance-<sha256>`、`task:<taskId>`、`requirement:<ref>` 或显式共享策略 `*`。Runtime 在启动任何命令前，把 selector 解析进不可变 Verification Input；未知、未覆盖或只由 optional 节点覆盖的 Acceptance 会直接阻断。一个 Acceptance 若绑定多个 required 节点，所有节点都必须产生当前输入下 `verified`、`fresh | reused` 且 `passed` 的 Receipt，Trace 才会标记为 passed。

Profile 可以组合四类节点：

- `command` 运行构建、测试和静态检查；只有确定性命令可以按相同输入指纹复用 Receipt。
- `service` 的 `managed` 模式由 Runtime 启停，`attached` 模式只观察现有服务；Attached 只有 build identity 与当前输入指纹一致时才是 `verified`。
- `browser` 执行版本化 Journey。固定且版本匹配的 managed Chromium 是 `verified`，系统 Chrome 或 Edge 是 `observed`。
- `visual` 消费 Browser 节点的截图并产生结构化请求和响应。没有 Visual Adapter 时为 `incomplete`；权威资料冲突会产生 `requirements-conflict` Human Decision，Runtime 不自行选择依据。

视觉能力通过本机文件交换接入，不把模型 SDK、凭据或个人路径写进共享配置：

```yaml
# .repoctopus/local.yaml
apiVersion: repoctopus/v1alpha1
kind: RepoctopusLocal
visual:
  exchangeDirectory: .repoctopus/visual-exchange
  responseTimeoutMs: 600000
```

执行到视觉节点时，Runtime 原子写入 `requests/<request-id>.json` 并等待同名的 `responses/<request-id>.json`。IDE、Agent 或人工检查截图后写入版本化 `VisualInspectionResponse`；Runtime 再校验 request ID、截图摘要和 finding 证据引用。超时没有响应时节点保持 `incomplete`，不会把自然语言自述当作视觉证据。

独立节点在同一 DAG 层并行执行。上游失败只阻断依赖分支，业务断言失败不会在当前 Attempt 内静默重试。Managed 服务保持运行到依赖节点完成，随后无论成功、失败还是异常都在 `finally` 边界逆序清理。

## CLI

```powershell
node bin/repoctopus.js evidence plan --workspace . --profile verify --json
node bin/repoctopus.js evidence run --workspace . --profile verify --json
node bin/repoctopus.js evidence status --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence inspect --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence resume --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence clean --workspace . --max-age-days 30 --max-bytes 1073741824 --json
```

若 Evidence 用于推进现有工作流 Run，`evidence run` 必须增加 `--workflow-run <run-id>`。该 Run 必须正等待一个声明相同 Profile 的动作；Attempt 会绑定当前 Action、Step 和 `stateVersion`。状态代次变化后，即使项目文件未变化，旧 Attempt 也不能推进工作流。

Change Verify 还会把 Acceptance Set hash、Verification Input digest 和解析后的 coverage plan 写入 Evidence Run Context。独立执行同一 Profile 可以产生普通 Bundle，但 `acceptanceTrace` 为 `null`，不能拿来推进 Change 的 Verify→Archive 转换。checkbox 全部勾选也只表示 implementation completion claim，不会伪造 Trace。

`clean` 使用标记清扫：运行中 Attempt、Runtime Checkpoint 已接受 Bundle、Delivery 批准 Bundle、失败 Bundle 和配置要求保留的每个 Run/Profile 近期成功 Bundle 构成保护根。它不会根据单个文件年龄删除仍被这些事实引用的 Artifact；任何 Run 存在待恢复转换时，本次清理整体延后。
