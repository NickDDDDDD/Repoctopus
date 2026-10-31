# Design

## Context

当前 Host outcome 提供 `consumedLayerDigests`，Work Validator 可核对 packet 消费，但没有结构化方法证据。Open 的核心风险不是“是否加载 grilling”，而是是否先验证可访问事实、识别冲突，并只把真正的语义选择留给人。

## Decisions

### 1. Receipt 是引用机器证据的声明

`MethodReceiptEnvelope` 绑定 schema、method/validator identity、Run、Work、Host invocation、input/packet/layer digest、payload digest 和 Evidence references。Payload 内容寻址存储，Validator 从 Evidence Store 重新解析；自由摘要不能满足 Gate。

### 2. Open Receipt 记录有界事实类别

`OpenMethodReceipt` 记录已检查的 repository、现有 specification、project config 和 Provider facts 及摘要，发现的冲突、未决 frontier、decision references、零提问理由，以及 proposal/delta specs/design/tasks 摘要。它不保存原始对话或思考过程。

### 3. Validator 独立核对当前输入

Validator 确认 Receipt 与当前 Work/packet/Evidence 匹配，definition 要求的事实类别已覆盖，四件套摘要与当前 planning snapshot 一致。可从授权环境获得的事实若被转问用户则拒绝；真正的产品语义选择可以保留为 frontier。

### 4. 方法验证不替代人工批准

`method_verified` 只说明 Open 方法合同通过。Open 仍在既有 Human Decision 边界等待用户审查需求、范围和四件套初稿；Runtime Validator 通过后才允许建立/接受该决定。

### 5. 遥测不泄漏内容

记录 receipt submitted/accepted/rejected、method identity、Validator、duration 和有界原因。事实摘要、Prompt、对话、源码片段、本机路径和个人身份不导出。

## Recovery and Failure

Receipt 输入漂移、Evidence 缺失或 Validator 版本不兼容时，旧 `method_verified` 精确失效并重新执行当前 Open Work，不创建第二 Run。原 Receipt/Evidence 保持不可变。

## Stop Conditions

- 事实核对需要保存或上传原始 Prompt/思考过程；
- Open Validator 无法从受信 Evidence 独立核对当前 planning snapshot；
- Method Gate 会绕过或合并既有 Open Human Decision。
