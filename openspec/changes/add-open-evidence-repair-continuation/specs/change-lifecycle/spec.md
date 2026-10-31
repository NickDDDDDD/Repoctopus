## MODIFIED Requirements

### Requirement: Open 与 Design 必须分别形成受审查边界

Change Run MUST 把 Open 和 Design 实现为两个独立的受管阶段。Open 必须在核对仓库、现有规格和输入事实后创建或修复 proposal、delta specs、design、tasks 四类 OpenSpec 工件协议，经 Provider 确认各类为 `ready` 或依据官方 schema 规则为 `skipped`，并在严格校验后建立绑定其语义摘要的 Human Decision；只有可信批准且批准后重新观察的摘要、Provider/schema identity 与 strict validation仍匹配才能进入 Design。Design 必须从已批准 Open 基线深化同一四类工件，经独立校验和第二个 Human Decision 批准后才能进入 Build。两个批准不得互相替代、合并或由 `auto_transition`、文件存在和 checkbox 状态推断。

#### Scenario: Open 四类工件通过严格校验

- **WHEN** Open Work交付当前 schema适用的官方工件，Provider对四类协议均报告已满足且 strict validation接受当前语义摘要
- **THEN** Runtime在 Open建立稳定 Human Decision并停止；在收到绑定该摘要的可信批准前不得创建 Design Work或转换 phase

#### Scenario: Open 官方跳过 Delta Specs

- **WHEN** Provider依据当前 schema与 Change元数据把 Delta Specs规范化为带稳定 identity的 `skipped`，其余适用工件为 `ready`
- **THEN** Runtime把四类工件协议视为已满足并继续严格校验，不自行读取元数据、查找第四个文件或把 `skipped` 改写为 `missing`

#### Scenario: Open 被拒绝或要求修订

- **WHEN** 用户拒绝 Open proposal或要求修订其中任一受控语义
- **THEN** Run保持 Open、使过期 proposal hash不可提交，并恢复或创建受管 Open Work，而不是进入 Design

#### Scenario: Design 深化同一 OpenSpec 工件

- **WHEN** 已批准 Open进入 Design并补足工程边界、决策、验证策略或可执行 Tasks
- **THEN** Design只更新同一 Change的四类 OpenSpec工件协议，严格校验后建立独立 Human Decision，不创建第五份 Design Doc、Build Plan、ADR或 implementation notes

#### Scenario: 只有 Open approval

- **WHEN** Open approval已接受但批准后重验、Design Work、Validator或 Design approval任一缺失
- **THEN** Runtime不得进入 Build，也不得把 Open approval解释为整个规划阶段已获批

## ADDED Requirements

### Requirement: Open 校验失败必须形成可执行恢复回环

Runtime MUST 把 Open Host Outcome、Provider Evidence acceptance和 Human Decision建模为不同事实。当前 Provider成功证明工件、strict validation、manifest或 lifecycle Validator确定性无效时，Runtime MUST 在一次 revision-bound Run CAS中保留 `phase=open`、安装新的 `change.intake` Work、递增 `checkEpoch`并退役旧 execution checkpoint；不得产生 `currentWork=null` 的 repair中间态、无生产入口的 next-action标签或新的 Run。Provider观察结果未知时 MUST 保留原 Work/Outcome并进入 reconciliation，不得盲目重新执行 Host。

#### Scenario: Open Outcome 后 strict validation 失败

- **WHEN** 当前 `change.intake`已有成功 Host Outcome，但 Provider成功返回 strict invalid和可定位诊断
- **THEN** Runtime原子发布新的 Open repair Work与 epoch，旧 execution只保留为历史，`run next`可领取新 Work

#### Scenario: Provider 观察不可用

- **WHEN** Provider、Store或未分类程序错误使 Runtime无法判断当前工件有效或无效
- **THEN** Runtime保持原 Work、Outcome、attempt和 invocation，返回 reconciliation并在下一次受保护 pull重新观察，不派发 repair Work

#### Scenario: 批准后摘要漂移

- **WHEN** 用户批准的 Open摘要在进入 Design前被重新观察为不同摘要或 strict invalid
- **THEN** 旧批准不得推进，Runtime在同一 Run返回新的 Open Work；新摘要通过 Evidence后必须建立新的 Human Decision

#### Scenario: 重复恢复 Open repair

- **WHEN** 多个 Runner或重复 `run next/resume`观察到同一确定性 Open失效
- **THEN** 只有一个 revision-bound transition安装唯一 repair Work，其他调用重读相同 Work/epoch且不重复调用 Host
