# delivery-governance Delta

## ADDED Requirements

### Requirement: 外部发布恢复必须区分确定未执行与结果未知

Repoctopus MUST 在执行 MR create-or-observe 时持久化稳定 Publication Intent，并根据平台可证明的执行事实把失败分类为 `not-applied` 或 `unknown`。只有平台明确拒绝且证明请求未执行时，Runtime 才能在后续显式 Archive pull 中以同一 runId、publicationId、repository、base、head 和精确 head OID 再次调用 create；网络/超时、HTTP 5xx、成功响应不可解析、创建后核验失败或其他无法证明未执行的结果 MUST 保持 unknown，只允许观察、采用或人工修复，不得盲重放。

#### Scenario: 平台明确拒绝 MR 创建

- **WHEN** GitHub 或其他 Adapter 返回可证明请求未执行的 4xx 拒绝，并且远端观察仍没有精确匹配 MR
- **THEN** Journal 保留原稳定 intent、operation identity、attempt 和拒绝诊断，回到可显式重试的发布 checkpoint；当前调用不循环重试，修正原因后的下一次 pull 先观察再最多调用 create 一次

#### Scenario: MR 创建响应结果未知

- **WHEN** create 请求发生传输中断、HTTP 5xx、2xx 响应不可解析、创建后 status 核验失败或其他无法证明未执行的错误
- **THEN** Journal 进入 unknown 并保留原 invocation；后续恢复只按 repository/base/head/head OID 观察并采用唯一匹配 MR，零匹配时仍不再次调用 create

#### Scenario: 未知结果后观察到唯一 MR

- **WHEN** Journal 为 unknown，平台随后返回唯一且 repository、base、head 和精确 head OID 全部匹配的 MR
- **THEN** Runtime 以 `recovered` provenance 完成同一 publication item，不创建第二个 MR 或改变 publication identity

#### Scenario: 失败无法分类

- **WHEN** 第三方 Adapter 抛出没有可靠 effect certainty 的异常
- **THEN** Runtime 默认按 unknown fail closed，不从错误 message、HTTP 文本或 Agent 判断推导 not-applied

### Requirement: 发布恢复诊断必须有界且可操作

Repoctopus MUST 为外部发布失败保存受限 stage、certainty、platform code 与恢复动作，并通过 CLI、trace 和审计事件关联原 Work/Publication identity；Metric labels MUST 只使用低基数枚举。Token、Authorization header、Cookie、完整响应 body、带凭据 URL、绝对路径和任意错误 message MUST NOT 进入 Journal、Metric labels 或公开状态。

#### Scenario: 确定未执行需要修正配置

- **WHEN** MR create 因认证、权限、配置、冲突或限流被明确拒绝
- **THEN** CLI 指示操作者修正原因后重新拉取同一 Archive Work，并明确当前调用未自动重试

#### Scenario: 结果未知需要协调

- **WHEN** MR create 的执行结果未知
- **THEN** CLI 指示按原 repository/base/head/head OID 观察、采用唯一人工 MR 或提供权威未执行证明，不建议新建 Run、手改 Store 或直接重放 create
