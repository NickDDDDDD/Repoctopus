# Implementation Notes

## Deviations

实施期间如代码事实要求偏离 `design.md` 或 `tasks.md`，在此记录原计划、实际约束、采用方案和验证结果。未记录的偏离不得在评审时被视为已批准设计。

## Baseline

- 日期：2026-10-19（Asia/Shanghai）。
- 平台：Windows，Node.js `v24.21.0`，npm `11.19.0`，Git `2.56.0.windows.2`，OpenSpec `1.14.1`。
- `npm run verify`：通过；57 个测试文件通过，171 个测试通过，1 个跳过。
- `npm run test:package-e2e`：通过；1 个测试通过。
- `npm run test:tracer-e2e`：通过；1 个测试通过。
- 来源检查基线：20 个 Comet 派生文件和 60 个不可变 Cordis 文件通过验证。

## Stop Conditions

- OpenSpec、固定 DSH 源码、Matt Skill 行为、代码平台契约、设计图或现有公共协议存在实质冲突。
- DSH Skill 行为闭包无法在不引入第二个 Runtime 或 DSH Agent Loop 的情况下接入，且没有保持原语义的最小适配方案。
- 合入后机器动作无法限制在配置的 workspace 路径，或需要 merge、force push、rebase、删除分支或修改业务代码才能完成。
- 真实平台事实无法唯一映射 change、协调 MR 和业务 MR 集合。
- 实现需要把凭据、webhook 原始秘密、Skill 正文或个人学习内容写入日志、Git 或 OpenTelemetry。

## DSH 与 Matt Skills 来源闭包

- DSH 基线已升级为 `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`。直接采用 `@deepseek-ai/dsh-skill@0.2.1-rc.2`；精确依赖与 overrides 后的安装闭包为 13 个包，不包含 Agent、Session、Workspace 或 Webhook Runtime。上游已删除 `dsh-invariants`，当前闭包同步移除。
- DSH 内部依赖仍包含版本范围，当前 package、override 与 lock 检查把 8 个 DSH 包统一固定在同一 RC，拒绝 release train 混装。
- 文件 Provider 保留上游 Provider 契约、rank、按需加载、不完整发现、取消、失效与 Effect 撤销语义，移除 `ctx.fs`、DSH Home 和 DSH 沙箱耦合。来源与目标摘要登记在 `third_party/dsh-adoption.json`。
- Matt Skills 固定为 `49dd158d1076134a641b33efb035946536778336`。五个入口 Skill 之外，加入 `grill-with-docs` 明确调用的 `grilling` 和 `domain-modeling` 依赖；逐文件摘要登记在 `third_party/matt-skills/source-manifest.json`。
- 上游 `teach` 默认把学习文件写到命令执行目录；用户已经明确项目策略为 `.repoctopus/learning/<topic>/`。内置 Provider 在加载时追加 Repoctopus 状态策略，保持上游快照不可变并让实际内容摘要反映适配后的指令。

## Skill 纵切验证

- `skill list/get` 已通过 project composition 的生产入口运行，返回 `repoctopus.skill/v1alpha1` 协议和实际 Provider、调用策略、资源基底及正文摘要。
- 契约测试覆盖作用域覆盖、同层 rank、Provider 注册、未完成目录不缓存、显式失效、取消及 Fiber 撤销。
- Provider 测试证明项目 `.agents/skills/tdd` 可以替换内置 Matt `tdd`，且模型入口无法读取 `teach` 正文、用户显式入口可以读取。
- 来源测试会拒绝 Matt 文件篡改和 DSH lock 漂移；架构检查当前验证 140 个生产源码与 17 个唯一能力所有者。
- Codex 与 OpenCode 投影使用同一有效目录和正文摘要；受管文件摘要变化时拒绝覆盖，本地 `.agents/skills` 仍作为项目原生来源。
- 首次 `skill get --run` 把 Provider、调用策略、正文摘要和资源清单摘要写入 Run、Checkpoint 与 Trajectory。重复绑定幂等，已使用 Skill 漂移阻断恢复，未使用 Skill 变化不阻断 Run。
- 初始化与投影都会确保 workspace `.gitignore` 包含 `.repoctopus/`。临时 Git 仓测试证明 `.repoctopus/learning/<topic>/` 不进入 Git Evidence 选择；OTel 映射测试证明 Skill 正文、Provider 和个人学习路径不进入事件属性。
- `docs/skills.md` 记录 Provider 优先级、项目替换、Codex/OpenCode 投影、Run 绑定和 Teach 状态边界。打包 E2E 从 npm 产物执行 `skill list`、`skill get` 和 `skill project` 并读取生成的 OpenCode 文件。

## Specification 纵切验证

- `Specification` 是唯一 Cordis Service。Project composition 把它列为必需服务；零 Provider 产生缺少服务诊断，两个拥有 `specification-authority` 的 Provider 在组合编译时被拒绝。
- OpenSpec Provider 当前固定使用 `@fission-ai/openspec@1.14.3`，通过有超时、输出上限和 AbortSignal 的受控 Node 子进程调用官方 JSON 命令。领域结果不包含 OpenSpec 绝对路径或原始 CLI 输出。
- 临时 OpenSpec 项目测试覆盖 inspect、严格 validate、prepareClosure、官方 archive close 和重复 close；重复关闭从本地 Receipt 返回同一逻辑结果，不再次归档。
- Evidence 新增 `specification` 节点并直接调用活动 Provider。无效 delta 生成 `verified` 失败 Receipt，依赖实现节点保持 blocked，不能用调用方自述成功绕过。
- Run 首次严格校验后保存 Provider 身份与验证摘要，收尾计划生成后追加 closure plan 摘要；Run、Checkpoint 和 Trajectory 均保存事实，重复绑定幂等、摘要漂移被拒绝。
- 规格与设计 fixture 证明冲突请求没有默认选择，只暂停受影响步骤；用户响应必须同时携带已同步权威资料的摘要才能形成恢复事实。
- `docs/specification.md` 记录 Provider 契约、CLI、Evidence 配置、关闭协议和冲突边界。打包 E2E 使用安装后的生产包对本 change 执行 inspect 与严格 validate。

## Platform Events 实施中

- 已从固定 DSH GitHub Handler 采用 POST、JSON Content-Type、体积上限、唯一 Header、HMAC 后解析和无损 JSON 对象边界，来源与目标摘要登记在 `third_party/dsh-adoption.json`。
- 已定义 Provider 无关 Delivery Envelope 和纯 Event Inbox 状态机，覆盖稳定去重、Delivery ID 载荷碰撞拒绝、领取租约、租约过期恢复、重试等待、完成 Receipt 与死信状态。
- 持久 Inbox Store、Credential Provider、GitHub Adapter、HTTP Host/Route、PlatformEvents Service 和 Runner 已完成，见下方任务 4.1 至 4.4 验证记录；管理命令与 OTel 尚未完成。

## Delivery MR 集合状态（任务 5.1）

- `workspace MR` 更名为 `coordinationMergeRequest`。这是承载规格、验证与最终收尾的职责角色，不是旧 Agent Workspace 产品名，也不要求独立物理仓库；协调 MR 与业务 MR 可以拥有相同 `repositoryId`，但必须以各自平台 MR 编号和角色保持身份独立。
- Delivery Intent、Snapshot、Human Decision Request 与持久 State 升级到 v2。Intent 必须声明一个已有协调 MR 和完整业务仓集合；每个业务仓必须计划 `merge_request`，发布成功后把平台返回的 MR identity 写回对应业务记录。
- 平台事件匹配使用 `provider + remoteIdentity + number`，且只搜索 `publishing`、`partially_published`、`in_review` 状态中的业务 MR。协调 MR 和终态 Delivery 不参与匹配；零匹配与多匹配分别返回稳定诊断，不能猜测 change。
- `refreshForMergeRequest()` 只负责唯一解析，然后复用与显式 `delivery refresh` 完全相同的权威 MR 查询和状态转换。测试用两个独立 Store 证明事件入口与主动入口产生相同 Delivery State。
- builtin Delivery state schema 从 `1` 升为 `2`。proposal 已声明不兼容未发布的旧状态，因此文件 Store 对 v1 返回 `migration_required`，不做字段猜测或静默迁移；测试状态可清理后重新生成。

## PostMergeCoordinator 权威刷新（任务 5.2）

- `PostMergeCoordinator` 是只依赖 Delivery Service 的 Cordis Service；GitHub Contributor 只从已验签 Envelope 提取 `provider + remoteIdentity + number` 并注册 `pull_request` Processor。Contributor 不读取 webhook 的 `merged`、`state` 或 commit 字段作为事实，也不直接写 Delivery、Run 或 Store。
- `Delivery.refreshForMergeRequest()` 唯一映射活动业务 MR 后，复用主动 refresh 的同一事务刷新完整业务 MR 集合，并额外返回本次 `MergeRequestPort.status()` 权威观察。观察用于区分仍打开、关闭未合入和事实不完整，不扩展 Delivery State v2 Schema。
- 全部业务 MR 合入且都具备 merge commit 与合入时间后，Coordinator 返回 `changeId + mergeFactsDigest`。摘要绑定排序后的仓库、远端、目标分支、MR identity、merge commit 和合入时间，但排除 `observedAt` 与 webhook 到达顺序，因此重复和乱序事件得到同一个逻辑收尾身份。
- Delivery 进入 `merged` 后不再参与活动 MR 映射；后续重复或较旧事件返回 `delivery-event-no-match` 并完成为 no-op。关闭未合入返回 `post-merge-business-merge-request-closed`；部分合入保持 `in_review`，不启动收尾。
- builtin catalog 已登记 `post-merge-coordinator` Service Provider 与 `github-post-merge-events` Contributor。按任务边界，它们尚未加入常规 project composition；`postMerge` 配置 Schema、Runner 装配和启停恢复测试属于任务 6.1、6.2。
- 架构治理新增 `post-merge-automation` 领域能力所有者；共享远端 URL 规范化仍归 `project-model`。Coordinator Service 归组合层、GitHub Processor 归平台事件层，保持每个生产源码只有一个明确所有者。
- 全量并行验证连续暴露 Runner 的亚秒级真实时钟测试存在调度抖动：200ms 租约可能在续租 timer 获得调度前过期，100ms retry 也可能在同一 `runOnce()` 下一轮领取前已经到期。测试保持“处理时间超过初始租约”“drain 后等待租约过期”和“retry 从处理完成时间计算”的原不变量，只把租约裕量放大到 1s、retry 窗口放大到 10s；生产默认值和 Runner 实现未改变。

## 自举 Run 续接（2026-10-20）

- 通过生产 CLI 恢复既有 `self-enable-self-hosted-development`，没有创建重复 Run。`run resume` 确认 composition、Workflow、Skill 和 Specification Provider 兼容；`doctor` 返回 healthy，无待恢复事务。Run 保持 `execute`，待处理 Action 为 `6c1f8d7b2ceecfeb54fa97ff`。
- 通过 `skill get --name tdd --audience model --run self-enable-self-hosted-development` 加载实际 `matt-builtins` Skill；通过 `spec validate --change enable-self-hosted-development --run self-enable-self-hosted-development` 严格校验并核对绑定。
- 通过生产 Evidence 执行 `verify` 基线，Attempt 为 `a4ab2f2a-df49-45a0-9172-0c1e7e8db93e`。结果为 failed：尚未完成的 `file-event-inbox-store.ts` 存在 Schema 推导的 `string` 与领域 `sha256` 模板类型不兼容；architecture 节点被依赖阻断。失败 Receipt 和命令输出已保存在本地 Evidence Store。
- 此 Attempt 是实施阶段的独立诊断，未绑定 Workflow Action，也未推进 Run。完成实施后，应先记录实施动作，再在 `verify` 阶段使用 `evidence run --profile verify --workflow-run self-enable-self-hosted-development` 取得可用于门禁的 Evidence，不能复用独立诊断冒充门禁通过。
- 失败 Attempt 保留为诊断事实；后续没有复用它推进 Run。当前 `verify` Profile 仅覆盖类型检查与架构检查，不代表完整验收，完整测试与最终交付验收仍由任务 7.3 负责。

## 自举 Run 完成（2026-10-20）

- 生产 Evidence Attempt `7a3a8bae-1c0c-4945-92b4-81f33108a25c` 绑定 Run `self-enable-self-hosted-development`、验证 Action `2ceeada7acd3837e95011c2e` 和状态代次 10；`typecheck` 与 `architecture` Receipt 均为 `verified`、`fresh`、`passed`。
- Evidence Bundle `7b3d8e253512af71582b97f0b3c471d1628e801b1f01beb1d4d4c378ff1bb2db` 满足 Gate 后由 `run record` 接受。Run 进入 `completed`，状态代次 11，无待处理 Action；`doctor` 返回 healthy、无未完成事务且遥测积压为 0。
- Trajectory 共 12 个事件，包含生产 composition、实际 `tdd` 与 `code-review` Skill、OpenSpec Provider、实施 Action 和 Evidence Gate；未出现 fixture、mock、test-only 或直接篡改状态的旁路。因此任务 7.1 完成，任务 7.2 的独立进程 E2E 与任务 7.3 的最终完整验证仍保持未完成。

## Event Inbox 持久化（任务 4.1）

- `EventInboxStore.transaction()` 在每条 Delivery 的跨进程可恢复锁内读取最新状态、执行同步状态计算并写 Journal。调用方不得在回调中执行外部操作。文件实现复用现有 `RecoverableFileTransition`，已登记为 `shared-coordinator` 架构模型。
- 状态和累积 Receipt 使用同一个原子 JSON 快照，避免两文件之间的部分提交。Journal 保存前态和后态摘要：前态匹配时完成提交，后态已匹配时仅清理 Journal；截断、摘要损坏或前态冲突均拒绝继续并保留现场。
- Lease Token 拒绝被重新领取前的旧持有者提交；状态版本阻止旧快照覆盖新状态；到期的租约即使尚未被别人领取也不能提交。重试时间必须晚于结算时间。同一投递身份的事件类型或载荷变化均拒绝作为重复事件接受。
- 修复 Schema 校验结果与领域 SHA-256 模板类型不一致的问题，并规范化可选诊断字段。持久化校验要求终态和重试状态拥有匹配的 Receipt。
- 新增 13 个 Store/领域边界测试，使用真实临时目录覆盖重复收件、重开、并发领取、租约过期及旧令牌、重试/死信、两处提交故障注入、损坏 Journal、旧快照和回调异常。到期结算和缺失 Receipt 两个漏洞均先通过失败测试复现，再修复。
- 完整测试：64 个文件通过，208 个测试通过、1 个跳过。类型、lint、构建、生成物、品牌检查通过；架构检查首次发现模型登记遗漏，补充登记后通过；来源和严格规格检查通过。故障恢复使用抛异常模拟提交中断，本轮未新增独立进程强杀实验，完整 Runner E2E 仍属于任务 7.2。
- 测试临时目录由 `afterEach` 清理；保留自举 Run 与 Evidence 审计资料。当前文件 Store 尚未接入 HTTP/Runner，因此不代表平台事件入口已可部署。

## GitHub Webhook Adapter（任务 4.2）

- 新增 Provider 无关 `PlatformWebhookRequest` 与 `PlatformWebhookAdapter` 端口；GitHub Adapter 是唯一接受原始 webhook 请求并产生共享 Delivery Envelope 的公共实现。删除了接受裸 secret 的旧公共验证入口，调用方不能绕过 Credential Provider。
- `WebhookCredentialProvider` 是 Route 作用域的窄端口，与代码平台 API Token 的 `CredentialProvider.token()` 分离。`EnvironmentWebhookCredentialProvider` 每次请求读取配置的环境变量，保留秘密原值；缺失或 Provider 异常统一映射为不含底层原因的 503。
- 请求顺序固定为方法、Content-Type、体积和唯一 Header 检查，再读取秘密、验证原始字节 HMAC，最后执行 UTF-8 JSON 解析与对象快照。无效请求不会触碰 Credential Provider，签名失败时不会解析载荷。
- Provider 无关请求契约显式要求与 Node `headersDistinct` 等价的小写、多值不合并视图；任务 4.3 的 HTTP Host 必须在有界读取原始请求体时提供该视图，不能用逗号拼接后的普通 Header 映射替代。
- 对固定 DSH `handler.ts` 再核对确认其“无损 JSON”语义同样是 `JSON.parse` 后执行 `snapshotJsonValue`，不是保留数字词法或引入 BigInt。Repoctopus 保持现有 `JsonValue` 协议并用 detached clone 固定解析结果，没有发明与上游不同的载荷表示。
- TDD 先让 10 个 Adapter/Credential 用例失败，再实现最小端口与 Adapter。测试覆盖成功 Envelope、方法、Content-Type、体积、三个 Header 的缺失与重复、秘密不可用、错误脱敏、签名先于解析以及环境变量秘密原值。
- 双轴审查发现并修复 Provider-neutral 端口缺失、裸 secret 旁路、Header Host 契约不明确、测试死分支和重复失败调用。DSH 采用报告同步更新，目标摘要登记为 `571c83004837391b5a05e1493d59c5ab0e6ddde62d91ae1039e3a2200bf6cf41`。
- 完整验证：64 个测试文件通过，213 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、架构、来源和严格规格检查全部通过。本任务没有加入 HTTP Route、Inbox 写入或 202 响应，这些仍属于任务 4.3；未产生临时调试文件。

## HTTP Host 与原子接收（任务 4.3）

- HTTP 边界按三层拆分：`services/http-host.ts` 只保留产品级 Route 注册契约，`platform/http/node-http-server.ts` 负责 Node Listener、原始请求读取和有界关闭，`plugins/http/node-http-host-provider.ts` 负责 Cordis Service 生命周期。这样领域 Route 不依赖 Node API，具体监听机制也不会污染 Service 契约。
- Host 使用 Node `headersDistinct` 保留小写、多值且不合并的 Header 视图；先检查 `Content-Length`，再按 chunk 累计字节，超过 Route 上限立即返回 413，不创建无界聚合，也不会读取 Credential。Route 只做精确 pathname 匹配。
- `GitHubWebhookRoute` 在 Adapter 验证通过后调用 `EventInboxStore.transaction()`；只有原子事务完成才返回 202。持久化异常统一返回可重试 503，Journal 或 State 写入故障后的重投会由 Store 恢复为同一个 pending Delivery，不丢投递也不产生第二份状态。相同 Delivery ID 携带不同载荷是确定性冲突，使用领域 `EventInboxConflictError` 映射为 409，避免客户端无意义重试。
- Route 通过 Cordis Effect 注册和撤销。Host 关闭时先停止接纳，再在配置时限内排空活动请求；超时后销毁连接并记录 `OPERATION_DRAIN_TIMEOUT`。重试语义由 Route 显式声明：GitHub webhook 因 Delivery ID 去重声明 `client_retry`，通用 Host 不替未来 Route 假设幂等性。
- 内置 Catalog 已登记 `http-host` Provider 和 `github-webhook-route` Contributor，使生产组合编译和真实 Loopback 测试可发现它们；常规 project composition 尚未自动启用二者。任务 4.5 只启用文件 Inbox Provider 与管理命令，Runner、HTTP Host 和 webhook Route 的完整配置装配仍属于任务 6.1、6.2。
- TDD 依次暴露并修复缺失 Host/Route、超限请求错误映射、Contributor/Catalog 缺口和冲突误报 503。测试通过真实 TCP/HTTP 覆盖持久化后 202、413 前置拒绝、重复 Header、两处提交故障恢复、409 冲突、Effect 撤销、内置 Catalog 启动以及关闭超时诊断。
- 两轴代码审查确认规格路径完整，并推动三项架构修正：Node 机制从 Service 层下沉、Delivery 冲突类型化、关闭改为有界排空；复核无阻断项。完整验证：65 个测试文件通过，222 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、架构、来源和严格规格检查全部通过。未产生临时日志、调试输出或其他需清理的文件。

## PlatformEvents 与 Runner 领取循环（任务 4.4）

- `PlatformEvents` 成为平台事件唯一 Cordis Service 边界，统一持有 Processor 注册、持久接收、候选领取、Lease 续租、结算和查询；文件能力由 `FilePlatformEventsProvider` 提供。GitHub Route 不再直接构造或调用文件 Store，Provider/Contributor 依赖保持可替换。
- `PlatformEventRunner` 通过 Cordis Effect 持有轮询 Timer，通过 `OperationOwnership` 管理每次领取与处理。领取事务一旦写入 Lease 就标记持久边界；若卸载信号在 claim 返回前到达，Runner 不启动 Processor，保留 Lease 给后续实例在到期后恢复。已进入 Processor 的操作在卸载时排空到结算或可恢复失败点。
- Runner 在每次领取和结算时分别读取时钟，并在处理期间按 Lease 时长的三分之一执行 token-fenced 事务续租。续租失败会中止传给 Processor 的组合 Signal，且不会用失效 Lease 提交结果；完成处理后先等待在途续租结束再结算，避免续租与终态事务交错。排空超时后 `OperationOwnership` 会中止仍未结束的可取消操作，Heartbeat 同步停止，Lease 随后自然过期供新实例恢复；文件 Store 和领域状态机仍会拒绝过期 Lease 或旧 Token。
- Processor 返回值在 Service 边界执行运行时校验。只允许稳定、低基数的 kebab-case 诊断代码进入 Inbox；自由文本、异常消息、Token 或载荷片段会被替换为固定脱敏代码。异常本身统一形成 `platform-event-processing-failed`，不会持久化底层消息。
- 文件 Store 的首版候选扫描把并发文件读取限制为 16，并把单轮返回限制为 64 条，避免历史目录增长时形成无界文件句柄洪峰。当前逐条领取仍会重复扫描目录；claimable 索引或原子 `claimNext` 作为后续性能优化，不改变本任务的存储无关 Service 契约。
- 内置 Catalog 登记 `platform-events-file` 与 `platform-event-runner` 两个 Service Provider；GitHub Route 只保留 Contributor 身份，不再声明 Store authority 或文件权限。任务 4.5 随后在常规 project composition 中启用文件 Inbox Provider 和管理命令，以便 CLI 运维已有状态；Runner、HTTP/Route 配置与 `runner start` Application Plugin 仍属于任务 6.1、6.2 和部署入口，不由本任务冒充完成。
- TDD 覆盖 Service 重启持久化、Runner 完成、重试等待与指数退避、处理完成时刻计算、重复失败死信、异常与自由文本诊断脱敏、过期 Lease 恢复、真实 Timer、活动处理卸载排空、claim-in-flight 卸载竞态、慢处理跨初始 Lease 续租，以及挂死 Processor 在排空超时后停止续租并由替代 Runner 恢复。卸载竞态、自由文本诊断、无界扫描、慢处理 Lease 和 Heartbeat 超时生命周期均先由失败测试复现再修复。
- 双轴复审推动并确认五项收口：卸载后不再处理刚领取的 Delivery、领取与结算独立取时、Processor 诊断进入统一脱敏边界、长处理使用 Heartbeat 续租、排空超时后停止 Heartbeat 并释放恢复路径。规格与标准复审最终均无阻断或高优先级遗留；扫描索引明确记录为非阻断设计债。
- 完整验证：66 个测试文件通过，234 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、架构、来源和严格规格检查全部通过。测试临时目录由 `afterEach` 清理，未生成临时日志、调试输出或其他需清理文件；保留自举 Run 与 Evidence 审计资料。

## 平台事件管理命令与遥测（任务 4.5）

- 新增 `event replay/status/retry` 三个版本化 CLI 入口和 `platform-event-command` Contributor。`replay` 只接受摘要与身份可重算一致的 canonical `PlatformDeliveryEnvelope`，经 `PlatformEvents.accept()` 写入同一 Inbox；重复输入返回 `duplicate: true`，不旁路 Processor 或 Coordinator。`retry` 只允许 `dead_letter -> retry_wait`，追加 `manual-retry-requested` Receipt 且保留尝试次数，拒绝重跑 `completed`、活动 Lease 或已在等待的事件。
- `status` 通过 Store 的单次原子快照同时读取 Entry 与 Receipt 历史，避免 Runner 并发结算时拼出跨版本视图。输出只包含 Provider、Source、Delivery/Envelope ID、事件类型、payload 摘要、状态、时间、次数和稳定诊断；不返回 payload、Header、签名、Lease owner/token 或平台凭据。
- 平台事件遥测在 Inbox 事务提交后输出 accepted、deduplicated、claimed、retry、completed、dead-letter 和 manual-retry 关联事件。Log 属性使用显式允许列表；Metric 只使用事件类型、Provider、平台事件类型和状态等低基数字段，不使用 Delivery ID。OTLP 故障被隔离，不能回滚已持久化 Inbox 事实。
- 同一 Provider/Source/Delivery ID 即使较旧的 `receivedAt` 后到，仍保留原 Entry 并只被 Runner 处理一次。不同 Delivery ID 对同一 MR 的乱序唤醒仍需任务 5.2 的 PostMergeCoordinator 重新读取权威状态并按逻辑 Run 身份合并；本任务不把 webhook payload 当作排序或合入依据。
- 测试覆盖 canonical replay、防篡改、重复/较旧重放、单逻辑处理、死信人工重试、重复重试拒绝、遥测故障隔离、原子 status、允许列表映射、真实生产 CLI 和 OTLP logs/metrics 端点。所有 CLI/Telemetry 序列化断言均注入签名、Token、Header、Cookie、Lease token 和原始 payload 标记并确认不可见。
- 能力清单把 OTLP 所需 `network` 权限只授予 `platform-events-file`，管理命令保持零权限；差异复核纠正了误加到 Project Onboarding 的权限，维持最小权限边界。完整验证为 69 个测试文件通过，246 个测试通过、1 个跳过；Package E2E、Runtime Tracer E2E、166 个生产源码架构归属、来源检查和 9 项严格 OpenSpec 校验全部通过，生产依赖审计为 0 个漏洞。

## 平台事件运维与恢复文档（任务 4.6）

- 按 Diataxis 分离两个读者任务：`docs/platform-events.md` 解释 Host、Adapter、Inbox、Runner、Receipt、去重边界、安全边界和失败语义；`docs/platform-event-recovery.md` 提供可执行的跨进程恢复步骤。README 同时提供入口，避免形成孤立文档。文档明确指出 payload 会持久化在 `.repoctopus/events/`，必须按敏感数据保护；脱敏保证只适用于 CLI、Receipt、日志和 OTel 输出，不能被误读成“不落 payload”。
- 新增真实进程 fixture 和 `test:platform-event-recovery-e2e`。入口子进程从环境读取 GitHub secret，在 `127.0.0.1` 临时端口接收带 SHA-256 HMAC 的真实 HTTP 请求；收到持久化后 `202` 随即被强制终止。独立 CLI 进程仍读取到 `pending`，新入口重投相同 Delivery 返回同一 Envelope ID 与 `duplicate: true`，独立 Runner 进程最终形成一次 `completed` Receipt；输出扫描确认 secret、签名 Header、Lease Token 和 payload 标记均不可见。
- fixture 只组合已经登记的内置 Host、GitHub Route、文件 Inbox 与 Runner，并增加测试 Processor；它不是生产守护进程。正式平台事件配置和 Application Plugin 仍属于任务 6.1、6.2。首次测试还暴露出 fixture bundle 位于系统临时目录时无法解析仓库依赖；最终只在仓库测试目录创建临时 bundle、外置 npm 包，并在 `afterEach` 等待全部子进程退出后删除 workspace 与 bundle，避免 Windows 文件占用和调试残留。
- 完整验证为 70 个测试文件通过，247 个测试通过、1 个跳过；Package E2E、Runtime Tracer E2E、166 个生产源码架构归属、来源检查、9 项严格 OpenSpec 校验和变更文档本地链接检查全部通过，生产依赖审计为 0 个漏洞。演练结束后没有残留临时 fixture 目录；持久自举 Run 和 Evidence 继续作为审计资料保留。

## DSH / Comet 基线升级与全量审计（任务 1.5、1.6）

- 2026-10-21 先执行远端 ref 核对：Comet `master` 仍固定在已审计源码 `575ab0d172e8105257b3c9172b8c8a9b628960ca`，`0.4.5` 发布标签固定在 `c90af44a4474662d7853aae76ce785404974fb0a`；两者之间只有发布后的 README 提交。DSH `master` 与 `dsh-v0.2.1-rc.2` 共同指向 `687f282e8625c6b8d11ff58211a90524be2e4317`。
- DSH 依赖从 `0.1.7-alpha.1` 整列升级为 `0.2.1-rc.2`；Cordis/Loader 升为 `4.0.5/1.0.6`，Cosmokit/Schemastery 升为 `1.8.6/3.18.5`。`dsh-invariants` 已被上游删除，因此从 dependency、override 和 lock 中移除。
- Blob 对比确认 Skill Registry 和 GitHub Handler 行为没有变化；Handler 仅移到 `packages/experimental`。文件 Skill Provider 的上游新增 Windows watcher close 迟到错误修复，已移植到 Repoctopus；Loader 的 module namespace/HMR 修复随不可修改 npm 快照进入。
- `third_party/upstream-alignment-audit.md` 按 19 个治理能力和任务 4.5 至 7.x 计划面完成覆盖，补记了 Comet Experience Journal claim/renew 与 DSH Jobs/Session/Telemetry 的适用边界。相似代码只有在满足 Repoctopus 多仓、持久化和可恢复语义时才采用，不能因名称相似替换 authority。
- `third_party/upstream-baselines.json` 成为 DSH/Comet 固定 ref 的单一机器索引；`check:provenance` 交叉校验它与 DSH、Cordis、Comet 来源清单。`check:upstream` 使用 `git ls-remote` 每日发现分支漂移，GitHub Actions 只报警、不自动升级；标准 `verify` 不访问网络，继续可离线重放。
- 完整验证：67 个测试文件通过，238 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、19 个架构能力、来源和 9 个严格 OpenSpec 项全部通过。`check:upstream` 真实访问两个远端并确认 current；package E2E 与 tracer E2E 各 1 项通过。清理了审计用 DSH 临时 clone/worktree、npm tarball 和一次失败安装的精确 npm 日志，保留项目内来源与审计记录。
- 2026-10-21 的独立安全升级把 OpenSpec 精确固定到 `1.14.3`（tag commit `c794978f4f8845ce59693373c9dd882ee776588c`）。上游以 `tinyglobby`、`picomatch` 和 `brace-expansion` 替代 `fast-glob`，移除了 `micromatch -> braces` 漏洞链；没有使用 `npm audit fix --force`。Provider 身份改为从已安装包清单读取，依赖精确 pin 成为版本的单一事实源，旧 Run 仍会通过现有 Provider 漂移保护 fail-closed。升级后真实 inspect、严格 validate、prepareClosure/幂等 close、打包 CLI、tracer E2E 与完整 `verify` 全部通过（67 个测试文件、238 个测试通过、1 个跳过）；完整审计和 `--omit=dev` 审计均为 0 个已知漏洞，`repoctopus.specification/v1alpha1` 领域契约不变。

## Post-merge Workflow 与幂等 Run（任务 5.3）

- 新增 `workflows/post-merge.yaml`，按 `checkout -> evidence -> close-specification -> audit-paths -> publish` 固定五个收尾边界。每个边界都是既有 Runtime 的 `call_tool` Action，因此提案先形成稳定 Intent，完成后形成 Receipt，再由 Receipt 身份推进 Run；真实 Git、Evidence、Specification 和发布执行仍分别属于任务 5.4 至 5.6。
- Run 增加可选、向后兼容的 Trigger Snapshot。Post-merge Trigger 固化 `changeId`、`mergeFactsDigest` 和权威 `mergeEvidence`；Trajectory 只投影低基数 kind 与 digest，不复制完整平台事实。后续精确检出不需要信任 webhook，也不需要从不可逆 Run ID 猜回 change。
- `postMergeRunId()` 以版本化域、change 和合入事实摘要生成稳定 SHA-256 身份。`WorkflowRunCoordinator.startOrResume()` 仍让 RunStore 的可恢复锁决定唯一写入者；并发 loser 或重启实例在底层恢复 Journal 后读取既有 Run。只有工作流摘要、项目快照、工作流来源与 Trigger 全部一致才视为幂等重放，任一变化都抛出 `RunIdentityConflictError`，不会错误复用同名 Run。
- `PostMergeCoordinator.startRun()` 是 5.3 提供给 Runner 组合层的启动边界。它尚未被常规 project composition 自动启用，因为 Runner 的 `postMerge` 配置、工作区快照来源与 Application Plugin 装配属于任务 6.1、6.2；这一边界避免当前代码虚构尚不存在的临时检出配置。
- 测试以两个独立 FileRuntimeStore 实例并发启动同一事实，两个调用都得到同一 Run 且 Trajectory 只有一个 `run.started`；另在初始 Journal 落盘后注入进程中断，使用新实例恢复并确认仍只有一个逻辑 Run。完整工作流测试逐步推进五个 Action，核对每一步都有可加载的 Intent、Receipt 和 `action.completed` 事实；不同 Trigger 使用相同 Run ID 时 fail-closed。
- 完整验证：73 个测试文件通过，264 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、173 个生产源码与 20 个能力所有者、来源和严格 OpenSpec 检查全部通过。测试临时目录由 `afterEach` 清理，未产生临时日志或调试残留。

## 精确合入检出与 Evidence（任务 5.4）

- Post-merge Trigger 在原 `changeId + mergeFactsDigest + mergeEvidence` 基础上固化每个业务仓的 `remoteIdentity`、目标分支和精确 merge commit。运行时解析会核对仓库集合唯一性以及 repository/commit 与 merge evidence 一致性，损坏或漂移的 Trigger 无法进入检出。
- `GitPostMergeCheckout` 为每个 Run 在配置的临时根下创建带所有权 Marker 的隔离目录，从 Runner 已配置仓库读取并核对 origin 身份，再获取目标分支对象但始终 detached checkout 到 Trigger 中的精确 merge commit。目标分支随后前进不会改变验证输入；缺失 commit、远端身份不符、脏工作树和既有目录冲突均 fail-closed。
- 临时目录名由 Run 和仓库身份确定，Action 重放可复核并复用完全一致的检出。清理前再次核对目录不是符号链接、真实路径仍位于临时根、Marker 的 Run 与合入摘要未改变；无 Marker 的同名目录不会被复用或递归删除。整个 checkout-to-Evidence 区间另由可恢复文件锁串行化，避免两个 Runner 同时修改同一隔离工作树。
- EvidenceCoordinator 新增显式仓库路径覆盖，但配置、Artifact、Attempt、Bundle、Journal 和 Telemetry 仍使用原 Runner workspace 的唯一 Evidence Runtime。覆盖必须完整匹配项目仓库集合；初始指纹同时要求每个 HEAD 等于 merge commit 且工作树干净，结束指纹继续使用现有 Fence 捕获执行期间漂移。没有引入第二套 Evidence Service 或 Store。
- `PostMergeActions.verifyMergedCode()` 依次推进 checkout 与 evidence Intent：检出 Receipt 只记录 manifest digest，Evidence 使用确定性 Attempt identity 并绑定当前 Run/Action/状态代次。满足 Gate 才把 Bundle 接受到 Run 并进入规格关闭；required check 失败或输入被命令修改时记录失败 Receipt、停留在 evidence，不调用后续规格动作。成功、失败和 superseded 路径都会清理托管检出。
- builtin catalog 已登记 `post-merge-actions` Service Provider 及最小的 filesystem/network/process 权限，但按任务边界尚未加入常规 project composition；`postMerge` 临时根、Profile 和源仓配置以及 Runner 装配仍属于 6.1、6.2。
- bare remote 集成测试同时创建两个业务仓，先记录 merge commit、再把 `main` 推进到新提交；实际 Evidence 命令仍读取旧 merge 内容。另覆盖 required Gate 失败、执行中产生未跟踪文件导致 Attempt `superseded`、三种路径清理，以及无 Marker 目录保留。完整验证：74 个测试文件通过，268 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、176 个生产源码与 20 个能力所有者、来源及 9 项严格 OpenSpec 检查全部通过。

## 规格关闭与 workspace Guardrail（任务 5.5）

- `PostMergeActions` 现在按独立 Action 推进 `close-specification` 与 `audit-paths`。关闭前必须取得干净协调 workspace 的 HEAD/tree 基线、严格验证当前 change、生成关闭计划并把计划摘要绑定到 Run；任一步失败都记录失败 Receipt 并停留在当前步骤，不会进入发布。
- 关闭计划与基线在 `.repoctopus/post-merge/` 使用原子 Journal 持久化，并由 workspace 级可恢复锁串行化；builtin catalog 登记 `post-merge-closure: 1` 状态 Schema，架构治理也显式登记该恢复模型。这样进程若在 OpenSpec 已归档、Run Action Receipt 尚未保存时中断，重试仍能使用原计划读取 Provider 的幂等关闭 Receipt；不会尝试对已经移走的活动 change 重新生成计划。
- OpenSpec 计划从整个 `openspec/specs/` 收窄为受影响 capability 的主规格目录、当前活动 change 和 archive 根。Guardrail 会重算计划摘要、基线摘要和关闭身份，并要求 Provider `changedFiles` 只落在受影响主规格、当前 change 旧路径及返回的精确 archive ID 下；计划通配、绝对路径、路径穿越、重复或非规范路径均 fail-closed。
- `GitPostMergeWorkspace` 从 HEAD 同时读取 tracked rename/add/modify/delete 与未跟踪文件，核对 HEAD/tree 未变化，并把 rename 的源和目标都纳入差异集合。领域审计要求实际规格差异与 Provider 结果完全相等；额外文件只能位于明确的 verification 目录，且不得借 verification 配置覆盖业务源码根。
- 内容边界只接受普通文本的 Markdown、JSON、YAML；二进制、符号链接、目录/特殊文件和未知扩展均被拒绝。真实 OpenSpec 集成测试证明正常关闭只能从 `audit-paths` 进入 `publish`；归档后注入 `services/runtime.ts` 会产生失败 Receipt 并保持在审计步骤。纯领域反例另覆盖未知文件、宽泛 glob、二进制、符号链接、缺失差异和伪造关闭结果。
- 修正了 OpenSpec `1.14.3` JSON archive 回执解析：真实字段位于 `archive.archivedAs/path`，旧代码会退回合成 ID，无法与实际 archive 目录核对；失败诊断现在也会在 stderr 为空时保留结构化 stdout，便于安全排障。
- 5.5 的审计 Receipt 证明的是该时刻的差异快照；任务 5.6 的受保护发布动作仍必须在创建 commit 前重新扫描并核对同一审计身份，关闭审计到提交之间的 TOCTOU 窗口，不能把本次通过视作后续任意修改的授权。
- 完整验证：75 个测试文件通过，277 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、178 个生产源码与 20 个能力所有者、来源及 9 项严格 OpenSpec 检查全部通过。测试临时仓库由 `afterEach` 清理，未生成调试日志或其他临时残留。

## 受保护的收尾发布（任务 5.6）

- `PostMergeActions.publishCoordination()` 把发布策略、workspace 基线和路径审计固化为持久 Intent，并在远端副作用全部验证后才保存不可变 Receipt、推进 `publish` Action。第一次发布会在持久 Intent 前重新扫描 closure diff；重试若已有 Intent，则由 Git Adapter 对暂存区或既有提交逐路径、逐内容摘要复核，避免 audit-to-commit TOCTOU，也允许在 commit/push 响应丢失后继续恢复。Receipt 已落盘而 Run 记账响应丢失时，重放只复用 Receipt。
- Delivery 领域只从已合入的 Delivery State 读取原协调 MR，发布前后都要求 MR 仍开放、编号/URL/仓库身份以及源分支和目标分支未变化，并要求平台报告的 head 等于已核对的远端提交。收尾路径只调用该 MR 的 `update`；不调用 `find` 或 `create`，也不改变 base/head。若 update 已生效但响应丢失，重试通过权威 title/body 状态恢复同一 MR。
- `PostMergePublicationPolicy` 的操作集合必须精确等于 `commit + push + merge_request.update`。任何 merge、force-push、rebase、删分支或遗漏操作都会在 Git/平台副作用前 fail-closed；remote、提交消息、作者身份和 MR 内容也必须完整。普通 push 使用显式非强制 refspec，且远端在提交前必须等于审计基线、推送后必须精确等于新提交。
- `GitDeliveryAdapter` 只对审计列出的路径执行 `git add --all -- <exact paths>`，再核对 staged diff、每个文件内容摘要以及无剩余 unstaged/untracked 变化。新提交必须是基线的单父子提交；恢复时还会核对父提交、作者、消息、diff、内容和干净工作树，不会把任意本地提交当成收尾结果。协调 remote URL 与已记录的规范化 remote identity 不一致时同样拒绝。
- bare remote 测试覆盖正常 commit/push/原 MR 更新、Git 响应丢失后复用同一提交与远端 OID、MR update 响应丢失恢复、远端分支漂移、MR 已关闭，以及 merge/force-push/rebase/删分支意图拒绝；工作流测试另证明发布 Intent/Receipt 的落盘和完成后幂等重放。完整验证：76 个测试文件通过，286 个测试通过、1 个跳过；类型、lint、构建、生成物、品牌、179 个生产源码与 20 个能力所有者、来源及 9 项严格 OpenSpec 检查全部通过。测试临时 bare remote 由 `afterEach` 清理，未生成调试日志或其他临时残留。
