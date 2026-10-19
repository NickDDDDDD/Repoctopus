# 验证报告

## 验证对象

- Change：`adopt-cordis-plugin-kernel`
- 分支：`refactor/adopt-cordis-plugin-kernel`
- 最终自举 composition：`sha256:55f3d08c0b5b495ddb1c4c27dd361c23fb0ca64f4f91ee5ad0a071dfe38a2322`
- 验证日期：2026-10-19

## 结论

实现与本 change 的 Proposal、Design 和 Delta Specs 一致。Cordis 是唯一应用 Runtime；Repoctopus 的 Engine 保持纯函数，产品能力由 Service、Provider 与 Contributor 组成。公共 CLI 已统一通过 App Boot 和 CommandRouter，旧产品 Runtime 与直接组合根已经删除。

Run、Evidence、Action、Delivery、Checkpoint、Trajectory 和遥测均绑定 composition 身份。Evidence Gate 在 RunStore 事务内重新核对；Delivery 只接受相同 composition 的合格 Bundle。团队插件在模块导入前完成 Descriptor、代码摘要和静态配置 Schema 准入。

## 自动验证

| 验证                           | 结果                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `npm run format:check`         | 通过；第三方不可变源码由 `.prettierignore` 排除，改由 provenance 检查 |
| `npm run verify`               | 通过；57 个测试文件，171 个测试通过，1 个平台条件测试跳过             |
| TypeScript、ESLint、确定性构建 | 通过                                                                  |
| 品牌与架构治理                 | 通过；136 个生产源文件、16 个能力所有者                               |
| 第三方来源                     | 通过；20 个 Comet 派生文件与 60 个不可变 Cordis 文件                  |
| OpenSpec 严格校验              | 通过；8 项规格或 change，0 失败                                       |
| `npm run test:package-e2e`     | 通过；隔离目录安装与最小 CLI 闭环成功                                 |
| `npm run test:tracer-e2e`      | 通过；OTel 关联闭环成功                                               |

Windows 跳过项是 `filesystem-safety.test.ts` 中“读取期间普通文件路径被替换”的竞态测试。Windows 与 POSIX 对已打开文件的重命名和替换语义不同，该测试夹具无法在 Windows 上稳定制造对应竞态；同文件中的临时文件篡改与父目录 Junction 逃逸测试已在 Windows 正常执行。POSIX 路径替换场景应由 Linux CI 覆盖。

## 自举与恢复

- 仓库根目录的 `repoctopus.yaml` 成功启动正式 Project composition。
- Run `self-adopt-cordis-release-20261019` 完成 `inspect → execute → verify`。
- Evidence Attempt `self-release-verify-20261019` 执行类型检查与架构检查，Bundle `257baf538049ea764394d872da597247e07807ec65f98b2c9cbd08545b289407` 结果为 `passed`，Gate 为 `satisfied`。
- Run 最终状态为 `completed`，`stateVersion` 为 6，Trajectory 长度为 7，并接受上述 Bundle。
- Attempt `self-interrupted-evidence` 在持久上下文建立后被强制终止；`evidence resume` 恢复出 `incomplete` Bundle 与 blocked Gate，没有重跑或伪造成功。
- `test/self-bootstrap.test.ts` 从正式配置启动 project composition，使用 Loader 重载 command Evidence Contributor，并在 `unloading → active` 后再次解析 `verify` Profile。

## 生命周期与可信边界

- App Boot 关闭先清空 Loader composition 并等待子 Fiber disposer，再释放根 Context。
- WorkflowRuns、EvidenceCoordinator 与 Delivery 在卸载时停止接纳新操作并有界排空；超时记录 `OPERATION_DRAIN_TIMEOUT` 与恢复分类。
- 生命周期事件批量导出到 OTLP；未配置端点时使用空实现，导出失败经过固定两次尝试后记录 `dropped_after_retry`，不保留后端错误正文，也不修改领域事实。
- 团队插件静态配置 Schema 支持 `type`、`properties`、`required`、`additionalProperties`、`items`、`enum` 与 `const`；其他关键字 fail-closed。

## 待用户决定

本报告只请求确认本次实现和验证结果。确认前不执行 commit、push 或 MR 操作。

## 合入后复验

- 用户批准报告后，实施内容通过 PR #6 合入 `main`，merge commit 为 `f41ae91a58248a55e1c923693538aecf1701a634`。
- 本地 `main` 快进到该提交后重新执行 `npm run verify`：57 个测试文件通过，171 个测试通过，1 个 Windows 条件测试跳过；类型检查、Lint、构建、架构、来源与 OpenSpec 校验全部通过。
- `npm run test:package-e2e` 与 `npm run test:tracer-e2e` 在合入后的 `main` 再次通过。
- 主分支复验通过后，delta specs 已同步到主规格，本 change 归档为 `2026-10-19-adopt-cordis-plugin-kernel`。
