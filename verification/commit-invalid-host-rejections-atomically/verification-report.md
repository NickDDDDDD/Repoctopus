# Host 提交原子拒绝验证报告

## 可复现输入

- Change: `commit-invalid-host-rejections-atomically`
- Tested implementation commit: `cef9dea8c70b06f859c5188171f5c3f1ba1453ab`
- Package: `repoctopus@0.1.0`
- Package files: `458`
- Package content bytes: `5643482`
- Package content SHA-256: `bf2518f2258060514344dc7cd02e046863eca566a943c2ccab3b499db81aad19`
- 平台为 Windows x64，Node.js `24.21.0`，控制器为 `@rpamis/comet@0.5.1`。

## 中断与恢复

回归用例在生产组合的真实 Run Store 第一次提交该非法 submission 后模拟中断。旧实现
重启后的 `next` 会把错误状态格式的诊断投影当成 Host 失败，得到 `outcome/wait`。
修复将有界原始提交、拒绝事件与 `invoking/awaiting-correction` 一起提交。重启后
保留原 claim、packet、attempt、checkEpoch 和 invocation，没有非法 Action Outcome
或 Receipt。原样重放返回原拒绝结果及完成时间，内容冲突被拒绝。修正版以新 ID 提交，
重复发送后仍只产生一条接受事件，Run 继续到 Archive。

参考 Comet 固定版本 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的
`domains/engine/runtime-service.ts` 中 `recordOutcomeInternal` 的同一 mutation
记录拒绝并保留原 Action 的做法。Repoctopus 继续保留可归属且有界的原始输入以供审计。

## 检查与边界

- `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 通过。
- Managed Work Executor、Work Submission、Work Recovery 和 Composition 定向检查共 83 项通过。
- 独立审查发现的并发覆盖风险由当前 checkpoint guard 拦截。测试覆盖已保留另一份待处理
  候选和外部副作用仍在核对的两种 `unknown` 状态，以及接受补交后对历史拒绝 ID 的重放。
- 验收另从已持久化的半截非法 `submitted` checkpoint 冷启动。Runtime 在生成 Receipt
  前以提交 ID 和摘要核对当前候选，再将有界原始 envelope 转为拒绝记录。迟到的
  reconciliation `unknown` 保留已落盘的拒绝和修正版。Host 明确提交的 `unknown`
  只有与当前候选的 ID 和摘要匹配时才进入 reconciliation。独立复审通过。
- 已错误终态化的旧 Run 在本次修复范围之外。
- 修改前全量基线曾有一次 Windows Desktop activation 失败，单独重跑 2 项通过。
- Comet 验证阶段使用独立报告入口与实际命令收据。包摘要通过正式
  `check:managed-execution-report` 重新计算。摘要用的临时 tarball 和专用目录已删除。
