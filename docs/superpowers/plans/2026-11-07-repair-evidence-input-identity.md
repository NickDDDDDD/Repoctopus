---
change: repair-evidence-input-identity
design-doc: openspec/changes/repair-evidence-input-identity/design.md
base-ref: 5a92ebc945a54b9dea6db2094ac20ee6ed55aaa0
---

# Evidence 输入身份实施计划

**Goal:** 等价任务收尾保留实际验证证据，真实输入变化按依赖失效，并在生产多仓路径证明。

**Architecture:** Provider 提供官方规划文件语义，Git Adapter 收集真实内容，Evidence 领域派生逐节点依赖；现有 Store、Journal、Gate 与 Run CAS 保留各自权威。沿用批准的 autonomous + TDD + thorough，当前 Agent 实施，独立审查按分段和最终集成执行。

**Spec:** `openspec/changes/repair-evidence-input-identity/design.md` 及同一 Change 的两个 delta。

<!-- comet-task-authority: openspec/changes/repair-evidence-input-identity/tasks.md -->

## Global Constraints

- Windows 优先，保留当前 Node.js `^22.16.0 || >=24.0.0` 与 TypeScript/Cordis 技术栈，不增加运行时依赖。
- 外部 Comet Classic 控制本产品开发；Repoctopus 仅用于独立实验项目验收，不手改 Store。
- 不增加阶段、后台任务、旧协议兼容、第二套 checkbox 或实现笔记。普通设计取舍写回同一 design.md，检查结果进入 Evidence 与正式报告。
- 每次提交立即 push；Change 完成后才创建 PR。

## Review Focus

- HEAD/index 改变但工作区有效内容相同：保留证据，显式 Git 依赖仍失效，对应任务 1.1、3.1。
- Provider 语义与实际字节来源不匹配：阻断而非按目录排除，对应任务 1.2。
- Receipt 只有成功标签或依赖记录损坏：Gate 不接受，对应任务 2.1。
- 前驱正常产生文件、缓存输出丢失及中断：正确冻结派生输入，不误报或重发，对应任务 3.2。
- Archive 发布 OID 变化与验证输入漂移不同：独立 preflight，保持证据和授权边界，对应任务 2.2、4.1。

## 1. 生产失败基线与输入采集

<!-- comet-task-ref:13b7b7b2-999f-42a7-a87b-5ab01e04edbc -->

扩展 `test/managed-change-execution.e2e.test.ts` 的自主两仓场景，在 managed Verify Gate 已满足后提交官方 Tasks 的 Runtime 完成状态。通过公开 CLI 新进程观察和 Archive prepare，断言同一有效 Bundle、无额外 Verify Work；先运行基线并保存真实失败。

Run: `node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'`。RED 必须是实际错误回退，不能是夹具、解析或网络错误。

<!-- comet-task-ref:2dacb54c-979c-4690-962b-1f3456d4d989 -->

新增 `domains/evidence/input-policy.ts`、`domains/evidence/input-snapshot.ts` 与 `platform/git/evidence-input-snapshot.ts`，分别负责声明/排序、规范身份与稳定内容读取。`services/specification.ts`/`domains/specification/types.ts` 的只读投影端口由 `platform/specification/openspec-provider.ts` 通过官方 status 路径和已有语义解析提供。接口使用 repository ID、仓内路径、实际/语义摘要及 Provider/schema/policy，不向领域暴露本机路径。

先用实际 Git fixture 验证 dirty→stage→commit 内容身份稳定，再覆盖真实正文、未知文件、显式 ignored 输入、路径逃逸和读取竞态。新投影同时交付契约说明；不得只测试手工声明“语义未变”。

## 2. 证据纵切与生命周期

<!-- comet-task-ref:5b02cd16-d1d4-4fda-906b-53e6889fd728 -->

更新 `domains/evidence/types.ts`、`fingerprint.ts`、`dependencies.ts`、`validation.ts`、`acceptance-trace.ts` 与既有 FileEvidenceStore。节点摘要与 Profile 摘要分开，依赖记录先计算集合摘要再绑定 subject ID，避免循环。Receipt/Attempt v1、Context v2、fingerprint/Bundle/Gate v3、Verification Input v4；Plan/Build Check 对必需依赖同步升级，不保留旧解析执行路径。

`EvidenceCoordinator.plan` 和所有实际采集/接受入口携带 workflow 上下文并共用观察器，实际 Store 往返、损坏记录、跨 Work、缺失 Trace 负例必须通过。更新 Host/Evidence 契约与受影响 fixture。

<!-- comet-task-ref:3d9a65ef-27fa-473d-8c95-291204b92511 -->

更新 `services/workflow-runs.ts`、`domains/change-lifecycle/verification-input.ts` 与对应转换。Verify、Archive、resume/next 消费同一已授权输入观察，保留无关阻塞。规划同时变化走最高层恢复；仅发布坐标变化走受保护 preflight，不把旧发布 Work 用于新 OID。`PlanEvidence`/`BuildCheckEvidence` 继续绑定原 Strategy/Binding/checkpoint，不能用证据投影放宽 Build 授权。

验证首个真实 RED 转绿；再覆盖显式产品漂移、规划漂移、未知 Provider、发布 preflight 和 revision 竞争。分段独立审查通过后再勾选任务。

## 3. 输入声明、DAG 与复用

<!-- comet-task-ref:e432e230-a248-4f0a-ade6-2a0d4e2f7d98 -->

`domains/project-configuration/types.ts`/`config.ts` 与 `domains/feedback/profile.ts` 实现批准的 command.inputs schema：逐仓 files/outputs、git、taskCheckboxes、env。默认保守，显式空范围、非法节点类型和越界路径拒绝；工具/采集实现始终绑定。更新团队 YAML 说明及可执行示例，验证声明改变只影响相应输入身份且不绕过整体配置授权。

<!-- comet-task-ref:726db950-8bd3-4a10-a478-177cb08121b3 -->

更新 `domains/evidence/service.ts`、`lifecycle.ts`、`recovery.ts` 和 `services/evidence-coordinator.ts`，生产调用方从实际 Store 查询并传入候选 Receipt。TTL 不延长，旧记录不覆盖，unknown 不重发。源输入在 Attempt 前冻结；producer 生成输出后由 Runtime 保存 manifest，与 Receipt 同节点 Journal 完成边界持久化；consumer 前核对派生内容，Gate 按原 DAG 与 Receipt 证明链接受。

实际命令计数证明独立 B 保留、A 及后继重采；实际 build→consumer 证明产物时序正确。覆盖三处中断和缓存输出缺失，并同步恢复、失效原因及低基数遥测说明。

## 4. 固定候选集成

<!-- comet-task-ref:bdacc7d6-d03c-40b0-9327-391890d0647f -->

独立安装固定 tarball，在新实验多仓 Run 执行小任务，真实 Verify 后提交完成状态；从新进程恢复并准备 Archive，核对 Work、Gate、Bundle、epoch 与真实命令次数。再以真实依赖变化证明门禁阻断；原验收 Store 保持不变。原始证据保存外部验收目录，正式报告使用 `verification/repair-evidence-input-identity/verification-report.md` 与 Comet 入口 `docs/superpowers/reports/repair-evidence-input-identity.md`。

<!-- comet-task-ref:b45389e7-b35d-44dc-b2de-2af481420f4b -->

运行 `npm.cmd run verify`、固定包身份复算与独立最终审查。架构和来源清单随实际新增纯模块更新；规范化 npm 包从独立 node_modules 构建，不能使用共享 Junction 的构建身份。只有正式收据和全部八项真实完成，才提交 complete-build 并进入最终 Verify。
