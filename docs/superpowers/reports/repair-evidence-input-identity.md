# Evidence 输入身份验证记录

本文件是当前 Comet Change 的实际验证记录；完整集成与安装包验收完成前不作交付声明。

## 生产失败基线

2026-11-07，实施前提交 `5a92ebc` 加入真实生产组合回归，运行：

```powershell
node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'
```

103.48 秒后，在 `test/managed-change-execution.e2e.test.ts:2162` 失败。断言要求 Verify 已通过后仅提交 Runtime 任务完成复选框仍处于 Archive，实际返回 Verify。原测试存在自动再跑 Verify 的 fallback，遮盖了该问题。本次保留原业务、任务完成收据和生产 Provider，以实际 Archive prepare 结果断言。

原实验项目第一次 Attempt 指纹为 `6261a7ee9faa0ebb9af845505cbfbffbe21a5ab84bbe8666cc17f0638b18809b`，第二次为 `b147d9ceff741eb8faac0ec54c2be418047170a885bda1d95f6969e8a38ed745`。第一次已读到完成状态的 dirty 文件；提交后有效字节不变，但 HEAD/tree/dirty 表示变化。根因与未接线的依赖模型已记录在同一 Change 的 design.md。

只读复核原 Store：两个 Bundle 各有六个 `command/local`、fresh Receipt，合计执行十二次命令。第二次重复的六项为 front-release-label、backend-release-channel、backend-verify、web-front-build、web-design-build、web-plugin-build。该复核未修改原验收现场。

## 分段 TDD

- `command.inputs` 初始两个正向测试因 unknown fields: inputs 失败，其余十个非法声明测试通过；实现后十二项通过。
- 内容采集覆盖 dirty→index→commit 同字节身份、真实内容变化、显式 ignored 输入和集合读取竞态，三项通过。
- 第一段独立审查发现跨次 Tasks 投影、glob 交叠样本漏判、symlink 目标遗漏、默认 ignored 输入遗漏。修正并补充交叠与默认输入测试后，三个相关测试文件 22 项通过；一项 symlink 测试因当前 Windows 缺少创建链接权限明确跳过。
- 首次生产接线后，同一两仓场景通过原 Archive 保留 Gate/Bundle 的回归断言并完成发布，最后因原测试仍期待额外一次 `evidence.verify` 调用而失败。后续移除旧 fallback 及对应重复调用预期，不把该次运行记为全项通过。
