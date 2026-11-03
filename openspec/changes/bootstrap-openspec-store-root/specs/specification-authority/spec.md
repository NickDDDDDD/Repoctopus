## ADDED Requirements

### Requirement: Workspace Store 登记必须建立在健康规格根之上

Repoctopus MUST 把 Specification Root materialization 与 OpenSpec Store registration 建模为两个有序事实：缺失根只能由固定 Provider的官方初始化入口创建，健康根才能登记，登记后必须用显式 `storeId` 重新验证 registry、Store metadata 与 Workspace checkout。`store register` 失败不得被解释为初始化请求；default Store、nearest root、业务仓本地根或 CLI 成功文本不得替代结构化健康与身份 Evidence。

#### Scenario: 缺失根先初始化再登记

- **WHEN** 获批 Workspace 的精确 `openspec/` 路径不存在且 registry没有冲突
- **THEN** Repoctopus 先持久化初始化 Intent，调用固定 Provider 创建根并重新验证健康，再执行 Store registration

#### Scenario: 健康根尚未登记

- **WHEN** Workspace 已有固定 Provider认可的健康根，但当前 Runner的 registry没有该 `storeId`
- **THEN** Repoctopus 保留根内容不变，只登记 Store并通过显式 context验证其指向当前 checkout

#### Scenario: Store id 指向另一个 checkout

- **WHEN** 当前 Runner registry中的相同 `storeId` 指向不同 Workspace checkout
- **THEN** Repoctopus 返回 authority conflict并阻塞接入，不覆盖登记、不选择默认 Store且不安装业务仓 pointer

#### Scenario: 官方初始化命令结果未知

- **WHEN** 固定 Provider进程超时、崩溃或调用方未收到确定退出结果
- **THEN** Repoctopus 保留原 Intent并重新观察根与 ownership checkpoint；只有可证明成功的状态才能继续登记，未知或漂移状态停止等待修复

#### Scenario: 业务仓已有本地根

- **WHEN** Workspace Root 已健康并登记，但业务仓存在会遮蔽 Store pointer的本地规格根
- **THEN** Repoctopus 仍按 authority conflict阻断该仓，不因 Workspace初始化成功而覆盖或合并本地根
