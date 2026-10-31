# Tasks

## 1. Receipt 基础与反作弊

- [ ] 1.1 为 consumed 冒充方法执行、占位 Evidence、输入漂移和最终文件存在反推方法通过增加 red tests。
- [ ] 1.2 定义版本化 `MethodReceiptEnvelope`、内容寻址 payload、Validator registry 与 Evidence resolver；运行领域单测。

## 2. Open 纵切

- [ ] 2.1 定义 `OpenMethodReceipt` 的事实类别、frontier、decision references、零提问理由和四件套摘要；运行 schema 单测。
- [ ] 2.2 实现 Open Validator，重新核对当前 Work/packet、Evidence 与 planning snapshot；运行完整 PRD 冲突、零提问和误问环境事实测试。
- [ ] 2.3 把 Receipt 提交、验证和 `method_verified` 接入 Open Work/Gate，同时保持独立 Open Human Decision；运行状态机与恢复测试。

## 3. 观测与验收

- [ ] 3.1 增加 Trajectory/OTLP 映射、隐私和基数测试，确认 rejected reason 可审计且无内容泄漏。
- [ ] 3.2 更新 Desktop projection/UI，区分 consumed、method verified、incomplete 和 rejected；运行 reducer、组件与 Windows 测试。
- [ ] 3.3 更新文档，用真实 Open change 覆盖代码事实冲突与零问题路径，运行 `npm run spec:validate`、相关 E2E、`npm run verify` 并生成正式验证报告。
