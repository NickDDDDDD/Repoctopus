# Proposal

## Why

现有交付约束把可回退的本地 commit 与会影响团队共享状态的 push、MR 和 merge 放在同一审批等级，导致 Agent 每创建一个开发检查点都要等待人工令牌。Repoctopus 需要把审批绑定到经过验证的交付快照，让本地开发保持流畅，同时继续由人决定一组多仓改动是否可以发布评审。

## What Changes

- 增加多仓交付集合：每个 change 显式选择受影响仓库、目标分支以及计划执行的远端动作。
- 允许按项目策略在非保护分支自动创建本地 checkpoint commit，不再要求逐次人工批准。
- 在生成并提交验证报告后捕获稳定交付快照，把代码树、报告、目标基线、仓库选择和策略摘要绑定为一次批准对象。
- 增加结构化 Human Decision 协议；IDE Adapter 优先显示原生批准交互，CLI 提供可信交互降级，不要求用户复制哈希命令。
- 一次人工批准解锁快照内的 push 和 MR 创建或更新；任何绑定事实漂移都会使批准失效。
- 增加可恢复的多仓发布计划，记录每个远端动作的结果并从失败点继续，不承诺跨仓事务原子性。
- 增加平台无关的 MR 端口和首个 GitHub Adapter；读取 CI、评审、合入和分支保护状态，但不自动执行 merge。
- 本变更不实现 CodeHub Adapter、具体 IDE 插件、TDD、浏览器或后端反馈采集、OpenWiki 回写和 OpenSpec 自动归档。
- 本变更不采用新的第三方源码；既有 Comet 来源范围保持不变。

## Capabilities

### New Capabilities

- `delivery-governance`: 定义自动本地提交、交付快照、人工批准、多仓发布恢复、MR 状态证据和平台能力诊断。

### Modified Capabilities

无。

## Impact

- 新增交付领域模型、交付策略与批准事件契约。
- Runtime 增加交付编排入口，并通过 Git、Human Decision 和 Merge Request 端口执行副作用。
- CLI 增加交付准备、状态、交互批准、发布和恢复命令，继续使用版本化 JSON envelope。
- 平台层增加可写 Git Adapter、GitHub Adapter 和交付 Journal；敏感凭据不得写入配置、状态、日志或遥测。
- 工作流和文档增加交付状态、失败恢复、平台降级及配置示例。
