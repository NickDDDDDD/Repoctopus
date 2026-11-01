# implementation-evidence Specification Delta

## ADDED Requirements

### Requirement: Evidence 输入必须区分产品与执行控制面

Repoctopus MUST 使用版本化 Repository Input Policy 把已登记仓库输入区分为产品输入、内容寻址的执行控制面输入和未知输入；产品 repository fingerprint、策略摘要与控制面 manifest 摘要 MUST 共同进入 Evidence fingerprint 和 Verification Input，任何一项不得被静默忽略。

#### Scenario: 外部 Host 在仓库中安装执行文件

- **WHEN** 未被 Git 跟踪的 Hook、Agent 指令、Skill 或锁文件匹配当前 composition 提供的受限 Host input rule
- **THEN** Runtime 不把它计为产品 dirty file，但以规范路径、类型、内容摘要、owner 和 policy identity 写入 control-plane manifest，并使 Evidence 绑定该 manifest digest

#### Scenario: 未知未跟踪文件出现

- **WHEN** 一个未跟踪文件不匹配任何受信 Host rule
- **THEN** 该文件继续按实际内容进入产品 dirty fingerprint，不因目录名、点前缀或用户 ignore 配置被控制面分类器排除

#### Scenario: 控制面文件在采集后变化

- **WHEN** Host Hook、Skill、指令、锁文件集合、内容、类型或输入策略在 Evidence 采集开始后变化
- **THEN** 当前 Attempt 标记为 `superseded` 或 Gate 拒绝旧 Bundle，Archive 重验不得复用变化前的 Evidence

### Requirement: 控制面输入分类必须 fail-closed

Repository Input Policy MUST 只接纳未跟踪、未打包、位于仓库根内且满足版本化精确规则的控制面输入；Git tracked 路径 MUST 保持产品输入，只有 external-exclusive 路径进入产品面、规则重叠、类型不符、路径逃逸、竞态或无法稳定读取才 MUST 阻断指纹采集。

#### Scenario: 双用途 Host 路径被团队版本化

- **WHEN** 团队把允许版本化的 `AGENTS.md`、Skill 或其他双用途路径提交到 HEAD、index 或 tracked modification
- **THEN** Runtime 把它作为产品 tree 或 dirty 输入取指纹，不再按本地 control-plane rule 排除

#### Scenario: 外部独占路径被提交到产品 tree

- **WHEN** policy 声明为 external-exclusive 的旧 Host 安装路径出现在 HEAD、index 或 tracked modification
- **THEN** Runtime 报告产品与控制面所有权冲突并拒绝 Evidence

#### Scenario: 控制面符号链接逃逸仓库

- **WHEN** 登记路径解析到仓库根外、在读取期间改变对象身份或使用不允许的文件类型
- **THEN** 指纹采集 fail-closed，且诊断不读取或泄露仓库外内容

#### Scenario: 输入枚举顺序不同

- **WHEN** 两次采集观察到相同产品内容、控制面内容和策略，仅 Git 或文件系统返回顺序不同
- **THEN** 规范排序后的 product、control-plane 和最终 Evidence digest 完全相同

### Requirement: 控制面身份必须沿用现有 Evidence Gate

EvidenceCoordinator MUST 通过现有 fingerprint、Verification Input、Bundle 和 Gate 比较链路核对控制面输入，不得建立独立生命周期状态或允许 Host 自述替代实际内容摘要。

#### Scenario: 相同产品源码使用不同 Skill 安装

- **WHEN** HEAD、tree 和产品 dirty 内容相同，但 control-plane manifest 或 policy Contributor identity 不同
- **THEN** 两次运行产生不同 Verification Input，旧 Receipt、Bundle 和 Gate 不得复用

#### Scenario: 产品与控制面均未变化

- **WHEN** 仓库产品 fingerprint、control-plane manifest、policy digest、composition 和其他 Evidence 输入完全相同
- **THEN** Runtime 可以按既有确定性和新鲜度规则复用 Receipt，无需把 Host 文件移动出仓库

## MODIFIED Requirements

### Requirement: Evidence 绑定完整输入指纹

Repoctopus MUST 把仓库 HEAD、tree、产品未提交内容、内容寻址的执行控制面 manifest、Repository Input Policy、配置、lockfile、Journey、工具、浏览器、Adapter 和输入 Artifact 摘要绑定到 Bundle 指纹，并在采集开始和结束时重新核对产品与控制面选择集合。

#### Scenario: 采集期间源码发生变化

- **WHEN** 结束时的产品指纹、控制面 manifest 或策略摘要与开始时不同
- **THEN** 当前 Attempt 标记为 `superseded`，保留制品但不得用于 Verify

#### Scenario: 开发阶段存在未提交修改

- **WHEN** Profile 允许在 dirty worktree 收集开发反馈
- **THEN** 产品 dirty 集包含实际选中文件内容摘要，已登记控制面输入包含独立内容摘要，不能只使用 Git 状态文本或忽略 Host 执行输入
