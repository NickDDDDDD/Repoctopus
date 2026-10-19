# runtime-foundation Specification

## Purpose

定义 Repoctopus 首个可运行 Runtime 的 Engine 边界、工作流快照、Run、确定性解析、持久化、恢复、CLI 和第三方来源治理。

## Requirements

### Requirement: Engine 保持确定性和平台无关

Engine MUST 只根据版本化 Run、工作流快照、领域事件和证据投影计算决定及下一状态，不得直接读取文件、执行进程、访问 Git、调用网络或依赖具体 IDE、托管平台和可观测后端。

#### Scenario: 相同输入重复解析

- **WHEN** Engine 使用相同工作流快照、Run、事件和证据执行两次解析
- **THEN** 两次结果具有相同决定、下一状态、诊断和待执行动作

#### Scenario: 平台操作尚未完成

- **WHEN** Engine 需要外部 Git 或文件事实才能继续
- **THEN** Engine 返回声明所需端口调用或缺失事实的决定，不自行执行平台操作

### Requirement: WorkflowRuns 协调工作流用例与平台端口

WorkflowRuns MUST 作为 Cordis Service 加载持久化 Run、调用纯 Engine、在 RunStore 事务内核对事实并协调 Evidence 与 Action Service；CLI、Evidence、Delivery 和 Adapter 不得复制工作流状态转换规则、直接写 Run 或建立产品级 Runtime。

#### Scenario: 文本 CLI 与 JSON CLI 查询同一 Run

- **WHEN** 用户分别请求文本和 JSON 状态
- **THEN** 两种输出由同一个 WorkflowRuns 查询结果渲染，并报告一致的当前步骤、诊断和合法后继

#### Scenario: 普通成功记录尝试绕过 Evidence

- **WHEN** 当前工作流步骤声明需要 Evidence Profile 且调用方只提交普通 `succeeded` 结果
- **THEN** WorkflowRuns 拒绝推进，直到同一项目输入和 Run 下存在 `satisfied` Gate

#### Scenario: 公共入口缺少产品 Service

- **WHEN** CLI、IDE 或 API 请求 Run 能力但当前 Context 没有活动 WorkflowRuns Service
- **THEN** 入口返回结构化不可用诊断，不回退到直接实例化或隐藏兼容实现

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

从 Comet、Cordis 或其他第三方项目复制、内嵌或实质改写的源码 MUST 保留适用许可证，并在机器可检查清单中记录固定上游 commit、原路径、目标路径、内容摘要和采用方式；声明为未修改快照的目录必须与登记的上游内容一致。

#### Scenario: 来源清单缺失

- **WHEN** 来源检查发现复制文件没有声明或摘要不匹配
- **THEN** 构建验证失败并列出缺失或漂移文件

#### Scenario: 未修改快照出现产品补丁

- **WHEN** Cordis Core 或 Loader 快照包含未登记的本地改动
- **THEN** 来源检查失败并要求把产品扩展移出第三方目录，或通过独立评审明确登记 fork

### Requirement: 产品公共命名统一为 Repoctopus

公共 CLI、运行目录、错误信息、文档和生成文件 MUST 使用 Repoctopus 命名，不得暴露 Comet 的产品命令、状态路径或模块品牌；第三方许可证和来源记录可以保留真实来源名称。

#### Scenario: 构建后执行品牌检查

- **WHEN** 验证扫描公共产物和运行输出
- **THEN** 只有 `third_party`、许可证、来源说明和开发采用报告可以出现 Comet 来源名称

### Requirement: 能力来源和旧工作流隔离可机器检查

Repoctopus MUST 为全部生产源码声明唯一能力归属和采用方式，登记从 Comet 复制、实质改写或行为重建的边界，并拒绝旧 `agents-workspace` 的 Hook、Skill、阶段常量、批准口令、客户端配置和项目专有路径进入产品面。

#### Scenario: 新增生产模块没有能力归属

- **WHEN** `app`、`domains` 或 `platform` 出现未被能力账本唯一覆盖的源码
- **THEN** 架构检查失败并报告缺失或冲突的能力归属

#### Scenario: 旧工作流文件或口令被复制

- **WHEN** 产品目录出现旧 Hook、旧阶段常量、中文动作批准口令或旧模板配置路径
- **THEN** 架构检查失败并定位文件或路径

### Requirement: Engine 保持纯函数且 Run 保持持久化 Aggregate

Workflow Engine MUST 只根据 Workflow、Run State 和已经核对的领域事实计算下一状态、Action Intent 或拒绝原因，不读取 Cordis Context、文件、Git、时钟或网络；Run 必须由持久化事实表示，不得依赖长生命周期 Fiber 或旧进程内存继续存在。

#### Scenario: 同一输入重复执行 Engine

- **WHEN** Engine 接收相同 Workflow、Run State 和领域事实
- **THEN** 每次返回语义相同的状态转换或拒绝结果

#### Scenario: 进程在 Run 中途退出

- **WHEN** 一个跨多日 Run 所属进程退出后由新进程恢复
- **THEN** WorkflowRuns 从 Store、Journal 与 Checkpoint 重建当前状态，不要求恢复旧 Fiber

### Requirement: RunStore 拥有受保护转换闭包

RunStore MUST 为每个 Run 提供跨进程写锁、Transition Journal、状态版本比较、幂等事件检查、原子提交、Trajectory、Checkpoint、崩溃重放和修复诊断；所有 Run 写入必须通过 `RunStore.transaction()` 完成。

#### Scenario: 两个执行者并发推进同一 Run

- **WHEN** 两个进程同时请求改变同一个 Run
- **THEN** RunStore 串行化写事务，后进入者基于最新状态版本重新核对前置条件

#### Scenario: 原子替换前进程崩溃

- **WHEN** Transition Journal 已记录意图但新状态尚未完成原子提交
- **THEN** 下次启动按 Journal 恢复到唯一可解释状态，并保持幂等

#### Scenario: 调用方绕过事务写状态

- **WHEN** 生产代码尝试直接写入 Run State、Trajectory 或 Checkpoint
- **THEN** 架构检查或 Store 边界测试拒绝该写入路径

### Requirement: 外部动作使用 Intent 与 Receipt 分隔事务

WorkflowRuns MUST 在第一笔 Run 事务中提交 `action.proposed` 与稳定幂等键，释放 Run 锁后由 ActionDispatcher 记录 Intent、调用 Contributor Adapter 并保存 Receipt，再在第二笔 Run 事务中核对待处理 Action、Receipt 和所需 Evidence 后提交 Outcome；外部副作用不得在 Run 锁内执行。

#### Scenario: Manual Action 完成

- **WHEN** 用户对待处理 Manual Intent 提交一个有效结果
- **THEN** ActionDispatcher 保存 Receipt，WorkflowRuns 在新的事务中核对并推进 Run

#### Scenario: 执行外部动作时进程崩溃

- **WHEN** Intent 已持久化但 Receipt 尚未保存时进程退出
- **THEN** 恢复流程使用幂等键确定重试、查询或人工处理，不重复生成新的逻辑 Action

#### Scenario: Adapter 在 Run 锁内等待外部系统

- **WHEN** 实现尝试在 RunStore transaction 内执行命令、网络、浏览器或人工等待
- **THEN** 边界测试拒绝该实现

### Requirement: Run 和恢复绑定 composition 快照

WorkflowRuns MUST 在创建 Run 时保存规范化 composition digest 与影响语义的 Provider、Contributor 身份，并在恢复、Evidence 接受和每次写转换前重新核对；组合变化不得静默改变进行中的 Run。

#### Scenario: 普通插件在中断期间升级

- **WHEN** 恢复时插件版本或代码摘要与 Run 的 composition 快照不同
- **THEN** WorkflowRuns 报告逐插件漂移并按兼容声明记录变化或进入 `migration_required`

#### Scenario: 组合只有非语义顺序差异

- **WHEN** 两个 composition 仅有不影响插件身份和配置值的键顺序差异
- **THEN** 规范化 composition digest 保持相同

### Requirement: App Host 只负责启动和传递请求

Repoctopus App Host MUST 只负责创建 Cordis Context、加载 composition、检查入口就绪、传递公共请求和关闭插件树，不得拥有工作流阶段、Evidence Gate、Action 策略或项目探测领域规则。

#### Scenario: Host 关闭运行中的插件树

- **WHEN** CLI 完成请求或进程收到受控关闭信号
- **THEN** Host 发起有界排空并等待 Cordis Fiber 清理，不逐个硬编码平台资源释放顺序
