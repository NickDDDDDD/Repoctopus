## ADDED Requirements

### Requirement: Open repair 必须原子替换当前 execution

当 Open Provider Evidence或批准后重验要求返工时，Runtime MUST 在同一次 Run CAS中安装由当前 lifecycle definition物化的新 `change.intake` Work，并按统一 current execution判定退役 `workId/checkEpoch` 不匹配的旧 checkpoint。新 Work MUST 绑定当前 Project Snapshot、composition、Specification Root、Action Skill和 augmentation；历史 claim、packet、Host invocation、submission、Outcome、Receipt、Validator和 rejection MUST 保留在 trajectory。Status和 recovery不得把历史 execution重新投影为当前 continuation。

#### Scenario: Open Evidence 拒绝后建立 repair Work

- **WHEN** 当前 Open execution已产生成功 Outcome，但 Provider Evidence确定性拒绝该候选
- **THEN** lifecycle Work替换和旧 execution retirement由同一 CAS完成，恢复只返回新 Work的未领取 continuation

#### Scenario: Repair transition 进程中断

- **WHEN** 进程在提交 replacement CAS后、Host领取新 Work前退出
- **THEN** 新进程从同一 Run恢复完全相同的 workId、epoch、packet输入与 Skill composition，不重新创建 Work

#### Scenario: 陈旧 Runner 提交 repair

- **WHEN** Runner使用旧 lifecycle revision或旧 epoch尝试安装 Open repair Work
- **THEN** Runtime拒绝该提交并要求重读当前 Run，不覆盖已存在 Work、Wait或批准

#### Scenario: 遗留无 Work 的 Open blocker

- **WHEN** 冷启动读取修复前持久化的 `open/blocked/currentWork=null`状态
- **THEN** Runtime返回明确不可自动迁移诊断和重新开始提示，不伪造 repair Work或从可变文件反推冻结输入
