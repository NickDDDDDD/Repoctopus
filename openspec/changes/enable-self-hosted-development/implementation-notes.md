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
- 当前尚未完成持久 Inbox Store、Credential Provider、HTTP Host、Runner 与 OTel，因此任务 4.1 和 4.2 保持未完成。
