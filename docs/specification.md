# Specification Provider

Repoctopus 通过唯一的 Cordis `specification` Service 读取、校验和关闭规格变更。Workflow 使用稳定领域契约，不读取 `openspec/` 路径，也不解析 OpenSpec CLI 输出。当前内置 Provider 使用 OpenSpec `1.14.3`。

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

`spec validate` 始终执行严格校验。传入 `--run <run-id>` 时，Repoctopus 把 Provider 身份和验证摘要绑定到 Run；恢复前如果 Provider 身份变化，Runtime 会进入迁移诊断，不会换用新 Provider 继续推进。

## 公开 Change 分支与规划批准

规划完成后，先把 Change 分支普通 push 到 Workspace Repository，不创建 MR。公开分支提供团队可见、可恢复的协作边界；它不是批准，也不授权实施、发布或合入。准备批准时，工作区必须正检出该分支、没有未提交文件，并且本地 HEAD 精确等于远端 OID：

```powershell
git push -u origin spec/<change-id>
node bin/repoctopus.js spec approval prepare --workspace . --change <change-id> --branch spec/<change-id> --target main --json
node bin/repoctopus.js spec approval status --workspace . --change <change-id> --json
node bin/repoctopus.js spec approval review --workspace . --change <change-id>
```

`prepare` 通过当前 Specification Provider 严格校验 Proposal、Delta Specs、Design 和 Tasks，把四份内容摘要、Provider 身份、受影响能力、远端分支 OID、目标分支以及 composition 和配置摘要绑定为不可变请求。它只生成 `awaiting_approval` 状态，不等于批准。`review` 必须运行在可信交互终端或由可信 IDE Adapter 提交；非交互 Agent、Runner、Git 作者和 MR 状态都不能代替用户决定。

批准只授权按照该快照进入实施。产物、Provider、配置、目标分支或 Change 分支 OID 任一变化，下一次准备或实施门禁都会生成新请求，旧批准不能沿用。后续 Delivery approval 单独授权 Business MR 发布；最终 Change MR 则只在全部 Business MR 合入、Post-merge Evidence 通过、主规格同步且 change 归档以后创建，并仍由人合入。因此三个事实不能互相替代：

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

## 关闭协议

合入后协调器先调用 `prepareClosure`，把以下事实绑定到不可变计划：

- change 语义摘要；
- Specification Provider 身份；
- 全部业务 MR 的合入事实摘要；
- 目标规格基线摘要；
- 受影响能力和允许修改的规格路径。

`close` 会在执行前重新生成计划并比较摘要。OpenSpec Provider 只通过官方 `archive --yes --json` 生命周期同步主规格并归档 change。成功结果写入 `.repoctopus/specification/closures/`；相同计划重放时返回原结果，不重复归档。

## 替换 Provider

一个 project composition 必须恰好提供一个 `specification` Service。零个 Provider 会触发缺少服务诊断；两个 Provider 会触发权威冲突。兼容 Provider 必须实现 `inspect`、`validate`、`prepareClosure` 和 `close`，并返回 `repoctopus.specification/v1alpha1` 类型。

OpenSpec 是首个内置 Provider，不是 Workflow 写死的规格体系。Provider 可以使用不同的规格工具，并把自己的产物规范化为稳定领域契约；专有目录、文件名和 CLI 输出不得成为 Workflow 分支条件。更换 Provider 只影响新 Run，已有 Run 保留原 Provider 快照；如果新 Provider 无法兼容旧快照，Runtime 必须停止并进入迁移诊断。

## 权威资料冲突

规格、设计图、接口契约或其他权威资料出现实质冲突时，Repoctopus 生成 `requirements-conflict` Human Decision。请求列出冲突来源和受影响步骤，不提供默认选择。

用户选择后还必须提供已经同步权威资料的摘要。没有该摘要，受影响步骤保持暂停。这条规则防止 Agent 仅选择设计图或规格后继续实现，却把冲突留给后续 Agent。
