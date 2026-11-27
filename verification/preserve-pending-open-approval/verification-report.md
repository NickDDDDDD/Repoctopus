# Open 待审请求恢复验证

Tested implementation commit: `aa404c93030a279a9436c4eb0eb0e49d7761f36b`

Package content SHA-256: `84c3d686ae928bb8d156df133e43a2cb1064778ce7e9c1c5158ef1e0cacc4ef3`

Package files: `493`

Package content bytes: `6825027`

## 回归和候选包

- 修复前，真实 CLI 首次重复执行 `run next` 会把仍待审的 Open 从 epoch 1 推进到 epoch 2，并重新派发 `change.intake`。用户没有答复，规格内容也没有变化。
- 修复后，在 Windows 由 `npm run build` 和 `npm pack --ignore-scripts` 生成并安装上述候选包。隔离三仓 Run 生成四类工件，`next → resume → next` 每次使用新进程。原请求 ID、提案摘要和 epoch 1 保持一致，continuation 始终为 `ask`，没有派发新 Work。
- CLI 生命周期回归通过，包含正常 Open 和 Design 批准、真实规格修改使旧答复被拒绝，以及后续 Build 策略检查。另有 44 项相关领域及服务测试通过。TypeScript、Lint、架构和格式检查通过。

本次三仓安装包验收覆盖 Open 的等待与恢复。CodeArts 的文档展示和完整原生审批仍需独立验证。
