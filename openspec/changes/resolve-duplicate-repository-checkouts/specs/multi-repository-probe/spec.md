# Spec Delta

## MODIFIED Requirements

### Requirement: 探测路径受作用域约束

探测器 MUST 规范化和校验父目录及仓库路径，拒绝路径逃逸、重复身份和无法安全读取的工作树，并返回逐仓诊断。多仓接入 MUST 能将重复身份的有效 checkout 作为待选择的候选事实返回。已解析的仓库快照和后续 Run MUST 保持仓库身份唯一。

#### Scenario: 子目录解析到作用域外

- **WHEN** 符号链接或路径规范化使候选仓库位于指定父目录外
- **THEN** 探测器拒绝该候选并报告路径原因

#### Scenario: 探测多个同远端 checkout

- **WHEN** 两个作用域内的 Git 根规范化为同一远端身份
- **THEN** 多仓接入能得到包含实际路径的冲突组
- **AND** 同一路径的多个别名不会被当成不同 checkout
