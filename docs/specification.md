# Specification Provider

Repoctopus 通过唯一的 Cordis `specification` Service 读取、校验和关闭规格变更。Workflow 使用稳定领域契约，不读取 `openspec/` 路径，也不解析 OpenSpec CLI 输出。当前内置 Provider 使用 OpenSpec `1.14.1`。

## 检查与校验变更

在 Repoctopus workspace 中运行：

```powershell
node bin/repoctopus.js spec inspect --workspace . --change <change-id> --json
node bin/repoctopus.js spec validate --workspace . --change <change-id> --json
```

`spec inspect` 返回规范化的 change 身份、规划产物状态、受影响能力和语义摘要。结果不暴露 Provider 的绝对路径。

`spec validate` 始终执行严格校验。传入 `--run <run-id>` 时，Repoctopus 把 Provider 身份和验证摘要绑定到 Run；恢复前如果 Provider 身份变化，Runtime 会进入迁移诊断，不会换用新 Provider 继续推进。

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

Provider 可以使用不同的规格工具，但不能把专有目录和 CLI 输出变成 Workflow 分支条件。更换 Provider 只影响新 Run；已有 Run 保留原 Provider 快照。

## 权威资料冲突

规格、设计图、接口契约或其他权威资料出现实质冲突时，Repoctopus 生成 `requirements-conflict` Human Decision。请求列出冲突来源和受影响步骤，不提供默认选择。

用户选择后还必须提供已经同步权威资料的摘要。没有该摘要，受影响步骤保持暂停。这条规则防止 Agent 仅选择设计图或规格后继续实现，却把冲突留给后续 Agent。
