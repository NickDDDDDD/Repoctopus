# Protected Branch Rebinding Recovery 验证交接

## 结论

`recover-protected-branch-rebinding` 已完成实现、真实多仓恢复验收与完整 Build 门禁。复核没有发现未解决的产品阻断项；已识别的 Windows Desktop 单实例测试隔离问题不影响本 Change 的 Runtime 恢复语义，并已作为独立后续问题保留。

## 权威证据

- Repoctopus 正式验证报告：`verification/recover-protected-branch-rebinding/verification-report.md`
- 打包产品实现边界：`59e39354fdebff6cfc69b2f26cbf26a904e4c1bf`
- 控制器：`@rpamis/comet@0.5.1`
- Build Check 命令：`npm.cmd run verify`
- Build Check 结果：退出码 0；输入前后摘要一致；执行期间工作区无变化
- Build Check 输入摘要：`7dcb26357cec5ebb2031d03d0bb2293dc43852429b8436760e42fc354fc3853e`
- Build Check 内容摘要：`eb992b5bba91f7312a6daf4a1cc82814037dd8af527bd727981f316599e27af8`
- Build Check 收据：`.comet/runtime/classic-sdk-checks/387fc45d1c470dcb5129a64979fce68fec9ad655d212b8617b8402807e2dfc5d/02a536ab-1681-447c-be9b-54fa540e5889.log`

本文件是 Comet Classic Verify 所需的生命周期报告入口，只把 Verify Action 连接到正式验证报告和当前 Build Check 收据；它不建立第二套规格、任务或产品验证权威。正式 package-content 摘要保留在包外的验证报告中，避免报告入口产生摘要自引用。

## 已证明的职责边界

- 只有被拒绝的当前 Build Plan、`awaiting-correction` continuation 与精确 protected writable repository set 的 branch-only 修正可形成 typed authorized-rebind evidence。
- `run next` 与 `run resume` 使用同一纯 classifier；path、remote、topology、仓库增删、无关 branch、detached checkout、Host 或 capability drift 继续 fail closed。
- 合法修正恢复同一 Run，保留 Design、Build Strategy、Tasks、拒绝的 Plan Outcome 与 Binding 历史，只失效依赖旧 Binding 的计划证据，并派发唯一 `build.configure`。
- 既有 branch-only reconciliation poison 只有在 digest 与 trajectory 中已证明的授权事实精确匹配时才能清除；调用方参数不能自行制造授权。
- 重复 resume 幂等，不会重复创建 Configure Work 或成功 rebind transition。
- `workflow-runs` protected plugin 只接受精确直接前驱实现身份，未知旧实现仍要求 migration。
- 遥测只将有界结果、入口、poison-recovery 标志和仓库数投影为低基数维度；branch、路径、remote、Run ID 与 digest 不进入 Metric labels。

## 验证范围

完整门禁覆盖 TypeScript、Desktop TypeScript、ESLint、CLI/Desktop 生产构建、180 个测试文件、843 个通过测试与 2 个跳过测试、generated/brand/architecture/provenance/Dashboard salvage、18 项严格 OpenSpec 校验，以及正式验证报告的包身份复现。

真实多仓验收使用正常 `run resume` 恢复保留的 `add-compact-task-status-v2` Run，没有编辑 Store。Runtime 清除了匹配的 reconciliation poison，保留 Binding revision 1，创建只写非 protected feature branches 的 Binding revision 2，并接受相同三包计划；随后在独立业务 Change 的高风险跨仓人工决定处正常停止，没有伪造批准。

## 已知边界

- Windows Desktop activation E2E 与已运行的真实产品实例共享 Electron product-wide single-instance lock。停止验收启动的精确实例后，未修改的 E2E 通过 2/2；后续 Change 应让该 E2E 显式拥有或隔离单实例 owner。
- Runtime 只验证并绑定授权后的 checkout 事实；创建、切换和 push feature branch 仍是 Runner 的 Git 副作用责任。
- Archive 前仍须由 Comet Verify Guard 生成 Verify 作用域的独立真实检查收据；Build 收据不能代替 Verify 收据。
