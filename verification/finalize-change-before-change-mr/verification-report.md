# finalize-change-before-change-mr 验证报告

## 报告状态

- 结论：实现满足已批准的 Proposal、Design、Delta Specs 和 Tasks；任务 1.1 至 6.1 已完成，6.2 正在执行真实自举交付。
- 验证日期：2026-10-22。
- 已验证实现分支：`feat/finalize-change-before-change-mr`。
- 已验证实现提交：`be3b453bf6bf546ecd7e09964a5af8d1a1010dea`。
- 已验证实现代码树：`6b382527eda29b6a90345efebe1633fd06d5bde1`。
- Change 分支：`spec/finalize-change-before-change-mr`。
- 已批准 Change 分支 OID：`bd87931b2453f0187254ccb9c39e641c6886cab1`。
- 目标分支：`main`，验证时远端 OID 为 `8cc7b7befbfa4ef667ffa4827156b146069d439e`。
- 验证时 Business MR 与 Change MR 均不存在；本报告用于默认单 Business MR 的 Delivery approval，最终 Change MR 只能在 Post-merge 关闭后创建。

## 规划批准

- Request ID：`4406b055-4f37-48f5-b510-6571bc1a00d9`。
- Snapshot digest：`sha256:a3e733e47d804215a55d733de12c0f56b54acc01749337efed42a1ccba9b0344`。
- 决定：`approve`。
- 可信操作者：`User`，入口：CLI。
- OpenSpec Provider：1.14.3。
- 规划产物：Proposal、Design、Delta Specs、Tasks 四项齐全并通过严格校验。
- 影响能力：`delivery-governance`、`post-merge-automation`、`specification-authority`。

## 自动验证

| 验证                       | 结果                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run verify`           | 通过；99 个测试文件，420 个测试通过，1 个 Windows 条件测试跳过                                                |
| TypeScript                 | 主进程与 Desktop Renderer 类型检查通过                                                                        |
| ESLint                     | 通过                                                                                                          |
| Build                      | CLI 与 Desktop Renderer 构建通过                                                                              |
| `check:generated`          | 通过                                                                                                          |
| `check:brand`              | 通过                                                                                                          |
| `check:architecture`       | 通过；210 个生产源文件、21 个能力所有者和受保护边界通过                                                       |
| `check:provenance`         | 通过；20 个 Comet 派生文件、60 个 Cordis 文件、24 个 Matt Skill 文件、8 个 DSH 包和 5 个 DSH Desktop 参考通过 |
| `spec:validate`            | 通过；13 项严格校验，0 失败                                                                                   |
| `npm run test:package-e2e` | 通过；隔离安装与打包 CLI E2E 1/1                                                                              |
| Final/Post-merge 专项 E2E  | 通过；2 个测试文件、2 个独立进程测试通过                                                                      |

唯一跳过项是已有的 Windows 条件竞态测试；本次没有新增跳过、放宽超时或削弱断言。

## 自举发现与修复

第一次 Delivery checkpoint 在任何 Git 副作用前拒绝了已批准规划，原因是规划 worktree 与业务 worktree 的 composition digest 不一致。调查确认原摘要直接包含插件运行时绝对 `productRoot` 和 `workspaceRoot`，导致相同代码、配置和插件在不同安装目录或 worktree 中产生不同身份。

修复将插件的实际运行配置与身份配置分离：Cordis Provider 继续接收真实绝对路径，composition 和插件 config digest 则使用稳定的 `@repoctopus/product-root` 与 `@repoctopus/workspace-root` 逻辑位置。新增测试同时改变产品安装目录和 Workspace 目录，证明 composition digest 与全部插件身份保持一致，而插件实际接收的路径仍指向各自运行目录。

该修复以 `be3b453bf6bf546ecd7e09964a5af8d1a1010dea` 提交并立即推送。修复后的完整 `npm run verify`、包 E2E 和两条 Post-merge E2E 均重新执行并通过；没有绕过或放宽规划批准门禁。

## 正式 Evidence

- Profile：`verify`。
- 必需检查：`typecheck`、`architecture`。
- 可信等级：`verified`，新鲜度：`fresh`。
- 预期结果：`passed`，Gate：`satisfied`。

初次 Evidence Bundle 在自举门禁发现 composition 身份缺陷前生成，因实现发生修复而不再用于 Delivery。最终 Bundle 在本报告内容固定后重新生成，并由 Delivery snapshot 持久绑定；Bundle/Receipt ID 保存在权威 Evidence Store 和 Delivery Journal 中，避免让报告正文递归参与自身 Evidence fingerprint。

## 关键结论

- 共享项目配置只生成 `merge_target + commit + push + merge_request.create_or_recover`；旧 `update-existing` 在 composition 启动前被拒绝。
- Delivery v3 的规划阶段只要求公开 Change 分支和人工规划批准，不创建 Change MR。
- 默认交付只声明一个 `primary` Business MR；多个 Business MR 仍需要结构化拆分理由。
- 历史 schema-v1 Closure Journal 的恢复通过显式旧策略测试，不允许当前项目配置重新生成旧策略。
- 最终 Change MR 的创建继续受 Post-merge Evidence、OpenSpec 关闭、普通 push 和 create-or-recover Receipt 约束，Runtime 不执行 merge。

## 下一门禁

Delivery prepare 将把本报告、正式 Evidence Bundle、单 Business MR Intent、业务分支精确 head/tree、Change 分支 OID、目标分支 OID、配置和 composition 摘要绑定为第二个人工批准请求。只有该请求由可信用户批准后，Repoctopus 才能创建 Business MR。
