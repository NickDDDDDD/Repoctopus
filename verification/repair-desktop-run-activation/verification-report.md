# Desktop Run Activation Verification Report

## Reproducible subject

- Change: `repair-desktop-run-activation`
- Tested implementation commit: `ad9356296c8a508c11e8a25b540641f0863264b5`
- Package: `repoctopus@0.1.0`
- Package bytes: `937473`
- Package SHA-256: `1a39af10bbf38e5790f3f648418c707195e855b8a5729173477e1cd8da216778`
- Platform: Windows `10.0.26300` x64
- Node.js: `24.21.0`
- Change Run: `change-repoctopus-repair-desktop-run-activation-dde9532e7e8f7a45`

实现提交是可发布产品边界。后续提交只允许更新 OpenSpec 状态、验证 Evidence 或报告检查器；任何其他打包产品变更都会令本报告失效。`scripts/check-managed-execution-report.mjs` 会重新校验提交祖先关系，并从当前检出重新打包、比对上述 SHA-256。

## Verdict

Windows Change Run 现在通过同一条生产纵切自动启动或激活 Desktop Dashboard：

```text
run.change.start
  -> WorkflowRuns.startChange
  -> DesktopLauncher.activate
  -> source Electron target or installed repoctopus:// handler
  -> single-instance Shell
  -> one Host and one OTLP Receiver
```

Dashboard 仍是非阻塞的本地可观测性表面。`unavailable` 和 `unsupported` 只产生有界 warning 与遥测事实，不回滚 Change Run、不丢失初始 Work receipt，也不停止远端 OTLP。

## Formal verification

以下命令在实现提交及其 Evidence-only 后继提交上执行：

```text
npm run verify
  145 test files passed
  559 tests passed; 1 skipped
  TypeScript, Desktop TypeScript, ESLint, generated output, brand,
  architecture, provenance, dashboard salvage and report checks passed
  OpenSpec strict validation passed 15 items with 0 failures

npm run test:package-e2e
  1 test file and 1 test passed

npm run test:tracer-e2e
  1 test file and 1 test passed

npx vitest run test/e2e/desktop-run-activation.e2e.test.ts
  1 test file and 1 test passed

npm run package:desktop
  Windows x64 NSIS installer built successfully

npm run check:desktop-package
  verified 6 package entries, 14 resources and a 116495817-byte installer

npm run test:desktop-package-e2e
  install-candidate, run-activation, otlp-receiver, single-instance,
  tray-hide-and-restore, direct-exit and uninstall-candidate passed
```

`npm run verify` 在报告创建前的第一次闭环中，所有测试和静态检查均已通过，最终仅由报告新鲜度守卫按预期拒绝。报告与检查器前移后重新执行整条命令，证明该守卫不是被跳过，而是以当前产品提交和包摘要重新闭合。

## Clean checkout and documented paths

在临时 detached worktree `Repoctopus-clean-desktop-activation` 上固定检出实现提交，未设置 `REPOCTOPUS_DESKTOP_EXECUTABLE`，执行：

```text
npm ci
  486 packages installed; 0 vulnerabilities

npm run build
  CLI and Desktop production artifacts built

npm run check:generated
  CLI and Desktop generated artifacts were fresh
```

源码路径由 Product Root、固定 Electron executable 与 `dist/desktop/main.js` 解析；安装路径由 NSIS 登记的 `repoctopus://` handler 解析。文档中的 7 个本地链接目标均存在。显式 executable 变量只保留为测试或受控运维 override，不是正常使用前置条件。

## Mutation sensitivity

在隔离 worktree 中，将 `WorkflowRuns` 的生产 `desktopLauncher.activate()` 调用替换为静态 `unavailable` 结果后，单独运行：

```text
npx vitest run test/desktop-run-activation.test.ts
```

测试按预期失败：生产入口期望 Launcher 被调用一次，实际为零次。恢复调用后测试通过。该 mutation 证明验收测试对原始“插件已注册但生产入口未消费”的断链敏感，不会再让 catalog membership 冒充端到端能力。

## Failure-path and recovery evidence

Launcher 测试覆盖同步 throw、异步 `error`、`spawn`、timeout、缺少开发 artifact、无 handler 与非 Windows。所有启动均使用 executable 加参数数组，不使用 shell 字符串拼接。诊断和 OTLP 只保留稳定 result/reason，不包含绝对路径、URL payload、命令或原始错误正文。

安装态 E2E 证明首次协议启动和第二实例转交都归属同一个 Shell、Host 与 Receiver；退出和卸载后协议登记、进程、Receiver discovery 和临时安装目录均被清理。Windows 网络 compartment 无法通过 `netstat` 观察有效 loopback listener 时，只允许 token-authenticated health 与 PID 身份共同证明 owner，仍保持 fail-closed。

## Findings corrected during verification

验证发现并修复了三个仅在真实边界出现的问题：

1. Electron 原先把 Receiver discovery 写入 roaming AppData，而 Runtime 从 local AppData 读取；现在双方使用同一个导出解析器。
2. electron-builder 的顶层 protocol 配置没有为当前 NSIS 安装路径产生所需登记；现在由受控 `installer.nsh` 明确安装和卸载 handler。
3. Codex 所在 Windows 网络 compartment 可能隐藏 loopback listener；现在只有通过认证且 PID 身份匹配时才允许 discovery fallback。

此外，Package 3 修改了 Comet-adopted `domains/runtime/workflow-runs.ts`，但原 Build Plan 没有把 `third_party/comet/source-manifest.json` 纳入对应写入范围。验证没有绕过 provenance：只刷新了该本地派生文件的 SHA-256，上游来源身份保持不变。报告新鲜度检查器也仍固定在上一项 Change；本次仅将其验证对象前移到当前实现提交。这两项都记录为 Build Plan 元数据遗漏，未扩张产品需求。

## Cleanup

- mutation 与 clean-checkout 临时 worktree 已移除。
- Windows 安装 E2E 的安装目录、协议 handler、Electron/Host/Receiver 进程与 discovery 文件已由测试 teardown 清理。
- package-hash、Runtime outcome 与恢复 Runtime 临时文件在 Change 完成后删除。
- 最终交付要求工作树干净，远端分支 OID 与本地 HEAD 一致。
