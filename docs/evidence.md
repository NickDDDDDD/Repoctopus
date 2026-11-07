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

- **product**：实际有效文件内容及没有被策略认领的未知文件；默认不把 HEAD、index 或 dirty 表示作为验证依赖。
- **control-plane**：Host 为本次执行读取、但不属于交付物的已登记未跟踪文件；不污染产品 dirty 集合，但文件内容和策略摘要进入独立的 control-plane manifest。
- **runtime-output**：`.repoctopus/` 中的 Run、Journal、Receipt 与 Artifact；由对应 Store 管理，不作为被验证产品源码。
- **unknown**：没有 Contributor 明确认领的文件；默认按 product 处理，不能因为位于 `.codex/` 等目录就被静默排除。

内建策略当前登记 Codex Hook/rules、Agent Skill installation、Agent instructions 和
Skill lock。Git 已跟踪的 `AGENTS.md`、`.agents/skills/**` 与 `skills-lock.json` 是团队维护的
双用途产品输入；已跟踪的 `.codex/hooks.json` 或 `.codex/rules/**` 则是所有权冲突并
fail closed。未跟踪但已登记的 Host 文件即使被本机 `.gitignore` 隐藏，也会被显式枚举、
竞态安全散列并绑定到 Evidence。符号链接、目录联接、越界解析、超出文件数或大小上限的
控制面输入都会被拒绝。

每次采集冻结 policy、逐仓 control-plane 和逐节点实际内容摘要。HEAD、暂存状态及提交同字节文件默认不改变验证身份；原始 Git 坐标仍单独保留，用于授权和审计。文件新增、删除、内容变化，以及配置、工具、Provider 或控制面变化仍会使相应证据失效。默认范围包括未知 ignored 文件，不能用 .gitignore 隐藏真实依赖；大仓应明确声明输入和产物，避免扫描 node_modules 等无关目录。读取存在竞态、越界链接或超过预算时明确失败，不截断为成功快照。

## 命令输入与选择性复用

command 节点可在 repoctopus.yaml 声明输入；其他节点不接受 inputs，也不复用命令缓存：

```yaml
- id: frontend-build
  type: command
  repository: frontend
  executable: npm
  args: [run, build]
  cache: true
  inputs:
    schemaVersion: 1
    repositories:
      - repository: frontend
        files: [src/**, package.json, package-lock.json]
        outputs: [dist/**]
    git: none
    taskCheckboxes: ignore
    env: [BUILD_CHANNEL]
```

repository 必须是已登记仓库。省略 repositories 时保守绑定全部仓库的有效文件；省略 files 时绑定所选仓库全部内容。路径相对仓库根，使用 /；支持字面路径、\*、?、整段 \*\*，不支持 shell 展开、否定、父目录或绝对路径。输入与自身输出不能交叠，两个 producer 不能认领重叠输出。

默认 git: none；依赖提交 SHA 或 index 的命令应选 all。默认 taskCheckboxes: ignore 只规范化当前 Change 的官方 Tasks 完成状态；Provider 语义与 Runtime 接受的完成事实必须匹配。其他 Markdown、任务正文、配置和规格内容仍绑定真实字节。需要读取复选框的命令选 include。env 只绑定明确列出的变量名及值摘要，不保存明文；可执行程序和 Node 的身份始终绑定。

只有 cache: true 且 passed、verified、未过 TTL 的确定性命令可复用。候选来自实际已提交 Receipt 及节点完成 Journal；只有 Receipt、没有 completion 的执行保持 unknown。新 Attempt 为复用生成新 Receipt，并用 sourceReceiptId 指向原证据，不覆盖历史或延长有效期。

每个节点单独绑定源输入；A 改变时只使 A 和依赖它的后继失效，独立 B 保留。producer 声明 outputs 后，产物不污染源输入。producer 完成时先保存内容寻址 manifest，再提交节点 completion；consumer 绑定真实产物字节和当前 producer Receipt。缓存 producer 仅在输出仍存在且匹配时复用；缺失时重新采集，Runtime 不从 Artifact Store 自动回写文件。重采 producer 得到同字节产物时，consumer 仍可复用并重新绑定证明引用。未知执行、失败、外部服务、浏览器和视觉反馈不按这条规则自动重放。

当前持久协议：Receipt/Attempt schema 1，Bundle/Gate schema 3，Verification Input schema 4，Plan Evidence/Build Check schema 2。各对象必须有 canonical EvidenceDependencyRecord，绑定实现内容、规划语义、执行控制及显式 Git 依赖；发布来源单独记录，不自动成为验证依赖。读取时核对记录、对象身份、上下游引用及 manifest，旧格式或损坏记录拒绝执行。

## Verify、恢复与 Archive

resume 和 next 在 Verify/Archive 共用恢复判定。先检查冻结 Binding、仓库路径、分支、remote、worktree 和 ownership，再检查规划批准，最后检查实际证据依赖。语义等价 commit 保留 Verification Input、Gate、Bundle 和完成事实；不能借内容等价授权切分支，也不能清除无关 blocker。Provider 无法读取时返回 reobserve；未知命令或发布结果保留原 Work、Attempt 和 Journal。

ArchiveDeliveryInput schema 3 单独冻结 publicationCheckpoint。提交同字节文件可能改变发布 OID：在 Closure/Publication 尚未启动时，重新 prepare 只更新发布坐标和对应 Work，允许合法 checkEpoch 变化，不重新 Verify。副作用已启动则按原 Journal 和冻结 OID 恢复。每个新 effect 前在 Run 事务锁内重验授权；新 Closure 还重验发布坐标和验证输入。Business push 使用冻结 OID，不能把后来的 HEAD 发布为已验证提交。

这采用 Comet 的内容快照、声明输入及 Archive preflight 原则；跨仓 DAG 的 producer/consumer manifest 是 Repoctopus 针对自身架构的实现。

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

Change Run 还会在 Design 的 Planning Snapshot 已形成、但尚未创建人工审批请求或
Build Work 时，用当前 Tasks 和该 Run 实际选择的 Verification Profile 执行同一套
coverage 解析。这个 preflight 只读取并编译配置：不会采集仓库 fingerprint、创建
Evidence Attempt 或运行节点。coverage 缺失、selector 无效或 preflight 期间规划语义
发生变化时，Run 保持在原 Design checkpoint，并且不会留下可批准请求。

恢复时应修改 Git 管理的 `repoctopus.yaml`，让 required 节点准确覆盖当前 Acceptance，
然后对同一 Run 再次执行 `run next`。Runtime 会重新读取 Tasks、Profile 和 Planning
Snapshot；不要手改 `.repoctopus/` Store、伪造审批或提前执行 Evidence。`*` 适合确实
验证全部 Acceptance 的端到端门禁；局部测试应使用更细的 Task、Requirement 或精确
Acceptance selector，避免把没有证明的范围声明为已覆盖。

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
