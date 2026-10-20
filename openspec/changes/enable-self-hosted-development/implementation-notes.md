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
- 真实平台事实无法唯一映射 change、workspace MR 和业务 MR 集合。
- 实现需要把凭据、webhook 原始秘密、Skill 正文或个人学习内容写入日志、Git 或 OpenTelemetry。

## DSH 与 Matt Skills 来源闭包

- DSH 基线固定为 `d0dca04e22f09fe04967090b2ee70587ecdad6cc`。直接采用 `@deepseek-ai/dsh-skill@0.1.7-alpha.1`；精确依赖与 overrides 后的安装闭包为 14 个包，不包含 Agent、Session、Workspace 或 Webhook Runtime。
- 普通 npm peer 解析会把 `^0.1.7-alpha.1` 漂移到较新的 RC，并连带安装 50 个 DSH 包；当前 package 与 lock 检查明确拒绝该结果。
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
- OpenSpec Provider 固定使用 `@fission-ai/openspec@1.14.1`，通过有超时、输出上限和 AbortSignal 的受控 Node 子进程调用官方 JSON 命令。领域结果不包含 OpenSpec 绝对路径或原始 CLI 输出。
- 临时 OpenSpec 项目测试覆盖 inspect、严格 validate、prepareClosure、官方 archive close 和重复 close；重复关闭从本地 Receipt 返回同一逻辑结果，不再次归档。
- Evidence 新增 `specification` 节点并直接调用活动 Provider。无效 delta 生成 `verified` 失败 Receipt，依赖实现节点保持 blocked，不能用调用方自述成功绕过。
- Run 首次严格校验后保存 Provider 身份与验证摘要，收尾计划生成后追加 closure plan 摘要；Run、Checkpoint 和 Trajectory 均保存事实，重复绑定幂等、摘要漂移被拒绝。
- 规格与设计 fixture 证明冲突请求没有默认选择，只暂停受影响步骤；用户响应必须同时携带已同步权威资料的摘要才能形成恢复事实。
- `docs/specification.md` 记录 Provider 契约、CLI、Evidence 配置、关闭协议和冲突边界。打包 E2E 使用安装后的生产包对本 change 执行 inspect 与严格 validate。

## Platform Events 实施中

- 已从固定 DSH GitHub Handler 采用 POST、JSON Content-Type、体积上限、唯一 Header、HMAC 后解析和无损 JSON 对象边界，来源与目标摘要登记在 `third_party/dsh-adoption.json`。
- 已定义 Provider 无关 Delivery Envelope 和纯 Event Inbox 状态机，覆盖稳定去重、Delivery ID 载荷碰撞拒绝、领取租约、租约过期恢复、重试等待、完成 Receipt 与死信状态。
- 持久 Inbox Store 已完成，见下方任务 4.1 验证记录；Credential Provider、HTTP Host、Runner 与 OTel 尚未完成，任务 4.2 保持未完成。

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
