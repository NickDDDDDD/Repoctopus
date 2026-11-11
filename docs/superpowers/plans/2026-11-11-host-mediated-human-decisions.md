---
change: enable-host-mediated-human-decisions
design-doc: openspec/changes/enable-host-mediated-human-decisions/design.md
base-ref: 0b513d0da01c863767bf85b7feeb8bd9a2a411f5
archived-with: 2026-11-11-enable-host-mediated-human-decisions
---

# 宿主人工决定实施计划

<!-- comet-task-authority: openspec/changes/enable-host-mediated-human-decisions/tasks.md -->

本计划按已批准 autonomous／TDD／thorough 执行；完成权威只有 tasks.md，不复制 checkbox。设计、两个 delta specs 和当前固定 Comet 0.5.1 来源共同约束实施。

## 目标与边界

通过公共 CLI 完成“读取当前决定 → Host 提问并取得真实选择 → 显式回传 → Runtime 核对及正式推进”。保持当前阶段、规划权威、共享批准政策与终端模式，不引入审批后端、SDK、第二决定 Store 或旧 checkpoint 迁移。

## 文件职责

- `domains/change-lifecycle/human-decision.ts`：视图、回传类型、边界解析、kind/选择和 provenance 纯合同。
- `services/lifecycle-human-decisions.ts`：由现有 WorkflowRuns 持有的协调组件，读取请求参与事实／历史与规划记录，构建视图、核对回传和已有结果；不拥有另一套批准状态。
- `services/workflow-runs.ts`、`plugins/command/workflow-run-contributor.ts`：受管读取／提交入口，复用现有决定分支与操作所有权。
- `app/cli/lifecycle-decision.ts`、`app/cli/main.ts`：限制文件读取、JSON／TTY 分流、CLI envelope 和准确的后续命令。
- `domains/specification/types.ts`、`domains/specification/planning-approval.ts`、`services/specification-planning.ts`：规划决定的只读重验、原始交互来源及历史保留；不改变规划语义身份。
- `domains/change-lifecycle/transition.ts`、`domains/runtime/workflow-runs.ts`：既有 Run 转换随同 guarded commit 保存最小决定 provenance，允许按原始接受事实核对重试。
- Host 指引、工作区教程、协议 Schema 和 `docs/human-decision.md`：原生工具优先、对话回退、终端回退及信任边界。
- 新领域／服务／公开 CLI 测试及 `verification/enable-host-mediated-human-decisions/acceptance.mjs`：自动化协议证据与真实安装包宿主验收分别记录。

## Review Focus

1. 错 Run 但命中同名规划记录：先证明请求参与，合法共享批准与冒领分开。
2. 非法 isolation 或过期提案：批准写入前拒绝，不能留下部分批准。
3. intent 已写／批准未写或转换已写／响应丢失：新进程核对原事实，不重建 Work／epoch。
4. revise／reject 的 kind 特定效果：保留真实原始选择，不把未应用意图伪装成批准。
5. Host 声明与认证的区别：Actor 从执行上下文取得，正文文件不能提供 authenticated；真实 UI 不能由模拟 TTY 替代。

## 1. Open 纵切

<!-- comet-task-ref:45cc005b-f601-4196-996a-36d1b4ab5dfd -->

先新增 `test/e2e/host-human-decision-cli.e2e.test.ts` 的非 TTY 入口 RED：原 CLI 应拒绝新读取／回传模式；保存正确失败原因。随后以领域合同测试覆盖标准模板、未知字段、条件 isolation、phase/kind 与 64 KiB 上限，不把基础设施错误当 RED。

<!-- comet-task-ref:eb078f36-db52-45a1-ad98-02f90f0e1016 -->

实现 `LifecycleHumanDecisionResponse` 解析及视图工厂，协调组件提供 view／submit，统一 Router 注册读取与提交。`run decision --run` 获取当前请求；带 request/hash 时仅查询该 Run 参与的原请求。`run decide --response-file` 与原 TTY 同归现有规划决定，实际安装 CLI 回归转绿。使用当前结构和绑定，不能导入内部应用替代公共 CLI。

<!-- comet-task-ref:fbc0c4ae-7dfa-4e77-830d-de9eff46e8ac -->

修正 ask continuation 的明确读取命令并附 Host 交互职责，更新相关 Skill／入门指引。测试没有答复不提交，缺原生工具改为对话，缺交互上下文才要求终端；人工决定独立于 Action Outcome。

## 2. 四类决定与恢复

<!-- comet-task-ref:dcf7ce8a-35df-4cb3-b0f9-1e62672a1b5c -->

参数化测试 specification-open、specification-design、workspace-intent-revision 和 build-plan-risk；分别从现有权威材料生成允许选项和条件输入，验证非批准效果。保存原始选择及当前请求身份，不能让 Open 答复替代 Design。

<!-- comet-task-ref:2b099ab6-895c-49ed-a88b-2bc003535bf5 -->

补充错误 Run/request/hash、无参与记录、合法共享规划批准、旧 phase、Provider/规划漂移和非法 isolation 的 RED/GREEN。重验由 Planning 权威实现，CAS 与 guarded commit 前置约束保持；确认拒绝前后 Store／Run 未出现非法部分批准。

<!-- comet-task-ref:bb96f143-5cd5-4691-b286-b437f58ff22a -->

覆盖 response-file 的 actor/authenticated/targetPhase 越权字段、无用户授权信息和 Work Outcome 自批。Actor 保持真实 CLI 来源，交互渠道／授权依据分离；文档明确 Host 是用户答复的信任边界，CLI 文件不是独立的人类点击证明。

<!-- comet-task-ref:531e8859-c670-472f-8370-f36b2bf790d6 -->

在 intent 已写未批准、批准已写未回包、Run 转换已提交未回包处注入中断；查询原请求并重试相同回传，检查决定、Work identity 和 epoch 次数不增加。冲突原始选择／不同 isolation 拒绝，superseded 或旧来源未知按事实返回，不猜测。

## 3. 来源、观测与真实包

<!-- comet-task-ref:4c916fb7-f239-4117-ba92-d31b9dbce115 -->

更新实际采用的 Comet 来源摘要及行为映射，运行现有 provenance 检查。复用决定／Wait 的已持久化事实及有界观测，覆盖原生／对话来源与隐私；问答正文、凭据和引用不进入 Metric label。新增来源不改变规划批准语义。

<!-- comet-task-ref:cb90b94f-8f60-4e40-8e55-c11e34c53123 -->

按规范 Git 字节构建、打包并独立安装。新建隔离多仓 fixture／Store registry，通过公开命令运行 Open／Design 和恢复，保留原始命令、包身份与决定回执；至少完成一次真实宿主原生提问、真实用户答复和该安装包提交。自动化 Host 负例不能替代真实 UI。

## 4. 集成

<!-- comet-task-ref:85e5ae15-673f-49c4-869f-684fe4cd9f36 -->

分段及最终独立审查关闭阻断项。保存真实 RED/GREEN、恢复、包和宿主证据，更新正式验证报告与严格包绑定报告。正式阶段检查仅使用 check-policy 中精确 `npm.cmd run build` 和 `npm.cmd run verify`（后者绑定 `VITEST_MAX_WORKERS=2`）；源码最终提交后再执行 Guard，检查期间不改输入。

## 执行纪律

每个提交立即 push。只用公开 Comet 命令记录任务和状态，不手改 Store／phase。与本 Change 无关的三个提案保持原样。验证通过后再核对归档交付授权，本次不发布 Release。
