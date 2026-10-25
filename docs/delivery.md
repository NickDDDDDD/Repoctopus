# 交付治理与失败恢复

Repoctopus 把交付分成两个边界：Build 期间的远端 checkpoint，以及 Archive 中受人工授权保护的完整发布。Delivery 提供受保护的 Git/平台 Adapter；Change Run 是唯一生命周期权威。

## 配置与 checkpoint

共享策略位于 `repoctopus.yaml` 的 `delivery` 段，示例见 [repoctopus.yaml](examples/repoctopus.yaml)。自动 checkpoint 只有在当前分支不受保护、commit message 合规且快速检查通过时执行。它普通 push 当前 HEAD、建立 upstream 并核对远端 OID；从不 force-push 或 rebase。

GitHub Credential 使用 `delivery.publication.apiCredential` 引用环境变量。Credential 值不进入 YAML、digest、日志或遥测。

每个 Change 通过 Delivery Intent v3 声明：

- 唯一 Change 分支，位于 Workspace Repository；
- 至少一个 Business Delivery；默认且通常只有 `primary` 一个；
- 每个业务仓的 source/base、commit message 和 MR 动作；
- 多 MR 时不可省略的 `businessSplitReason`。

完整字段见 [Delivery Intent schema](schemas/delivery-intent.schema.json)，默认单 MR 示例见 [delivery-intent.yaml](examples/delivery-intent.yaml)。扫描到但未选择的脏仓库只产生警告，不会被自动提交。

## Archive preflight 与批准

`archive-prepare` 只接受已经通过 Design、Build 与 Verify 的 Change Run。验证报告必须被 Intent 选中的业务仓跟踪，相关工作树必须干净：

```powershell
node bin/repoctopus.js run archive-prepare --workspace . --run <run-id> --attempt <attempt-id> --intent <intent.yaml> --json
node bin/repoctopus.js approval review --workspace . --change <change-id>
```

Archive 关闭规格后可能在同一个 source-branch worktree 中出现尚未提交的规格关闭 diff。该 diff 不属于 Business MR：Runtime 只在 repository 与 source branch 同时匹配时采用 Closure Receipt 的 `changedFiles` 作为一次性清洁范围，并要求 staged、unstaged、untracked 的实际路径集合与其完全相等。任何额外修改、缺失关闭文件或越界路径仍会阻断发布；普通 Delivery 不接受此例外。

准备快照绑定 Change 分支、完整业务交付集合、每仓 HEAD tree 与目标基线、验证报告、策略、动作计划、composition digest 和 Evidence Bundle。任一代码树、报告、策略、分支、仓库选择或目标基线变化都会使批准失效。

在所有远端动作仍是 `pending` 且尚未产生决定时，相同输入重试幂等返回原请求；新输入生成新 request，迟到旧响应被身份检查拒绝。批准、拒绝或开始发布后，重新 prepare 不能覆盖既有事实。

## Archive 发布协议

批准后执行：

```powershell
node bin/repoctopus.js run archive-publish --workspace . --run <run-id> --json
```

协议按固定顺序执行：

1. 重新核对 frozen Delivery plan、Evidence 和远端基线。
2. 通过 Specification Provider 关闭 OpenSpec change，同步主规格并归档四类规划产物。
3. 对每个 Business Delivery 普通 push 精确 source OID，并创建或恢复同 head/base 的 MR。
4. 发布关闭后的 Change 分支，并创建或恢复唯一最终 Change MR。
5. 逐项核对 repository、remote、base branch、head branch、published OID 和 MR identity。
6. 形成包含全部业务项、最终规格项与 Specification Closure 的 `PublicationReceipt`。
7. 同一 Change Run 接受 Receipt 后进入 `completed`。

Archive 不等待 Business MR 或最终 Change MR 合入，也不执行 merge。发布完成的含义是“所有已批准交付都已经可供平台评审且远端身份经过核对”，不是“平台已经合入”。这使生命周期保持 `Open → Design → Build → Verify → Archive`，避免为外部人工时延建立常驻状态机。

## 多仓原子性与重试

多仓远端没有跨仓事务。Publication Journal 在每个远端动作前保存 Intent，动作后保存 Receipt。命令中断或响应丢失时，对同一 Run 重试 `archive-publish`：

- 已完成项先查询远端，等价则复用；
- 未完成项从第一个 pending intent 继续；
- head/base/OID 或 MR identity 漂移时 fail closed；
- 不自动删除分支、关闭 MR、force-push、rebase 或回滚其他仓。

临时 checkout 只服务当前命令，并在 `finally` 中有界清理；失败会留下明确诊断，而不是建立通用 daemon GC。

## 最终一致性检查

MR 合入、代码审查或 CI 修复可能发生在 Publication Receipt 之后。显式命令和下一次正常 `run start` 都可以执行有界检查：

```powershell
node bin/repoctopus.js change reconcile --workspace . --json
node bin/repoctopus.js change reconcile --workspace . --change <change-id> --json
```

Reconciler 按已完成 Change 的 Receipt 查询业务 MR 当前 head/state，并与发布事实比较。它不监听 Webhook、不轮询、不创建 wait，也不把已完成 Run 回退到 Archive。平台暂时不可用只产生诊断。

发现变化后，受保护影响审查只能得出：

- `no-spec-impact`：实现或流水线修正不改变规格；记录审查回执即可。
- `spec-update-required`：建立普通后续 OpenSpec change，引用原 Change、Receipt 和受影响 MR。
- `uncertain`：等待可信用户判断，不能由 Agent 默认为无影响。

后续 Change 重新走 Open、Design、Build、Verify、Archive；不得编辑原归档目录或重开原 Run。这样以语义补偿实现最终一致，而不是把远端平台变成第二套生命周期权威。

## 旧 Delivery 迁移

v2/旧 v3 状态仍可只读诊断，但写入口返回 `migration_required`。使用 [Delivery v2 迁移指南](delivery-v2-migration.md)生成只读计划并重新取得 Planning、Evidence 与 Delivery approval；旧批准和 Evidence 不能复用。

## 平台能力降级

GitHub Adapter 区分认证失败、权限不足、套餐功能不可用、配置错误、限流和暂时故障。私有仓库因套餐不支持服务端分支保护时只记录非阻断警告；本地检查或 CI 不能被描述成服务端保护。
