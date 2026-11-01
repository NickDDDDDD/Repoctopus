# Proposal

## Why

Repoctopus 当前把 Git 仓库中所有未忽略的未跟踪文件都计入 Evidence 仓库指纹，同时架构检查又按物理路径存在性拒绝 `.codex` 等旧工作流目录。外部 Host 或控制器在仓库旁安装 Hook、Skill、规则和锁文件后，即使产品源码没有变化，也会导致 `npm run verify` 失败，或在 Verify 到 Archive 之间造成输入指纹漂移。上一轮自举只能临时移走 `.codex` 才能继续，说明产品输入与执行控制面输入尚未形成稳定、可复现的边界。

简单把这些文件加入 `.gitignore` 或从指纹中全部排除并不安全：`AGENTS.md`、Skill、Hook 和锁文件会影响 Agent 实际执行，若不绑定其内容，Evidence 就无法证明由哪套执行方法产生。本 Change 需要把两类输入分区并分别内容寻址，使 Host 文件可以稳定存在，同时仍然 fail-closed。

## What Changes

- 建立版本化 Repository Input Policy，把仓库内容分为产品输入、已登记的 Host/控制面输入和未知输入。
- 产品输入继续绑定 HEAD、tree 和实际未提交内容；未知未跟踪文件继续进入 dirty fingerprint，不得被宽泛忽略。
- 只有显式登记、未被产品 Git tree 跟踪且不进入发布包的 Host 输入可以离开产品 dirty 集；其实际内容、类型和 Provider/策略身份必须进入独立的 control-plane manifest digest。团队有意跟踪的 `AGENTS.md` 或 Skill 仍按产品输入取指纹，不被控制面规则排除。
- `.codex`、`.agents`、`AGENTS.md`、Skill lock 和类似执行输入不得被静默丢弃；内容或策略变化会使 Evidence、Verification Input 和复用结果失效。
- 调整旧工作流架构检查：拒绝产品跟踪面、生产源码和发布包中的旧路径或标记，而不是仅因本机存在未跟踪 Host 安装目录就失败。
- 对外部独占路径进入产品面、未知路径、符号链接逃逸、目录竞态和策略漂移保持 fail-closed，并提供有界诊断。
- 增加真实自举验收：Host 文件在整个 Verify→Archive 窗口内保持原位即可通过；修改 Host 输入、把它加入产品 tree 或引入未知文件时必须使旧 Evidence 失效或门禁失败。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `implementation-evidence`：把产品仓库指纹与内容寻址的控制面输入共同绑定到 Evidence 和 Verification Input。
- `runtime-foundation`：把 Host 安装面与产品能力来源隔离改为可机器校验的所有权边界，而不是物理目录不存在约束。

## Impact

- 影响 Git 输入选择与 race-safe fingerprint、EvidenceCoordinator、Verification Input、composition/Host identity、架构治理脚本及相关配置。
- 增加单元、集成和端到端测试，覆盖单仓、多仓、未跟踪 Host 文件、双用途 tracked 输入、external-exclusive 冲突、策略变化、内容漂移和发布包边界。
- 可能更新自举和 Host 集成文档，明确哪些文件是产品输入、控制面输入或未知输入，以及每类变化如何使 Evidence 失效。
- 不修改五阶段生命周期，不新增后台进程，不依赖 Comet SDK，也不把 Comet 路径硬编码进领域层；Comet 0.5.1 仍只作为本 Change 的外部稳定执行器。
- 不提供任意排除 glob、用户可绕过门禁的 ignore 配置或旧版本兼容层。
