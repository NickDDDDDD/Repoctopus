# multi-repository-probe Specification

## Purpose
定义 Repoctopus 在不修改业务仓的前提下探测平级 Git 仓库并生成可用于 Run 和恢复的稳定快照。

## Requirements

### Requirement: 探测只读取直接子目录中的 Git 工作树

`project probe` MUST 扫描用户明确指定父目录的直接子目录，只读取可验证的 Git 工作树事实，不得递归接管未知目录或修改被探测仓库。

#### Scenario: 父目录包含多个仓库和普通目录

- **WHEN** 父目录包含两个 Git 工作树、一个普通目录和 Repoctopus 工作区
- **THEN** 结果稳定列出两个业务仓库，普通目录不被识别为仓库，工作区按显式规则包含或排除

#### Scenario: 探测完成

- **WHEN** 探测命令成功返回
- **THEN** 业务仓的文件树、索引、HEAD、分支和工作树状态均未被命令改变

### Requirement: 仓库快照包含可协调身份

每个仓库快照 MUST 包含规范化仓库标识、本地路径、可用的远端身份、当前分支、HEAD 和工作树摘要，并使用稳定规则排序和计算项目快照摘要。

#### Scenario: 仓库没有远端或处于 detached HEAD

- **WHEN** Git 工作树没有远端或没有当前分支
- **THEN** 快照显式记录缺失值和 HEAD，不猜测远端或分支

#### Scenario: 工作树包含未提交变化

- **WHEN** 仓库有 staged、unstaged 或 untracked 变化
- **THEN** 工作树摘要反映变化类型且不读取或上传不必要的文件正文

### Requirement: 探测路径受作用域约束

探测器 MUST 规范化和校验父目录及仓库路径，拒绝路径逃逸、重复身份和无法安全读取的工作树，并返回逐仓诊断。

#### Scenario: 子目录解析到作用域外

- **WHEN** 符号链接或路径规范化使候选仓库位于指定父目录外
- **THEN** 探测器拒绝该候选并报告路径原因

### Requirement: 恢复时刷新外部仓库事实

`run resume` MUST 重新探测与 Run 关联的仓库，并把当前快照与 Checkpoint 快照比较；外部变化不得被旧缓存覆盖。

#### Scenario: 仓库在会话中断期间产生新提交

- **WHEN** 当前 HEAD 与 Checkpoint 不同
- **THEN** Runtime 报告仓库和差异类型，并重新解析所有依赖旧 HEAD 的下一动作
