## MODIFIED Requirements

### Requirement: Provider 校验 Open 与 Design Work 的完成事实

Open 和 Design 的 succeeded Host submission MUST 由当前 Specification Provider重新观察并验证，但 submission在 Provider Evidence接受前不得成为允许 lifecycle推进的终态成功事实。Open至少证明 change identity、允许根及当前 schema要求的四类官方工件均为 `ready` 或经官方规则确认的 `skipped`，Design必须证明全部适用工件严格有效且语义摘要可供 Human Decision；Host或 Agent的成功声明不得代替观察事实。Provider成功返回的确定性无效 MUST 进入受管返工，观察基础设施不可用 MUST 保留当前执行并等待重新观察。

#### Scenario: Agent 声称已创建 Change 但目录缺失

- **WHEN** Open Host返回 succeeded而 Provider找不到对应 change或 metadata
- **THEN** Validator拒绝 Outcome并保持 Open Work可修复

#### Scenario: 官方规则跳过 Delta Specs

- **WHEN** Open Host返回 succeeded，Provider确认 Proposal、Design和 Tasks为 `ready`，并依据当前 schema与元数据确认 Delta Specs为 `skipped`
- **THEN** Validator接受该四类工件协议的满足事实并继续严格校验，不以“缺少第四个文件”阻断 Open

#### Scenario: Design 文件存在但 strict validation 失败

- **WHEN** Design Host返回 succeeded而任一适用官方工件缺失、格式错误或引用无效
- **THEN** Validator保持 Design blocked或生成诊断 retry，不创建 Human Decision请求

#### Scenario: Open Host 自述成功但工件缺失

- **WHEN** Host为 `change.intake`提交 succeeded，但 Provider报告必需工件缺失、未满足或 strict invalid
- **THEN** Runtime不建立 Open Human Decision、不进入 Design，并通过当前 Run派发受管 Open repair Work

#### Scenario: Design Host 自述成功但 Tasks 缺少 Acceptance

- **WHEN** Design Host提交 succeeded，但 Provider投影出 tracked Task缺少规范 Acceptance identity
- **THEN** Validator保持 Design blocked或生成诊断 retry，不创建 Human Decision请求

#### Scenario: Provider 调用失败

- **WHEN** Runtime未获得结构化 manifest和 validation便发生 Provider、Store或进程错误
- **THEN** Runtime记录 observation unavailable并保留当前 Work/Outcome供重验，不把错误分类成可修复规格缺陷

## ADDED Requirements

### Requirement: Open 批准后必须重新观察当前规划摘要

可信 Open Human Decision MUST 只授权其请求中冻结的 Provider、schema、planning semantic digest和工件满足状态。Runtime MUST 在创建 Design Work前通过 Specification Planning权威模块只读重新观察当前输入；完全匹配才可推进，确定性漂移 MUST 返回 Open repair Work，未知结果 MUST 停在原 Run等待 reconciliation。重验不得仅凭 approval Store、文件时间或 Agent声明通过。

#### Scenario: 批准内容保持不变

- **WHEN** 当前 Provider重验结果与 Open决定冻结的 Provider/schema identity、语义摘要和 strict validation完全一致
- **THEN** Runtime接受批准并创建当前 definition选择的 Design Work

#### Scenario: 批准后文件被修改

- **WHEN** Open决定写入后任一受控规划语义变化，即使新的工件仍然 strict valid
- **THEN** Runtime使旧批准不可用于推进并返回 Open Work；不得直接为未执行 Open方法的新摘要创建审批

#### Scenario: 批准后重验未知

- **WHEN** Runtime无法证明当前摘要匹配或确定性不匹配
- **THEN** Runtime保持原决定和 Run checkpoint供 reconciliation，不进入 Design、不刷新另一份 Human Decision并不重放 Host
