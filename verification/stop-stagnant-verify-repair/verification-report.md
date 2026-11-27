# Verify 重复返工验证

Tested implementation commit: `577d7b6ecd46cdfcfbf41bdae41bf6a09fe2e051`

Package content SHA-256: `42bb1a78108d237da7b6c22ed9d4639a0994b6443f3593fd7234f273c50d69fd`

Package files: `493`

Package content bytes: `6888036`

Windows 候选 tgz 的 SHA-256 为 `f4929ff0d654014bdac943110fc7441e9b003479640d8958bca1d6f44c66e197`。

## v0.1.5 反例

发布包在 Windows 五仓实验的 Verify epoch 14 和 20 两次执行真实机器检查。两个 Attempt 和 Bundle 各自独立，声明的实际输入指纹仍为 `7962265dcf529592e203bdb6dca2f2fa13bddb49d5604e92f9430aff96e8eabe`，均在 `check-a` 失败。Runtime 先后在 epoch 15 和 21 派发 Build Plan。B、C、D 的完成事实保留。GitHub #120 报告者的首次失败仍缺原始机器证据。

## 实现边界

Comet Native 将可信失败范围归纳为签名，持久化暂停并限制明确续行。Repoctopus 沿用 Evidence 的声明输入与实际消费的上游内容，首次失败继续局部返工。再次失败且同一输入和失败范围得到证明时，Runtime 在当前 Verify 写入等待。每次显式答复只授权所展示工作包的一轮返工。独立审查复核了旧 Attempt 拦截、预留与 Work 替换共用的 Run 守卫，以及等待期间范围变化后的原批准失效。[Comet 失败签名与停滞判定](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/comet-native/native-repair-stagnation.ts#L121)

## 候选包验收

在 Windows 将候选 tgz 安装到独立目录，用公开 CLI 初始化五个真实 Git 仓的实验环境。Workspace 使用独立 OpenSpec Store，四个业务仓使用本地 bare 远端。

- Verify epoch 14 首次在 `check-a` 失败并正常进入局部 Build 返工。第二轮在 Verify epoch 20 由独立 CLI 进程完成机器检查，Lifecycle 仍等待结算。新进程以不同 Attempt ID 请求 Verify 时，Runtime 找回 `candidate-recovery-proof` 和原 Bundle `848bdcdf4eac2fa11137ece11f12790a44ed54a191af9620a70494eb0026addc`，停在同一 Work `verify:541bd47f9ae6` 和 epoch 20。
- 另起进程执行 `status`、`resume`、`next` 和显式 `verify`，均看到同一个等待请求。低层 `evidence run --workflow-run` 拒绝执行，机器检查日志没有新增。批准一轮返工后进入 Build Plan epoch 21。重复提交同一答复返回原接受事实，Work ID 保持不变。
- A 写入真实修复并完成受管工作包。向新 Verify 提交旧 Attempt 得到 `change.verify-attempt-not-current`，Work 和 epoch 保持原样。随后真正的机器检查通过，同一 Run 进入 Archive epoch 27。A 的工作包和机器节点各执行三次，B、C、D 各执行一次并保留各自原完成 ID。

## 自动化检查

- `npm run verify` 完整通过。Vitest 215 个文件通过、1 个跳过，1336 项测试通过、4 项跳过。CLI 与 Desktop 类型检查、lint、构建、生成物、品牌、架构、来源、Dashboard、OpenSpec 和制品验证报告均通过。OpenSpec 严格校验为 16/16。
- 产品回归先证明显式 Verify 无法返回暂停中的原 Attempt。实现后，回归覆盖暂停投影、失败签名区分实际输入和运行 ID、原请求答复重放，以及独立 Evidence 所有权。
- 实包预演发现 Cordis 需要用延迟服务获取来访问 Runtime 的预留守卫。修正后重新安装最终候选，并从新实验环境跑完上述五仓场景。
