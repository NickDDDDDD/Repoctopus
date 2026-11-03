# Design

## Context

当前 `applyStoreBinding()` 先持久化 `register-store` Intent，再调用 `OpenSpecStoreRegistration.ensureRegistered()`。后者只做两件事：查询 `context --store <id>`，失败后调用 `store register <workspace>`。这遗漏了 OpenSpec 的前置条件：`register` 是把一个**已经健康**的根加入本机 registry，不负责创建 `openspec/`。因此新 Workspace 的用户批准是可信的，事务日志也存在，但平台适配器选择了错误的官方生命周期入口。

此外，现有测试中的 FakeProcess 把第二次调用直接返回成功，没有证明真实 CLI 接受该目录，也没有覆盖 Windows 路径、本机 registry 副作用或 `init` 成功而调用方未收到结果的恢复。项目文档又把“首次接入”等同于“register”，使错误边界被固化。

2026-11-03 核对固定 Comet 0.5.1：其 project activation 在发布配置前调用初始化领域服务；OpenSpec integration 使用官方 `openspec init`、固定参数、超时和前后 mutation guard；classic layout initialization 用 ownership journal、根身份/manifest checkpoint 和 continue/doctor/rollback 区分自己的半成品与用户目录。Repoctopus 采用其“先物化健康根、重新观察、配置最后发布”的原则，但事务还必须继续执行 Store registration 与多仓 pointer 安装。

## Goals / Non-Goals

**Goals:**

- 新的、非空的 Git Workspace 在没有 `openspec/` 时可一次批准完成初始化和 Store 登记。
- 人工批准精确冻结可执行的 Root/Store 变更，apply 不重新猜测更宽权限。
- 任意步骤中断后可从 Intent/Receipt 和当前真实状态幂等继续。
- 既有健康根、部分根、registry 冲突和并发漂移保持 fail closed。
- 真实 OpenSpec 1.14.3 CLI 测试证明 Windows 上的产品路径可用。

**Non-Goals:**

- 自动修复或删除接入前已有的不健康根。
- 复刻 Comet Classic 全部 doctor/quarantine UI。
- 把 OpenSpec registry 纳入 Git 或团队共享配置。

## Decisions

### 1. 候选冻结 Root disposition，而不是在 apply 阶段临时猜测

Store binding proposal 增加规范化 Root disposition 与 Evidence：

- `registered-exact`：registry 中的 `storeId` 已指向当前 Workspace 且 context 有效；
- `healthy-unregistered`：当前 Workspace 有健康 OpenSpec Root，但该 Runner 尚未登记；
- `missing-root`：精确的 `<workspace>/openspec` 不存在，可提议初始化；
- `partial-or-unhealthy`：`openspec` 已存在但官方 CLI 不承认其健康；
- `conflicting-registration`：相同 `storeId` 指向其他 checkout，或 metadata identity 与获批值不一致。

只有前三类可形成可批准方案；后两类是 blocker。候选摘要绑定绝对路径规范化后的 Workspace identity、`storeId`、OpenSpec Provider/version、Root disposition 和将执行的动作。apply 开始时重新观察；事实变化时使决定失效，不把新的写权限偷偷纳入旧批准。

`missing-root` 的批准只允许创建获批 Workspace 下的标准根，不允许清理、强制覆盖或迁移已有目录。

### 2. Root bootstrap 与 Store registration 是两个有序事实

扩展现有 Store binding journal，而不是建立第二套生命周期：

1. `prepare-root` Intent：声明 request、Workspace/Store identity、固定 Provider/version、初始 disposition 和允许的初始化 argv；
2. Root 已健康时写 `prepare-root` Receipt，结果为 `already-healthy`；
3. Root 缺失时调用固定安装包的 OpenSpec entry，执行 `init <workspace> --tools none --profile custom --language zh-CN --no-animation --no-copilot-cloud`；
4. 重新观察根健康与受事务拥有的 root manifest，写 `initialized` 或 `recovered` Receipt；
5. 执行/恢复 `register-store` Intent，随后用 `context --json --store <id>` 验证精确 id 和 checkout；
6. 按原有 Intent/Receipt 写业务仓 pointer；
7. 最后发布 `repoctopus.yaml`、gitignore 与完成状态。

所有命令通过 `SpecificationProcessPort` 的固定 argv 执行，不经过 shell，不使用 PATH 中漂移的 OpenSpec，也不手写 `openspec/config.yaml`。`store setup` 不适用：OpenSpec 1.14.3 会拒绝在已有内容但不健康的仓中执行它，并且它合并了 Repoctopus 需要分开审计的创建与登记责任。

### 3. 用持久 Intent、重新观察和受限 ownership 恢复未知结果

外部命令的退出结果可能在实际落盘后丢失。恢复不能把“没有 Receipt”解释为“什么也没发生”：

- 每次调用前先持久化不可变 Intent；
- 调用返回后不相信 stdout 自述完成，而是重新观察根/registry；
- 重启时先读取同 request 的 Intent，再检查当前根身份和 manifest；
- 根已健康且与本 Intent 的 Provider、Workspace 和 ownership checkpoint 一致时，写 `recovered` Receipt并继续 register；
- 根仍缺失时可重试同一固定 init；
- 根存在但无法证明属于当前初始化，或 manifest/对象身份发生并发漂移时停止，返回 doctor 诊断，不覆盖或删除。

ownership checkpoint 只覆盖本次初始化涉及的 `openspec/` 路径、规范化相对路径、文件类型与内容摘要，不扫描或声明整个 Workspace。它不得把用户在调用前已有的文件纳入可回滚集合。本切片不自动 rollback；明确失败保留安全诊断，人工 doctor 后再继续，避免把删除能力带入首次接入主路径。

### 4. 现有 `register-store` Intent 兼容恢复真实故障

已有失败现场已经持久化 `register-store` Intent但没有 Receipt。产品尚未正式发布，不建立版本迁移器；新实现读取同一 request 的现有 register Intent，若字段与当前获批 proposal 一致，就在它之前补做 Root preparation并继续。若 Intent identity 漂移则仍 fail closed。

这不是兼容旧行为的双实现，而是 Intent/Receipt 协议本来承诺的幂等 continuation：无 Receipt 的副作用必须靠真实状态判定。新代码不会保留“直接 register 缺失根”的分支。

### 5. 平台适配器返回结构化结果，领域层决定发布顺序

`OpenSpecStoreRegistrationPort` 不再隐藏 root preparation 的结果。它返回结构化 Evidence，包括 root status、registration status、Provider version 和规范化摘要；可恢复/阻断诊断使用有界 code，而不是让 onboarding 解析 CLI 文本。

领域合约负责 Intent/Receipt 的确定性 identity；OpenSpec 平台适配器负责精确 CLI、JSON 解析、路径比较和错误归类；onboarding 编排层只按获批计划排序，不了解 OpenSpec 私有目录结构。`repoctopus.yaml` 仍由项目配置模块最后发布。

### 6. 真实 CLI 集成测试与本机 registry 必须隔离

除端口级单元测试外，增加使用仓库固定 OpenSpec 1.14.3 entry 的 Windows 集成测试：

- 在临时的非空 Git Workspace 中从无根完成 `init → register → context`；
- 健康未登记根只 register，不重写根；
- 中断点分别位于 Intent 后、init 后和 register 后，重启恢复只产生一组 Receipt；
- 预先存在的部分 `openspec/`、Store id 指向其他 checkout、init 后文件漂移均阻断；
- 多仓 pointer 和 `repoctopus.yaml` 只在根与 registry验证后出现。

测试必须把 OpenSpec registry/home 重定向到临时目录，结束后清理临时根与 registry；不得读写开发者真实 registry。若 OpenSpec 1.14.3 不提供可隔离 registry 的公共环境变量，package E2E 应使用隔离进程用户目录并在测试前证明 context 不可见，不能退回 mock 作为验收。

## 模块边界

- `domains/project-configuration/detection.ts`: Root disposition、获批动作和候选摘要。
- `domains/project-configuration/store-binding.ts`: prepare/register/pointer Intent 与 Receipt 的不可变合约。
- `platform/specification`: 固定 OpenSpec process、Root检查/init/register/context 适配器和结构化诊断。
- `platform/project-configuration/onboarding.ts`: 配置最后发布的事务排序与 continuation。
- `test/e2e`: 官方 CLI、本机 registry 隔离、多仓顺序和中断恢复。
- `docs`: 用户可理解的初始化、配置与恢复说明。

## 验证

- 先用用户报告的 `store_register_root_unhealthy` 建立真实 CLI 红测，再实现。
- 对 Root disposition 与候选摘要做领域矩阵，证明批准后漂移失效。
- 对每个外部副作用点做中断恢复，证明无重复初始化、无重复 Receipt、无提前 pointer/config。
- 运行相关 Vitest、Windows package E2E、严格 OpenSpec、typecheck、lint、architecture/provenance/generated检查和完整 `npm run verify`。

## 风险与取舍

- **OpenSpec CLI 输出/参数变化：** 只调用固定 1.14.3 entry并把 version纳入 Evidence；升级 Provider必须经过上游对齐 Change。
- **真实 registry 测试污染机器：** 测试启动前强制隔离 home/registry并在清理时验证目标位于临时目录；无法证明隔离就跳过副作用并使 package验收失败，而不是操作真实 registry。
- **初始化后用户立即编辑文件：** ownership/manifest 漂移会停止自动恢复；这是保护用户内容所需的保守边界。
- **journal 增加复杂度：** 复用现有 request-scoped Intent/Receipt 与原子写入，不引入 lifecycle generation、后台协调器或独立 Store。

## 回退

本 Change 扩展本地 onboarding journal，但 `repoctopus.yaml` Schema 不变。完成事务无需迁移；未完成事务由同 request continuation恢复。回退到旧实现会再次无法接入缺失根，因此不支持对正在进行的初始化做代码回退；应完成或由 doctor 明确阻断。
