# specification-authority Specification Delta

## ADDED Requirements

### Requirement: Later phase 必须只读观察并在副作用前收敛规划授权

Build、Verify 和 Archive 中的 planning authority 检查 MUST 通过 Specification Planning 权威模块的只读接口观察当前 Provider planning semantic digest、strict validation 与已有 approval identity，不得由编排层拼装 Store 内部规则，也不得在 lifecycle transition 之前创建或刷新 Human Decision request。若观察结果不再授权当前 lifecycle，Runtime MUST 返回受限的 `semantic | approval-authority` 分类，并在任何 Specification Closure、Git push、MR 创建或其他 Archive 副作用前提交受保护的 Design 恢复；只有进入 Design gate 后才能刷新 approval proposal。Status、Dashboard 和其他查询 MUST 保持只读。

#### Scenario: Build pull 发现语义变化

- **WHEN** Build pull 观察到 Provider semantic digest 与 lifecycle planning digest 不同
- **THEN** Runtime 不先改 approval Store，而是原子回到带当前 Work 的 Design；后续 Design gate 再生成绑定新摘要的批准请求

#### Scenario: Archive preflight 发现 approval 失效

- **WHEN** Archive 尚未执行关闭或发布副作用，当前 Design approval 缺失、被拒绝、等待新决定或与 planning snapshot 不匹配
- **THEN** Runtime 返回 `planning-revision-required` 和 Design checkpoint，且 Specification、Git 与平台发布 adapter 均未被调用

#### Scenario: 查询发现不一致

- **WHEN** status 或 Dashboard 读取到 approval 与 lifecycle 不一致
- **THEN** 查询报告可定位 freshness/diagnostic，但不修改 phase、approval 或 current Work；下一次受保护 Runtime pull 执行幂等收敛
