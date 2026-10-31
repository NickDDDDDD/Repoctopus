# Tasks

## 1. 固定反作弊基线

- [ ] 1.1 为最终成功冒充 TDD、同一 receipt 充当 RED/GREEN、占位 identity、无关基础设施失败和输入漂移增加 red tests。
- [ ] 1.2 定义 `TddCycleReceipt` schema、失败分类和与通用 Method Receipt 的绑定；运行领域单测。

## 2. TDD 纵切

- [ ] 2.1 实现 Evidence resolver/Validator，解析 RED、GREEN、regression 命令输入、结果和时间关系；运行真实与伪造循环测试。
- [ ] 2.2 将 `tddMode=tdd` 的 Receipt 接入 package Execute/Check Gate，保持 direct 模式测试、Check、Verify 不降级；运行 Build 状态机测试。
- [ ] 2.3 覆盖多 package、多仓、部分返工、重启和输入漂移，确认只精确失效受影响循环。

## 3. 观测与验收

- [ ] 3.1 增加 Trajectory/OTLP、隐私和基数测试，区分 consumed、method verified、incomplete 和 rejected。
- [ ] 3.2 更新 Desktop projection/UI，展示 TDD 循环状态与有界失败类别；运行 reducer、组件与 Windows 测试。
- [ ] 3.3 更新文档，用真实先红后绿和 direct 路径执行 E2E，运行 `npm run spec:validate`、`npm run verify` 并生成正式验证报告。
