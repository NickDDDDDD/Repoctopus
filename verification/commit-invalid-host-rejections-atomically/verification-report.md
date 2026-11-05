# Host 提交原子拒绝验证报告

## 可复现输入

- Change: `commit-invalid-host-rejections-atomically`
- Tested implementation commit: `9abf37fd2fcb75f1105d6a4a57c63e5d23b5e8cc`
- Package: `repoctopus@0.1.0`
- Package files: `458`
- Package content bytes: `5639659`
- Package content SHA-256: `763f540e539713ecc1f88259cfe8f092c6df2227a45b8cadc340d8e98c3ddd4d`
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
- 修复约束本版本处理的提交，已由旧 Runtime 写入的半截非法 `submitted` checkpoint
  不在恢复验证范围，未增加旧版本迁移。
- 修改前全量基线曾有一次 Windows Desktop activation 失败，单独重跑 2 项通过。
- Comet 验证阶段使用独立报告入口与实际命令收据。包摘要通过正式
  `check:managed-execution-report` 重新计算。摘要用的临时 tarball 和专用目录已删除。
