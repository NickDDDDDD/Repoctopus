# Plugin 与 lifecycle 扩展

Repoctopus 只使用 Cordis 作为应用 Runtime。Plugin 提供三种角色：唯一 Service Provider、一对多 Contributor，以及组合入口 Application Plugin。完整分层和启动路径见[插件内核架构](architecture.md)。

## Change lifecycle 的四类契约

| 契约                  | 职责                                                 | 能否推进 phase                            |
| --------------------- | ---------------------------------------------------- | ----------------------------------------- |
| Lifecycle Definition  | 声明版本化 phase、Work、transition 与开放 checkpoint | 只有内置 definition/transition owner 可以 |
| Work Contributor      | 为 definition 中的 Work kind 提供受限能力            | 不可以                                    |
| Validator Contributor | 对 Work 输出执行确定性校验                           | 不可以                                    |
| Lifecycle Extension   | 在已开放 checkpoint 增加声明式、安全的附加检查       | 不可以                                    |

Contributor 通过 `ctx.effect(() => registry.register(value))` 登记；所属 Fiber 卸载时自动撤销。Runtime 在开始/恢复 Run 时冻结 definition、Contributor、Validator 和 Extension identity，并比较兼容性。插件不得移动核心 transition、绕过 Design approval 或 Verify Gate、提前 Archive、扩大未声明写入范围，也不得自己写 RunStore。

## Composition 选择

- Bootstrap composition 只提供探测、接入和维护能力。
- Project composition 提供 Runtime、Specification、Skill、Evidence、Delivery、Archive Publication、Consistency Reconciliation 与公共 CLI。
- 所有公共命令都是短生命周期 composition；核心产品不注册 HTTP listener、Webhook、Inbox Runner 或 daemon。
- Desktop composition 是隔离的观测入口，消费 OTLP，不拥有 Change transition。

公共命令必须通过 `App Boot → CommandRouter → Service`。测试应运行相同 production composition 和 `bin/repoctopus.js`，不能直接构造一个绕过权限、Contributor 或 Store compatibility 的测试 Runtime 来证明文档命令有效。

## 权限与身份

静态 descriptor 声明 source、authority、permission 和 state schema。`codeDigest` 来自登记的真实源码；composition digest 绑定选择与非秘密配置。需要文件、进程、网络或 Credential 的副作用放在受保护 Adapter，核心 transition 保持纯函数。

增加或升级 lifecycle Contributor 时：

1. 使用稳定 `id + version + digest`，明确 `compatibleWith`。
2. 只声明 definition 开放的 Work/checkpoint 和最小写入范围。
3. 增加恶意 fixture，证明扩权和绕过门禁会 fail closed。
4. 更新 architecture governance、能力账本与上游采用记录。
5. 用已有 Run 验证兼容升级；语义漂移必须返回 `migration_required`。

不要建立通用 Capability Resolver、第二个依赖容器或第二套 workflow 状态机。OpenSpec 与 Matt Skills 分别通过 Specification Provider 和 Skill/Method Profile 接入，可以替换，但不能成为并行规格或任务权威。

## Composition adoption 边界

Runtime 只检查当前 checkpoint dependency closure 中实际使用的插件身份。未参与当前 Work 的 Contributor 更新不会撤销 Planning approval，也不会重建 Build Protocol。

受保护插件变更只有在 adoption catalog 精确声明一个旧 code/config/definition identity 到一个新 identity 的直接前驱、允许的 checkpoint 范围和不变合同后才能继续。Runtime 通过 CAS 记录一次 adoption fact；通配、多前驱、缺失材料和状态 schema 变化都返回 `migration_required`。已经 claim 的 Work 始终使用原不可变 packet，只有尚未 materialize 的 successor Work 使用新 composition。

Specification Provider 的实现摘要变化本身不撤销 Planning approval。Provider 观察到的规范化语义发生变化时，Specification Planning 才产生 semantic drift；二进制或状态兼容性由 composition authority 判断，Human Decision 不能替代技术兼容证明。
