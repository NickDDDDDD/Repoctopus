# Tasks

## 1. 平台中立的 Execution Binding 测试夹具

- [x] 1.1 增加统一的宿主绝对路径测试工厂，并用 `vitest run test/build-protocol-domain.test.ts test/build-strategy-binding-domain.test.ts` 验证其在当前宿主生成 `path.isAbsolute() === true` 的路径且不改变语义摘要断言 <!-- comet-task:ea6fec2c-a4f3-4707-ab89-769878a746d9 -->
- [x] 1.2 将 lifecycle、runtime、workspace、protected-branch 与 orchestration 测试中的固定 Windows checkout 替换为同一工厂，并用对应 Vitest 文件验证 repository ID、拓扑、branch、HEAD 与漂移分类断言保持不变 <!-- comet-task:66fdae3e-2cc7-44d8-a711-f692b979aa81 -->

## 2. Windows Desktop discovery 路径语义

- [x] 2.1 以现有 Windows 路径用例作为回归基线，补充 override 规范化与非绝对路径拒绝断言，并确认未修实现会在非 Windows `node:path` 语义下失败 <!-- comet-task:c500e361-c794-462a-a256-7d0fd42c8d1b -->
- [x] 2.2 将 discovery root 计算限定为 `path.win32`，并用 `vitest run test/desktop-receiver-discovery.test.ts` 验证 `LOCALAPPDATA`、override 和拒绝分支 <!-- comet-task:85e0f1e4-0652-4e4b-b325-47d193164c56 -->

## 3. POSIX recovered termination 确认

- [ ] 3.1 为 POSIX 终止增加有界确认测试，覆盖确认退出与截止时间内仍存活两种结果，并用相关 Vitest 用例保存 RED 证据 <!-- comet-task:66d6b6dc-2cc1-4008-a1c1-c22dd67bf0ef -->
- [ ] 3.2 在 `platform/process` 实现条件轮询，使 `terminated` 只在确认退出后返回，超时保持保守结果；用进程树与 managed service recovery 测试验证 GREEN 且不改变 Windows `taskkill` 路径 <!-- comet-task:8ed392c6-4553-4232-8041-a50ba47d8892 -->

## 4. 集成验证与 PR 门禁

- [ ] 4.1 运行受影响测试集合、`npm run typecheck`、`npm run lint` 与 `npm run spec:validate`，确认本 change 与既有规格一致 <!-- comet-task:96a93066-24e0-4c52-8e4b-4a945a89e407 -->
- [ ] 4.2 运行本地 Windows `npm run verify`，记录完整测试数量、跳过项与退出状态到正式验证报告 <!-- comet-task:2fe415c6-5063-430e-9cc6-6342dce705d2 -->
- [ ] 4.3 推送当前公开分支并确认 PR #66 的 GitHub Linux `verify` 对精确新 HEAD 成功；检查仍失败时保留 change 开放并按失败证据修复，不绕过门禁合入 <!-- comet-task:48e16b0c-ae66-4764-a19d-1f0d2ebe95ec -->

## Workflow follow-up

- Verify 通过并完成独立审查后归档本 change。
- PR #66 远端检查转绿后再合入 `main`，随后从最新 `main` 启动全新模拟多仓验收。
