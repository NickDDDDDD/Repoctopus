# Runtime Foundation Specification

## Purpose

定义 Repoctopus 首个可运行 Runtime 的 Engine 边界、工作流快照、Run、确定性解析、持久化、恢复、CLI 和第三方来源治理。

## ADDED Requirements

### Requirement: Engine 保持确定性和平台无关

Engine MUST 只根据版本化 Run、工作流快照、领域事件和证据投影计算决定及下一状态，不得直接读取文件、执行进程、访问 Git、调用网络或依赖具体 IDE、托管平台和可观测后端。

#### Scenario: 相同输入重复解析

- **WHEN** Engine 使用相同工作流快照、Run、事件和证据执行两次解析
- **THEN** 两次结果具有相同决定、下一状态、诊断和待执行动作

#### Scenario: 平台操作尚未完成

- **WHEN** Engine 需要外部 Git 或文件事实才能继续
- **THEN** Engine 返回声明所需端口调用或缺失事实的决定，不自行执行平台操作

### Requirement: Runtime 组合领域与平台端口

Runtime MUST 作为唯一组合入口加载工作流、调用 Engine、持久化 Run 与 Trajectory、刷新项目事实并调用平台适配器；CLI 和后续客户端适配器不得复制状态转换规则。

#### Scenario: 文本 CLI 与 JSON CLI 查询同一 Run

- **WHEN** 用户分别请求文本和 JSON 状态
- **THEN** 两种输出由同一个 Runtime 结果渲染，并报告一致的当前步骤、诊断和合法后继

### Requirement: 工作流快照在 Run 内不可变

Runtime MUST 在启动 Run 时规范化工作流包、计算稳定摘要并保存不可变快照；磁盘定义变化不得静默改变进行中的 Run。

#### Scenario: 运行期间工作流定义变化

- **WHEN** 已启动 Run 对应的工作流文件内容发生变化
- **THEN** 现有 Run 继续引用原快照并报告漂移，除非用户显式启动新 Run

#### Scenario: 工作流包无效

- **WHEN** 工作流含未知动作、不可达步骤、非法循环或缺少版本
- **THEN** Runtime 在创建 Run 前拒绝工作流并返回可定位诊断

### Requirement: 每次运行具有独立身份和项目快照

Runtime MUST 为每次运行生成独立 `runId`，并绑定工作流摘要、项目快照摘要、当前状态版本和 Trajectory 引用；一个 Run 的状态或事件不得用于另一个 Run。

#### Scenario: 同一项目启动两个 Run

- **WHEN** 用户基于同一项目快照启动两个工作流
- **THEN** 两个 Run 具有不同身份和隔离存储，任何记录动作都需要明确目标 Run

### Requirement: Trajectory 追加记录运行事实

Runtime MUST 把每次已接受的状态转换记录为版本化、带稳定事件身份的追加式 Trajectory Event，并拒绝陈旧版本、重复副作用和跨 Run 引用。

#### Scenario: 同一记录请求重复提交

- **WHEN** 客户端因超时重试具有相同事件身份的记录请求
- **THEN** Runtime 返回原结果且不重复追加事件或推进状态

#### Scenario: Trajectory 尾部损坏

- **WHEN** Runtime 检测到无法验证的事件、摘要或截断记录
- **THEN** Runtime 停止受影响 Run 并由 doctor 报告损坏位置，不静默删除或重写证据

### Requirement: Checkpoint 支持中断后幂等恢复

Runtime MUST 使用转换 Journal 和原子替换协调 Trajectory、Run State 与 Checkpoint，并在进程于任一写入边界中断后恢复为同一最终状态或明确的人工修复状态。

#### Scenario: 状态写入中途进程退出

- **WHEN** 进程在 Trajectory、Run State 或 Checkpoint 的任一写入边界退出
- **THEN** 下一次 `run resume` 根据 Journal 完成或回滚同一转换，不重复产生业务结果

#### Scenario: 外部仓库事实已经变化

- **WHEN** 恢复时仓库 HEAD、分支、路径或工作树摘要与 Checkpoint 不同
- **THEN** Runtime 返回 reconciliation 差异并使依赖旧事实的决定失效

### Requirement: 公共 CLI 使用稳定输出契约

Repoctopus CLI MUST 提供 `project probe`、`run start`、`run status`、`run next`、`run record`、`run resume` 和 `doctor` 的最小闭环，并为机器调用提供版本化 JSON envelope 和稳定退出码。

#### Scenario: 命令成功

- **WHEN** 客户端使用 `--json` 执行有效命令
- **THEN** 输出包含协议版本、命令、成功状态、Run 身份、结果、诊断和合法下一动作

#### Scenario: 命令失败

- **WHEN** 输入无效、状态损坏或前置事实缺失
- **THEN** CLI 返回非零退出码和结构化错误，不输出伪成功状态

### Requirement: 第三方源码可追溯

从 Comet 复制或实质改写的源码 MUST 保留 MIT 许可证，并在机器可检查清单中记录固定上游 commit、原路径、目标路径、内容摘要和采用方式。

#### Scenario: 来源清单缺失

- **WHEN** 来源检查发现复制文件没有声明或摘要不匹配
- **THEN** 构建验证失败并列出缺失或漂移文件

### Requirement: 产品公共命名统一为 Repoctopus

公共 CLI、运行目录、错误信息、文档和生成文件 MUST 使用 Repoctopus 命名，不得暴露 Comet 的产品命令、状态路径或模块品牌；第三方许可证和来源记录可以保留真实来源名称。

#### Scenario: 构建后执行品牌检查

- **WHEN** 验证扫描公共产物和运行输出
- **THEN** 只有 `third_party`、许可证、来源说明和开发采用报告可以出现 Comet 来源名称
