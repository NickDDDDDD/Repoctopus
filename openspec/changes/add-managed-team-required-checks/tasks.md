# Tasks

## 1. 固定边界

- [ ] 1.1 为 extension 只注册未调度、绕过请求被拒绝和现有 Work 执行链增加 characterization tests；运行 lifecycle contributor/managed execution tests。
- [ ] 1.2 为未知 checkpoint、缺 Validator、transition 请求、Gate bypass、越权 scope 和不兼容恢复增加 red tests。

## 2. 编译与准入

- [ ] 2.1 扩展共享 binding Schema 和 Compiler 以支持 `required-check`，输出稳定 Contributor/Work/Validator identity；运行配置与领域单测。
- [ ] 2.2 完成插件 Descriptor 静态准入、唯一解析、来源/代码摘要和兼容范围校验；运行未登记、重复和漂移测试。

## 3. 生产调度纵切

- [ ] 3.1 在 definition 安全 checkpoint 物化 required-check Work，并通过现有 Dispatcher、Host、Outcome、Validator、Evidence 链执行；运行单仓纵切。
- [ ] 3.2 由核心 lifecycle handler 聚合检查 Gate，覆盖成功、失败、重试、Build 返工与核心 Action 不被篡改；运行状态机测试。
- [ ] 3.3 完成多仓 selector/write scope、重启、卸载排空和不兼容 Contributor 恢复测试。

## 4. 可观测与验收

- [ ] 4.1 增加版本化 Trajectory/OTLP 事件和隐私/基数测试，观察检查全链路可重放。
- [ ] 4.2 更新 Desktop projection/UI，展示 checkpoint、检查状态和独立阻断原因；运行 reducer、组件和 Windows 测试。
- [ ] 4.3 更新文档，运行 `npm run spec:validate`、相关 E2E 与 `npm run verify`，生成正式验证报告并清理临时产物。
