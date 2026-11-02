# Tasks

## 1. 锁定真实失败窗口

- [x] 1.1 在 Open Service 测试中先让 artifacts inspection、strict validation 和 `markValidated` 成功，再让 `project.changeBranch` 暂时失败，证明当前第二次 `run next` 错误返回 `execute`而不是重观察。   <!-- comet-task:2da357b8-8ddf-44ad-883e-6e75c9cf4213 -->
  **Acceptance:** RED 只由缺少 `validated + reobserve` 路由导致，并精确断言原 Work、attempt、checkEpoch、Outcome、receipt 与 invocation。
- [x] 1.2 增加 `specificationPlanning.assess` 暂时失败的等价 RED，证明两个第二层 observation 入口共享同一恢复语义。   <!-- comet-task:35e0414e-27dd-4018-996f-2ba3d75fdf2b -->
  **Acceptance:** 两个故障点都不调用 Host reconcile、不创建 repair Work，且当前实现测试按预期失败。
- [x] 1.3 增加通用 resume RED：Open artifacts 正常提交只改变 HEAD/worktree时，当前实现错误设置全局 `reconciliationRequired`。   <!-- comet-task:33fb1e43-a8c4-4d98-8513-6ecedb96db2a -->
  **Acceptance:** fixture 同时保留稳定 repository id、remote、branch、path 与 topology，失败只来自 content/identity 未分级。

## 2. 建立可穷尽的 Open continuation

- [x] 2.1 为纯 Work continuation classifier 增加表驱动领域测试，覆盖无 execution、claimed、context-delivered、outcome succeeded/failed、Open validated、其他 phase validated与 unknown external result。   <!-- comet-task:ab0dc4db-dede-40a3-92aa-e99525b5c1c5 -->
  **Acceptance:** 每个合法 Work execution组合恰好映射一个 continuation，Open validated为 `reobserve/open-gate-pending`，只有 unknown external result映射 Host reconciliation。
- [x] 2.2 从现有 `WorkExecutionAuthority.recovery()` 抽出并接入单一 classifier，让 Open `validated` 直接进入 `advanceOpenGate`，不回退为 `outcome`、不清空 validator receipt。   <!-- comet-task:a4b4deff-59e3-4d96-81a6-041a20cd3464 -->
  **Acceptance:** 1.1/1.2 与 classifier测试转绿，现有首次 validation、repair和其他 phase恢复路径保持通过。
- [x] 2.3 让 managed execution、`run next`、`WorkExecutionAuthority.recovery()` 与恢复后的 next-action投影复用相同 classifier，删除重复的 phase/status猜测分支。   <!-- comet-task:8e03f9d7-a8ac-4c2d-aa1b-33196188960d -->
  **Acceptance:** TypeScript穷尽检查通过，CLI不再对 `validated + reobserve` 输出“Execute Open intake Work”，状态视图能区分 `open-gate-pending` 与当次 `open-observation-unavailable`。
- [x] 2.4 为重复/并发 pull 增加 CAS 测试。   <!-- comet-task:a9e8fe50-56dc-47c3-aca6-eb36e108a0c5 -->
  **Acceptance:** Provider 恢复后最多创建一张 Open approval卡或一个 Design Work；Work、attempt、checkEpoch、Host invocation 与 Skill consumption均不重复。

## 3. 分级 Project reconciliation

- [x] 3.1 为 `same | content | identity` 建立表驱动 RED，覆盖 head、worktree、branch、remoteIdentity、path、add/remove、project/root identity 与 diagnostics。   <!-- comet-task:ead65d0d-fcc2-47ae-b880-1f958fbfb988 -->
  **Acceptance:** 无法安全分类的差异默认 identity，当前单布尔实现测试按预期失败。
- [x] 3.2 一次性扩展 `ProjectReconciliation` 类型与 `reconcileProjectSnapshots`，提供 `changeClass` 和 `requiresReconciliation`。   <!-- comet-task:6896ffbf-27b3-467c-a49a-4c23177e85cd -->
  **Acceptance:** content 完整报告差异但 `requiresReconciliation=false`；identity 为 true；所有调用点通过编译器迁移，不保留第二套兼容判断。
- [x] 3.3 修改 Runtime Coordinator resume，只让 identity drift 设置 `reconciliationRequired` 和 `recovery.reconciled`。   <!-- comet-task:76c8c6ab-d44f-4248-b1aa-5f326c007e00 -->
  **Acceptance:** content drift 记录 `run.resumed` 并保留当前 state/continuation；identity drift 仍 fail closed。
- [x] 3.4 修改 WorkflowRuns Service 与 CLI next-action 投影，禁止以 `reconciliation.changed` 直接覆盖 execution continuation。   <!-- comet-task:6910b7ce-1713-4469-b3e8-da664bfd1709 -->
  **Acceptance:** content + `reobserve` 返回 `run next`；identity drift 返回显式 reconciliation 指引。
- [x] 3.5 回归各 phase 的精确失效边界。   <!-- comet-task:b6316238-c70b-4314-9932-214dd8637bb7 -->
  **Acceptance:** Open planning、Design snapshot、Build Binding/Plan Evidence、Verify Evidence 与 Archive closure对相关 content drift仍重验，不能因取消全局阻塞而接受陈旧证据。

## 4. 遥测与诊断

- [x] 4.1 为 Open observation stage 增加有界 trajectory/OTLP 分类。   <!-- comet-task:f61874d9-f092-4071-a28b-023751eab089 -->
  **Acceptance:** `provider-validation|planning-gate` 能关联同一 run/work/attempt/checkEpoch，恢复记录 `host_replayed=false`。
- [x] 4.2 为 Project reconciliation class 增加公共 telemetry catalog 与 mapping。   <!-- comet-task:5e20fcf6-e22b-4cf7-b197-660e0ed96cca -->
  **Acceptance:** `none|content|identity` 使用低基数属性，Metric labels不含 branch、path、remote、OID、digest、错误正文或 changeId。
- [x] 4.3 增加逻辑去重回归。   <!-- comet-task:ed46942e-34a2-4c91-ae49-9a4d25b7bed6 -->
  **Acceptance:** 重复 reobserve/export replay 不增加 Host invocation、Skill consumed、workflow execution或 failure计数。

## 5. 生产边界验收

- [x] 5.1 扩展 production-composition Windows CLI fixture，完成真实 Open Host Outcome并提交四类 artifacts。   <!-- comet-task:65bfc3dc-7ad2-4752-833f-de7d7b5df833 -->
  **Acceptance:** Work 在注入故障前已持久化 `validated`，且 fixture 的 HEAD 相对 Run 启动快照确实变化。
- [x] 5.2 在 planning branch observation 注入一次可恢复超时，随后执行 `run resume`。   <!-- comet-task:0706ddf4-a97f-4189-823b-bd4557adb709 -->
  **Acceptance:** resume 报告 content drift但不设置全局 reconciliation，原 Work、attempt、Outcome、receipt、packet与 invocation保持不变。
- [x] 5.3 Provider 恢复后执行 `run next`。   <!-- comet-task:95a89980-e5d7-47e2-b88b-e7d4a50df53f -->
  **Acceptance:** Run 进入唯一 Open Human Decision；Host invocation、Skill consumed 与 repair Work计数不变，trajectory包含可关联 unavailable→recovered事实。
- [x] 5.4 在同一 fixture 分别改变 branch/remote/topology。   <!-- comet-task:af414554-ae06-446c-9e19-afd0d88c0a41 -->
  **Acceptance:** 三类 identity drift继续返回 reconciliation required，不能进入 planning gate。
- [x] 5.5 从头重跑一个新的模拟多仓最小 Change 至 Open approval后Design入口。   <!-- comet-task:0150572b-15b3-4963-9315-ae4491b1fcfe -->
  **Acceptance:** 不修改旧验收 Store，不使用手工状态补丁，桌面/OTLP投影与 CLI 状态一致。

## 6. 完整门禁与交付

- [x] 6.1 更新 Runtime/telemetry公开文档，解释 resume、content drift、identity drift与phase authority的职责边界。   <!-- comet-task:ec3be39c-8c8c-4ba7-8881-96b975d55f7b -->
  **Acceptance:** 文档不引入第二套生命周期、migration或后台 daemon，并通过格式/契约检查。
- [ ] 6.2 运行目标测试、`npm run verify`、Comet OpenSpec strict validation 与 `git diff --check`。   <!-- comet-task:f1bb6b0c-de43-417c-93a4-23f3d5f7f857 -->
  **Acceptance:** 全部门禁绑定最终 HEAD/tree/config/tool输入通过，失败 Attempt保留在正式 Evidence中但不伪装成功。
- [ ] 6.3 保存 verification report并清理临时日志、JSON、mock remote和scratch输出。   <!-- comet-task:c15292a2-6f34-40c1-a9cb-f9281956f928 -->
  **Acceptance:** 工作树只包含预期源文件、OpenSpec归档与正式 Evidence；每个提交均已推送远端。

