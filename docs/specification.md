# Specification Provider

Repoctopus 通过唯一的 Cordis `specification` Service 读取、校验和关闭规格变更。Workflow 使用稳定领域契约，不读取 `openspec/` 路径，也不解析 OpenSpec CLI 输出。当前内置 Provider 使用 OpenSpec `1.14.3`。

## Workspace、Store 与实现仓

- **Workspace Repository** 是 Repoctopus 的团队入口，保存 `repoctopus.yaml`、四类 change 产物、工作流文档和最终 Change MR。单仓项目可以把它嵌入实现仓；多仓项目通常把它作为与实现仓同级的独立仓库。
- **OpenSpec Store** 是 Workspace 中规格树的逻辑身份，不要求再建立第二个 Git 仓。`store: team-platform` 这类 ID 由团队自定义，但必须是 lowercase kebab-case。
- **实现仓** 保存产品代码并产生 Business MR。它们的 `openspec/config.yaml` 只是可选 pointer，方便人在该目录直接运行 OpenSpec；Repoctopus Runtime 始终使用 Workspace 配置中的显式 Store identity，不依赖 pointer 猜测权威根。

Store registration 是每台机器的本地登记，不随 Git clone 同步。首次接入由 `project review` 通过 `openspec store register` 幂等登记当前 Workspace checkout；每位团队成员、CI 节点和开发机都要各自登记，并用下面的只读命令核对路径：

```powershell
npx openspec context --store <store-id> --json
npx openspec store doctor <store-id> --json
```

废弃某台机器上的 checkout 时，先停止使用该 Workspace 的 CLI 和 Desktop Host，确认 `context` 指向准备注销的精确目录，再执行 `npx openspec store unregister <store-id> --json`。`unregister` 只忘记本机登记，不删除文件；不要使用会删除 Store 目录的 `store remove`。业务仓 pointer 是普通受版本控制文件，需要通过 change 删除或调整，注销登记不会代替 Git 变更。

## 规划产物与决策记录

OpenSpec 的 spec-driven schema 使用 Proposal、Delta Specs、Design 和 Tasks 四类规划产物。Repoctopus 只读取 Provider 状态明确声明的产物，不根据目录中出现的其他 Markdown 文件推断第五类产物。

普通设计决定、实施约束和偏差写入当前 change 的 `design.md`，测试结果进入 Evidence 和正式验证报告。需要长期约束多个组件、难以回退或影响公共契约、持久数据、安全及团队边界的架构变更，应为该工作单独建立一个普通 change；这不是特殊的 change 类型。该 change 的 Design 记录背景、备选方案、取舍、迁移与回退方式，并通过正常评审确认。纯内部架构调整没有改变可观察行为时，OpenSpec change 使用 `skip_specs: true`，不虚构 delta spec；行为契约改变时才同时更新 delta specs。归档后的 change 保留决策历史，`docs/architecture.md` 只描述当前架构，不再维护独立 ADR 或实施日志权威。

## 检查与校验变更

在 Repoctopus workspace 中运行：

```powershell
node bin/repoctopus.js spec inspect --workspace . --change <change-id> --json
node bin/repoctopus.js spec validate --workspace . --change <change-id> --json
```

`spec inspect` 返回规范化的 change 身份、规划产物状态、受影响能力和语义摘要。结果不暴露 Provider 的绝对路径。

Design gate 不直接拼接 `inspect`、目录或 CLI 输出，而只消费版本化 `SpecificationPlanningManifest`。该契约由 Provider 映射 change、Specification Root、Provider/schema identity、Proposal、Delta Specs、Design、Tasks、会影响 Provider 行为的 Change-local 元数据与受影响能力，并计算稳定 `semanticDigest`；OpenSpec 的文件路径和命令结果不会进入 Engine 或持久 Run。Provider contract test 会验证四类工件完整、元数据语义变化会改变摘要、摘要可重算且序列化结果不泄露 checkout 路径。

`spec validate` 始终执行严格校验。传入 `--run <run-id>` 时，Repoctopus 把 Provider 身份和验证摘要绑定到 Run；恢复前如果 Provider 身份变化，Runtime 会进入迁移诊断，不会换用新 Provider 继续推进。

## 公开 Change 分支与规划批准

规划完成后，先把 Change 分支普通 push 到 Workspace Repository，不创建 MR。公开分支提供团队可见、可恢复的协作边界；它不是批准，也不授权实施、发布或合入。准备批准时，工作区必须正检出该分支、没有未提交文件，并且本地 HEAD 精确等于远端 OID：

```powershell
git push -u origin spec/<change-id>
node bin/repoctopus.js spec approval prepare --workspace . --change <change-id> --branch spec/<change-id> --target main --json
node bin/repoctopus.js spec approval status --workspace . --change <change-id> --json
node bin/repoctopus.js spec approval review --workspace . --change <change-id>
node bin/repoctopus.js run decide --workspace . --run <run-id>
```

`prepare` 通过当前 Specification Provider 严格校验 Proposal、Delta Specs、Design 和 Tasks，把四份内容摘要、Store、Provider、官方 schema instructions、受影响能力、远端分支 OID、目标分支以及 composition 和配置摘要绑定为不可变请求。它只生成 `awaiting_approval` 状态，不等于批准。Change Run 在 `design/waiting` 时用 `run decide` 展示并提交当前请求；`approve`、`revise` 和 `reject` 都通过同一个公共命令入口记录。该命令必须运行在可信交互终端，IDE 则提交同一版本化响应；非交互 Agent、Git 作者和 MR 状态都不能代替用户决定。

请求中的 `proposalHash` 是用户实际审核内容的稳定身份，覆盖 change、Specification Root、Provider/schema、规划语义摘要、能力集合和目标分支。响应必须同时匹配当前 Run 的 `requestId` 与 `proposalHash`；批准记录还生成绑定主体、决定和时间的 `approvalHash`。旧请求、跨 Run 响应或任一受保护事实被篡改时都必须拒绝，不能靠重新包装响应沿用批准。

批准生效时，Provider 从官方 `tasks.md` 解析 checkbox 任务。编号是稳定 `taskId`；规范化后的任务文字、层级、`Blocked by` 依赖、Acceptance criteria 和 Requirement mappings 共同形成 `taskRevision`。checkbox 完成状态、CRLF/LF、等价 Markdown 强调、空白以及元数据声明顺序不改变 task revision 或 Tasks semantic digest；任一任务语义、层级、依赖、验收或需求映射变化则必须改变。没有显式依赖时按文档顺序串行依赖前一任务。Runtime 只接受恰好一个 ready Task，并在 Design→Build 转换中持久化对应 Work；`run status` 读取该 Work，不从文件重新猜测。修改或拒绝状态不会产生 Build Work。

`planningGuidance` 把已审核的方法规则只读映射到 Provider 声明的四类官方工件：已解决上下文被综合进现有工件，最少公共测试缝进入 Design，tracer-bullet、验收验证和 expand/migrate/contract 顺序进入 Tasks。该指导明确禁止额外规划工件和 tracker 发布；它不复制 OpenSpec 模板，也不执行原始 `to-spec`/`to-tickets` Skill。

批准只授权按照该语义快照进入实施。产物、Provider、配置或目标分支变化时，下一次准备或实施门禁都会生成新请求，旧批准不能沿用。Change 分支每次仍必须已公开、工作区干净且本地 HEAD 与远端 OID 一致，但 OID 单独记录为 publication provenance：只推送非规划 commit 会刷新发布来源而不撤销相同规划语义的批准，规划内容变化即使仍在同一分支也会失效。后续 Delivery approval 单独授权 Business MR 和最终 Change MR 的发布；全部远端身份形成完整 Publication Receipt 后原 Run 完成，所有 MR 仍由人或托管平台合入。因此三个事实不能互相替代：

Build 或 Verify 每次继续前都会重新核对 planning semantic digest。发生变化时，Runtime 追加 `planning-semantic-drift` invalidation、清除当前 Work 与任务 revision 快照并返回 Design；Trajectory 保留被替代的 planning digest、Work ID、Task revisions 和证据身份。官方 Tasks checkbox 的完成状态已经从 planning digest 排除，因此有效的任务完成更新不会误触发回退。

旧版 planning approval 仍可只读加载，但迁移计划会返回 `migration_required`，且没有外部副作用。迁移必须重新计算当前 planning manifest、重新核对公开分支来源并生成新的 Human Decision request；旧批准、分支 OID 或 Agent 声明都不会被静默转换为当前 Design decision。

- **公开 Change 分支**：保存共享工作与精确远端版本，不代表人已同意方案。
- **规划批准**：允许开始实现当前快照，不授权发布或合入任何 MR。
- **最终 Change MR**：呈现已经关闭的完整 Change，供最终人工评审与合入，不是实施期间的工作区。

## 把规格校验加入 Evidence

在 `repoctopus.yaml` 的 Evidence Profile 中加入 `specification` 节点：

```yaml
profiles:
  - id: verify
    nodes:
      - id: specification
        type: specification
        repository: workspace
        changeId: example-change
        strict: true
      - id: tests
        type: command
        repository: workspace
        dependsOn: [specification]
        executable: npm
        args: [test]
```

Specification 节点直接调用当前 Provider。验证失败会生成 `verified` Evidence Receipt，并阻断依赖节点；调用方不能用自述成功替代该 Receipt。

## 关闭与发布协议

Archive 在任何远端 MR 发布前调用 `prepareClosure`，把以下事实绑定到不可变计划：

- change 语义摘要和 Specification Provider 身份；
- 已通过的 Verify Evidence 与 Delivery plan 摘要；
- 目标规格基线摘要；
- 受影响能力和允许修改的规格路径。

`close` 会在执行前重新生成计划并比较摘要。OpenSpec Provider 只通过官方 `archive --yes --json` 生命周期同步主规格并归档 change。成功结果写入 `.repoctopus/specification/closures/`；相同计划重放时返回原结果，不重复归档。

随后 Delivery 发布全部 Business MR 和包含关闭结果的最终 Change MR。Specification Closure identity 与全部远端 publication item 一起进入 `PublicationReceipt`；Receipt 完整且可重算时原 Change Run 才完成。Repoctopus 不等待这些 MR 合入。发布后的语义偏差通过后续 consistency review 和普通新 Change 补偿，不修改已归档 change。

## 替换 Provider

一个 project composition 必须恰好提供一个 `specification` Service。零个 Provider 会触发缺少服务诊断；两个 Provider 会触发权威冲突。兼容 Provider 必须实现 `inspect`、`validate`、`prepareClosure` 和 `close`，并返回 `repoctopus.specification/v1alpha1` 类型。

OpenSpec 是首个内置 Provider，不是 Workflow 写死的规格体系。Provider 可以使用不同的规格工具，并把自己的产物规范化为稳定领域契约；专有目录、文件名和 CLI 输出不得成为 Workflow 分支条件。更换 Provider 只影响新 Run，已有 Run 保留原 Provider 快照；如果新 Provider 无法兼容旧快照，Runtime 必须停止并进入迁移诊断。

## 权威资料冲突

规格、设计图、接口契约或其他权威资料出现实质冲突时，Repoctopus 生成 `requirements-conflict` Human Decision。请求列出冲突来源和受影响步骤，不提供默认选择。

用户选择后还必须提供已经同步权威资料的摘要。没有该摘要，受影响步骤保持暂停。这条规则防止 Agent 仅选择设计图或规格后继续实现，却把冲突留给后续 Agent。
