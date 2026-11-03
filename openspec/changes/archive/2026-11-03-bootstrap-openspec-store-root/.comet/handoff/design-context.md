# Comet Design Handoff

- Change: bootstrap-openspec-store-root
- Phase: design
- Mode: compact
- Context hash: 0c9375b366cf2d3645ca95ccb35f55bc748e4f3451ed8804423d68d2e63e912e

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/bootstrap-openspec-store-root/proposal.md

- Source: openspec/changes/bootstrap-openspec-store-root/proposal.md
- Lines: 1-40
- SHA256: 03b16ee6d0fedbcb2f8a875498a0b50a4c4c48d99fcdcf0168454a0ab7102651

```md
# Proposal

## Why

真实公司项目首次接入暴露了一个确定性阻断：用户批准项目配置后，Repoctopus 直接执行 `openspec store register`，但 OpenSpec Store 只允许登记已经健康的 OpenSpec Root；全新 Workspace 尚无 `openspec/`，因此接入停在 `store_register_root_unhealthy`。当前单元测试把 `store register` 伪造为成功，未覆盖官方 OpenSpec CLI 的真实前置条件，所以同类问题也没有被多仓验收发现。

固定 Comet 0.5.1 已有成熟的初始化事务语义：先声明初始化所有权，调用官方 OpenSpec 初始化入口，重新验证根健康，再发布项目配置；外部进程结果未知时通过 checkpoint 重新观察，且不得盲删既有内容。Repoctopus 应采用这些不变量，同时保留自己的 Store registry、业务仓 pointer 与多仓 Workspace 权威模型。

## What Changes

- 在项目探测与人工确认中显式区分 `already-registered`、`healthy-unregistered`、`missing-root`、`partial-or-unhealthy` 和 `conflicting-registration`，让批准内容冻结本次允许执行的 Root/Store 变更。
- 对获批的 `missing-root` 使用固定 OpenSpec 1.14.3 官方 CLI 创建最小健康根，再登记 Store；不得用只适合新空目录的 `store setup`，也不得手工拼装 OpenSpec 私有文件。
- 把 Root bootstrap、Store registration、业务仓 pointer 和共享 `repoctopus.yaml` 按 Intent/Receipt 顺序发布；共享配置始终最后写入。
- 为外部命令超时、崩溃、未知结果和中途重启增加重新观察与幂等 continuation；只恢复本事务明确拥有且身份未漂移的初始化，不覆盖既有或并发写入的 `openspec/`。
- 让真实 OpenSpec CLI 的 Windows 集成测试覆盖全新非空 Git 仓、健康未登记根、部分根、登记冲突和中断恢复，替代仅凭 FakeProcess 成功的错误信心。
- 更新项目接入与规格权威文档，说明首次接入的 Root bootstrap、Store 地址本机性和故障恢复边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 获批项目接入必须以可恢复、配置最后发布的事务创建缺失的 OpenSpec Root并安装多仓绑定。
- `specification-authority`: Workspace Store 登记必须先证明 Specification Root 健康，并安全处理缺失、部分和冲突根状态。

## Impact

- 主要影响项目探测/候选、`domains/project-configuration` 的 Store binding 合约、`platform/project-configuration/onboarding.ts`、`platform/specification/openspec-store-registration.ts`、真实 CLI 集成测试和接入文档。
- 不引入 Comet SDK、Comet 状态文件、后台 daemon、第二个规格仓、第五类 OpenSpec 工件或 OpenSpec 内部模板副本。
- 行为参考固定 `@rpamis/comet@0.5.1` 的 project activation、OpenSpec integration 和 classic initialization checkpoint；实现使用 Repoctopus 原有领域类型、进程端口与 onboarding journal，不复制上游源码，因此不新增许可证义务。

## 非目标

- 自动修复接入前已经存在的残缺或不健康 `openspec/`；它必须以可操作诊断阻断并由用户显式处理。
- 自动迁移已有本地规格根、合并两个规格权威或覆盖指向其他 checkout 的 Store registry。
- 为 OpenSpec 之外的 Specification Provider 建立通用安装器。
- 改变 OpenSpec Store 的字段名、registry 位置或团队 Dashboard 配置。

```

## openspec/changes/bootstrap-openspec-store-root/design.md

- Source: openspec/changes/bootstrap-openspec-store-root/design.md
- Lines: 1-119
- SHA256: 36457f05e8a9981ca89494ebeff62cadd2656b5cb465f8d0c5dc52f640372c1d

[TRUNCATED]

```md
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

Store binding proposal 增加规范化 Root disposition 与 Evidence。适配器以精确 `<workspace>/openspec` 的文件状态为第一层边界，并在该 Workspace cwd 调用官方结构化 `doctor --json`/`context --json`；任何返回的 Root path 都必须规范化后精确等于 Workspace，父目录中的 nearest root 不能冒充当前根：

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

```

Full source: openspec/changes/bootstrap-openspec-store-root/design.md

## openspec/changes/bootstrap-openspec-store-root/tasks.md

- Source: openspec/changes/bootstrap-openspec-store-root/tasks.md
- Lines: 1-83
- SHA256: 50138c892dbe6747c82958361ae296fc11b52f945e0b25e27006eeb63434b360

[TRUNCATED]

```md
# Tasks

## 1. 固定真实故障与获批 Root 计划

- [ ] 1.1 用固定 OpenSpec 1.14.3 CLI 在临时非空 Git Workspace 重现 `store_register_root_unhealthy`，建立“无 `openspec/` 时 register 失败”的红测。 <!-- comet-task:a16a9ada-5fac-4865-a293-2acca31d93c2 -->
      **Acceptance:** 测试调用真实安装包 entry而非 FakeProcess，断言错误码/结构化诊断对应缺失健康根，并证明未写业务仓 pointer或 `repoctopus.yaml`。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 1.2 在项目探测领域建模 `registered-exact | healthy-unregistered | missing-root | partial-or-unhealthy | conflicting-registration`，把 Provider/version、Workspace/Store identity和允许动作纳入候选摘要。 <!-- comet-task:71440e4c-282c-4f42-86f0-fdf502cfd526 -->
      **Blocked by:** 1.1
      **Acceptance:** 领域矩阵覆盖五种 disposition、Windows等价路径和 identity冲突；相同语义产生稳定摘要，任一授权事实变化产生不同摘要或 blocker。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 1.3 让 Human Decision展示 Root bootstrap与Store/pointer写入计划，并在 apply 前重新观察批准事实。 <!-- comet-task:cc26b368-0cd5-47db-89cb-6a73e0742ac1 -->
      **Blocked by:** 1.2
      **Acceptance:** 测试证明用户能看到将创建的 Root及Store id；批准后目录、Provider、Store或Workspace identity漂移会使决定失效且没有副作用。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根

## 2. 建立可恢复的 Root bootstrap

- [ ] 2.1 扩展 Store binding领域合约，加入不可变 `prepare-root` Intent/Receipt、固定初始化argv、初始disposition与有界结果码。 <!-- comet-task:ff63347b-0e34-4ec3-9ce3-3def97bada2c -->
      **Blocked by:** 1.2
      **Acceptance:** 合约测试覆盖digest稳定性、不同request/Workspace/Provider/argv的identity隔离，以及篡改Intent、重复Receipt和跨request恢复拒绝。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 2.2 在OpenSpec平台适配器中实现根观察与官方初始化，使用固定安装包entry和无shell精确argv，不手写Provider私有文件。 <!-- comet-task:da04cbde-6ed9-4d20-88ea-3eddddb2719b -->
      **Blocked by:** 2.1
      **Acceptance:** 端口测试断言精确执行 `init <workspace> --tools none --profile custom --language zh-CN --no-animation --no-copilot-cloud`；abort、timeout、非零退出、无效输出和路径越界均返回结构化诊断。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 2.3 为Root初始化持久化受限ownership/manifest checkpoint，并通过重新观察恢复“已落盘但结果未知”。 <!-- comet-task:6d4d51e8-d67b-488e-95d6-6de141a78f1f -->
      **Blocked by:** 2.2
      **Acceptance:** 中断测试覆盖Intent后、init执行中、init落盘后和Receipt前；重启只恢复同request拥有且identity/manifest未漂移的根，既有或并发文件一律阻断且不删除。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 2.4 让健康既有根走 `already-healthy` 路径，让部分/不健康既有根fail closed且返回doctor诊断。 <!-- comet-task:18a2b717-dcba-4b9d-a179-b325d11efe93 -->
      **Blocked by:** 2.2
      **Acceptance:** 测试证明健康根没有内容改写，部分根不调用`init --force`、不清理目录、不写Root Receipt或后续配置。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上

## 3. 串联Store、多仓pointer与配置最后发布

- [ ] 3.1 重构OpenSpec Store registration为“健康证明后register、显式context复验”的结构化适配器，区分已登记、刚登记、冲突与结果未知。 <!-- comet-task:552117de-8eda-415f-9239-35e2c2674bb0 -->
      **Blocked by:** 2.2
      **Acceptance:** 单元测试覆盖精确registration、健康未登记、同id异checkout、metadata不一致、register已成功但结果丢失和无效JSON；不得回退default/nearest root。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 3.2 在onboarding事务中按 `prepare-root → register-store → pointers → repoctopus.yaml` 排序并复用现有request-scoped Intent/Receipt。 <!-- comet-task:154bec2d-4910-460d-a597-1dafd881f38b -->
      **Blocked by:** 2.3, 2.4, 3.1
      **Acceptance:** 故障注入覆盖每个步骤；任何前置失败都没有后续副作用，重试只补缺失Receipt，同一动作不会重复写入。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 3.3 恢复现场已有“register Intent存在但Receipt缺失”的同request事务，不保留直接登记缺失根的旧分支。 <!-- comet-task:0e188f2c-9af8-4a9f-abb0-e064b1433d44 -->
      **Blocked by:** 3.2
      **Acceptance:** 以用户报告现场形状建立测试：新代码补做Root preparation、完成原register Intent并发布一次配置；Intent identity漂移时仍阻断。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 3.4 保持业务仓本地Root与pointer冲突检查，证明Workspace bootstrap不会扩大到覆盖业务仓。 <!-- comet-task:204abef3-ad6a-41c7-8d46-3db397a3c2b4 -->
      **Blocked by:** 3.2
      **Acceptance:** 多仓测试含一个可安装pointer仓和一个已有本地Root仓；冲突仓使事务在任何pointer/config发布前停止，既有文件逐字节不变。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上

## 4. 真实CLI、多仓验收与文档

- [ ] 4.1 通过临时`XDG_DATA_HOME`/`XDG_CONFIG_HOME`建立隔离OpenSpec registry/config的真实CLI集成夹具，并验证它绝不读取或写入开发者registry。 <!-- comet-task:93f7ef4f-a3e2-4396-825c-139852e661bf -->
      **Blocked by:** 3.1
      **Acceptance:** Windows与CI测试启动前后都证明`stores/registry.yaml`与全局配置位于受控临时目录，真实用户registry内容和时间戳不变；失败清理只删除已验证的临时路径，无法证明隔离时验收失败而非退回mock。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.2 用真实CLI完成全新非空Workspace、健康未登记Root、中断恢复、部分Root和Store冲突的端到端矩阵。 <!-- comet-task:96214594-b3ad-4599-825e-15d211570573 -->
      **Blocked by:** 3.3, 3.4, 4.1
      **Acceptance:** 成功路径的显式`context --store`精确指向临时Workspace且四类OpenSpec规划目录可用；失败路径无pointer/config提前发布、无真实registry污染。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.3 更新项目接入、Specification Authority与故障排查文档，解释Root创建、Store本机登记、多仓pointer及安全恢复顺序。 <!-- comet-task:d049e637-13e1-4612-8b19-06c5c44dae7e -->
      **Blocked by:** 4.2
      **Acceptance:** 文档不再声称首次接入只执行register；给出公司新仓场景、可操作诊断和重试入口，明确禁止手工改Runtime Store或盲删`openspec/`。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.4 核对Comet 0.5.1采用边界与第三方来源记录，确保只采用事务不变量而未复制源码。 <!-- comet-task:30c48b2f-61cf-4812-ba36-cfb4e528ddca -->
      **Blocked by:** 4.2
      **Acceptance:** provenance检查通过；采用报告记录参考模块、固定版本、采用/拒绝内容与许可证结论，不把Comet状态文件或单仓假设带入产品。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根

## 5. 交付验证

- [ ] 5.1 在隔离的模拟多仓项目中通过正式CLI完成一次首次初始化，随后创建并严格校验一个最小Change，证明Store pointer与Specification Provider可实际消费。 <!-- comet-task:0b0685d1-d0bb-4297-92c0-dde871e70977 -->
      **Blocked by:** 4.2, 4.3, 4.4
      **Acceptance:** 全程不使用Repoctopus自举Runtime、不手工编辑journal；第二进程冷启动仍解析同一Store，模拟业务仓没有复制规格权威。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 5.2 运行相关Vitest、真实CLI/package E2E、typecheck、lint、architecture/provenance/generated、严格OpenSpec和完整`npm run verify`，形成正式验证报告并清理临时产物。 <!-- comet-task:ecd214c7-ca00-436b-8778-24f863f76371 -->

```

Full source: openspec/changes/bootstrap-openspec-store-root/tasks.md

## openspec/changes/bootstrap-openspec-store-root/.openspec.yaml

- Source: openspec/changes/bootstrap-openspec-store-root/.openspec.yaml
- Lines: 1-2
- SHA256: b6d27c089c6ee9596ce0433bd8f7f771b477758efe1ce7f7a7505af47316ecd0

```md
schema: spec-driven
created: 2026-11-03

```

## openspec/changes/bootstrap-openspec-store-root/specs/project-configuration/spec.md

- Source: openspec/changes/bootstrap-openspec-store-root/specs/project-configuration/spec.md
- Lines: 1-30
- SHA256: c9e3eebdb561da16640534846fe051138c52f08e140437887214e0ef54d2f332

```md
## ADDED Requirements

### Requirement: 获批项目接入以可恢复事务物化规格根

Repoctopus MUST 在项目配置候选中区分精确已登记、健康未登记、缺失、不健康和登记冲突的 Workspace Specification Root，并把 Root disposition、Provider identity、Store identity 与允许执行的动作绑定到 Human Decision；获批 apply MUST 先以持久 Intent 和重新观察创建或验证健康根，再登记 Store、安装业务仓 pointer，最后发布共享项目配置。apply 不得扩大批准权限、手工拼装 Provider 私有文件、覆盖既有根或在根与登记未验证时提前发布 `repoctopus.yaml`。

#### Scenario: 全新非空 Workspace 获批接入

- **WHEN** 获批候选证明 Workspace 中不存在 `openspec/`，但仓库包含其他项目文件
- **THEN** Repoctopus 通过固定 OpenSpec Provider 的官方初始化入口物化最小健康根，重新验证后登记 Store，并只在两者成功后安装 pointer 与共享配置

#### Scenario: apply 前 Root disposition 发生变化

- **WHEN** 用户批准缺失根方案后，`openspec/` 被其他进程创建或 Store identity 发生变化
- **THEN** Repoctopus 使旧决定失效并返回可定位 reconcile 诊断，不把新目录当成本事务所有、不强制初始化且不发布共享配置

#### Scenario: 初始化结果未知后重启

- **WHEN** Root 初始化已经落盘但进程结果或 Receipt 尚未持久化
- **THEN** Repoctopus 从同一 request 的 Intent重新观察根身份和受限 manifest，只在可证明属于该初始化且健康时写恢复 Receipt并继续，既不重复创建也不删除用户文件

#### Scenario: 已有根不健康

- **WHEN** Workspace 已存在 `openspec/`，但固定 Provider不能证明它是健康根
- **THEN** Repoctopus 在人工确认前将其标记为 blocker，并在 apply 时继续 fail closed，不自动修复、覆盖或改用另一个规格根

#### Scenario: 中途失败保持配置最后发布

- **WHEN** Root bootstrap、Store registration或任一业务仓 pointer安装失败
- **THEN** Repoctopus 保留可恢复的 Intent/Receipt 和结构化诊断，且不存在声称接入完成的 `repoctopus.yaml` 更新

```

## openspec/changes/bootstrap-openspec-store-root/specs/specification-authority/spec.md

- Source: openspec/changes/bootstrap-openspec-store-root/specs/specification-authority/spec.md
- Lines: 1-30
- SHA256: 40ce9b9dbb11bebda725412d93729adc798fb93ae2ed44c9071e3072eb01ef15

```md
## ADDED Requirements

### Requirement: Workspace Store 登记必须建立在健康规格根之上

Repoctopus MUST 把 Specification Root materialization 与 OpenSpec Store registration 建模为两个有序事实：缺失根只能由固定 Provider的官方初始化入口创建，健康根才能登记，登记后必须用显式 `storeId` 重新验证 registry、Store metadata 与 Workspace checkout。`store register` 失败不得被解释为初始化请求；default Store、nearest root、业务仓本地根或 CLI 成功文本不得替代结构化健康与身份 Evidence。

#### Scenario: 缺失根先初始化再登记

- **WHEN** 获批 Workspace 的精确 `openspec/` 路径不存在且 registry没有冲突
- **THEN** Repoctopus 先持久化初始化 Intent，调用固定 Provider 创建根并重新验证健康，再执行 Store registration

#### Scenario: 健康根尚未登记

- **WHEN** Workspace 已有固定 Provider认可的健康根，但当前 Runner的 registry没有该 `storeId`
- **THEN** Repoctopus 保留根内容不变，只登记 Store并通过显式 context验证其指向当前 checkout

#### Scenario: Store id 指向另一个 checkout

- **WHEN** 当前 Runner registry中的相同 `storeId` 指向不同 Workspace checkout
- **THEN** Repoctopus 返回 authority conflict并阻塞接入，不覆盖登记、不选择默认 Store且不安装业务仓 pointer

#### Scenario: 官方初始化命令结果未知

- **WHEN** 固定 Provider进程超时、崩溃或调用方未收到确定退出结果
- **THEN** Repoctopus 保留原 Intent并重新观察根与 ownership checkpoint；只有可证明成功的状态才能继续登记，未知或漂移状态停止等待修复

#### Scenario: 业务仓已有本地根

- **WHEN** Workspace Root 已健康并登记，但业务仓存在会遮蔽 Store pointer的本地规格根
- **THEN** Repoctopus 仍按 authority conflict阻断该仓，不因 Workspace初始化成功而覆盖或合并本地根

```
