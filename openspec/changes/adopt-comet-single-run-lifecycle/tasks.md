# Tasks

## 1. 建立单一权威 Change Run 纵切

- [x] 1.1 固定旧 generation 协议的失败基线：证明调用方可创建并列 Run、正常代码变化会阻断恢复，并记录 Comet 0.5.0 稳定 runId/CAS 对照。
      **Acceptance:** 旧实现上测试按预期失败，且能稳定区分身份问题与普通 CAS 冲突
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run
- [x] 1.2 将 `ChangeRunIdentity` 与确定性 `changeRunId` 改为只由 Workspace/change 派生，升级 schema 并删除 mode/generation 身份字段。
      **Acceptance:** 同一 Workspace/change 始终得到同一无 generation runId，规范化、碰撞、跨 Workspace、冻结与序列化测试通过
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, change-lifecycle#预发布旧执行协议不得形成兼容债务
- [x] 1.3 定义稳定 `ChangeRunStartIdentity`，只冻结 Workspace、Provider、仓库拓扑、目标基线与 definition/composition，不冻结会随 Build 改变的 HEAD/tree/dirty。
      **Acceptance:** 正常开发变化可恢复；Provider、仓库集合、远端、分支、基线或定义漂移 fail closed
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run
- [x] 1.4 破坏性升级 Application/CLI，删除 `--generation` 和 `--mode`，并让并发首次启动通过同一 RunStore 键收敛。
      **Acceptance:** 打包 CLI 拒绝旧参数，并发进程只创建一个稳定 Run且重复请求幂等恢复
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, change-lifecycle#预发布旧执行协议不得形成兼容债务
- [x] 1.5 建立 legacy 隔离，证明新 locator 不扫描、读取或改写 `-g<n>-` Run 与 `*.g<n>.json` Journal。
      **Acceptance:** legacy fixture 字节不变且不参与当前定位，不兼容旧 schema 只返回只读审计或 `migration_required`
      **Requirements:** change-lifecycle#旧状态迁移必须显式且可证明

## 2. 修正 Open、Design 与 Build 阶段合同

- [x] 2.1 写 characterization tests 固定当前错误：Open 只产 proposal 并自动推进、Design 才产四件套、Build 重复加载设计方法、Verify 回 Build 无 Repair Work；确认旧实现在新断言上失败。
      **Acceptance:** 四类错误分别由可定位的测试捕获，测试不会只断言最终 phase
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, change-lifecycle#五阶段必须留下可核对的推进依据
- [x] 2.2 改造 lifecycle definition：Open 固定 `repoctopus-open-change + grilling`，Design 固定 `repoctopus-design-change + codebase-design`，Build 固定 `repoctopus-build-task + tdd`。
      **Acceptance:** definition 与公共 projection 暴露准确、有序且调用方不可替换的组合；Build 不再固定包含 `codebase-design`
      **Requirements:** skill-integration#阶段-work-必须装填固定且唯一的-skill-组合
- [x] 2.3 让 Cordis composition 为规范名 `grilling` 提供或声明可分发依赖，并在 Open claim 前完成唯一 Provider 解析、正文/资源/provenance 快照与缺失/歧义阻断。
      **Acceptance:** 干净测试环境无需依赖开发机全局目录也能解析唯一 `grilling`；缺失、重名或漂移均 fail closed
      **Requirements:** skill-integration#run-记录实际-skill-快照, skill-integration#阶段-work-必须装填固定且唯一的-skill-组合
- [x] 2.4 重写 Open Skill/Validator：先核对代码、仓库和现有规格事实，再创建或修复 proposal、delta specs、design、tasks；严格校验通过后建立绑定四件套语义摘要的 Human Decision。
      **Acceptance:** Open Outcome 缺任一工件、未验证环境事实或 Provider strict 失败均不能请求批准；frontier 为空时允许零问题完成
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, skill-integration#阶段-work-必须装填固定且唯一的-skill-组合
- [x] 2.5 实现 Open 决策：批准才递增 epoch 进入 Design，拒绝或要求修订时留在 Open；冷恢复展示同一 proposal hash 和 choices。
      **Acceptance:** 未决、拒绝、篡改、重放和过期响应不能进入 Design，可信批准只产生一次 transition
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, managed-work-execution#受管-work-必须从原执行断点恢复
- [x] 2.6 重写 Design Skill/Validator：从已批准 Open 基线深化同一四件套，禁止第五份 Design Doc、Build Plan、ADR 或 implementation notes，并建立独立 Human Decision。
      **Acceptance:** Design 修改原 OpenSpec 路径且能补足工程决策与 Tasks；新增替代规划权威或缺少 strict validation 时不得请求批准
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, skill-integration#openspec-四类工件必须保持唯一规划权威
- [x] 2.7 实现 Design 决策与语义摘要：批准才进入 Build，拒绝留在 Design；语义变化使相应批准失效，纯格式或 checkbox 状态变化不制造虚假 planning drift。
      **Acceptance:** Open 与 Design 两次批准可独立审计，任一未完成都不能 Build，摘要分类矩阵与冷恢复测试通过
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, change-lifecycle#生命周期回退保留审计历史

## 3. 用 checkEpoch 建立阶段证据 fence

- [x] 3.1 在 lifecycle reducer 中加入 machine-owned `checkEpoch`，初始为零且每次合法 transition 原子递增一次。
      **Acceptance:** 前进、回退、完成、非法 transition、溢出与普通 CAS 的领域测试通过
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch
- [x] 3.2 将 transition journal、checkpoint 与五阶段推进依据绑定 from/to epoch，并让恢复拒绝缺失、倒退或不一致 epoch。
      **Acceptance:** 冷启动与并发 CAS 可重放唯一 epoch，过期写入 fail closed
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch, change-lifecycle#五阶段必须留下可核对的推进依据
- [x] 3.3 升级 ActionIntent、Receipt、Outcome、Work packet/checkpoint/session 与 Validator identity，在 claim 时冻结 epoch并在提交和恢复时复核。
      **Acceptance:** stale、跨 Work、跨 attempt 和 transition 竞态结果只保留审计，不能推进
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份
- [x] 3.4 将 Verification Input、Evidence binding/attempt/gate 从任意 stateVersion 等值改为 checkEpoch 与完整输入身份。
      **Acceptance:** telemetry 等普通 CAS 不使证据失效，阶段变化稳定产生 `phase-changed` 或 `stale-epoch`
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch
- [x] 3.5 收紧 reusable Evidence：仅在 Work、命令、输入、环境、Provider、fingerprint 与 policy 全部复核时允许复用。
      **Acceptance:** 跨 epoch、仓库漂移和 Acceptance 漂移矩阵证明旧成功不能单独通过 Gate
      **Requirements:** change-lifecycle#五阶段必须留下可核对的推进依据

## 4. 建立同一 Run 内可执行的恢复与返工

- [x] 4.1 让 Host Outcome 只报告有界结构化发现，不接受 `targetPhase`；由 Runtime 根据 definition 选择 retry、wait、reconcile、Human Decision 或 transition。
      **Acceptance:** 恶意或错误 Host 不能指定 phase，所有合法下一步都能从持久事实确定性重建
      **Requirements:** managed-work-execution#host-只能报告发现而不能选择阶段
- [x] 4.2 为 Build 普通实现失败建立有界 attempt policy：保持 Build、创建同一逻辑 Work 的下一 attempt，达到上限后明确 blocked/decision。
      **Acceptance:** 单次失败可恢复，持续失败不会无限 `run next` 重派或产生新 Run
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [x] 4.3 为 Build 的 `design_assumption_invalid` 建立 Human Decision；批准修订后回到 Design并失效旧批准、相关 claims 与 Evidence。
      **Acceptance:** Agent 不能自行回 Design；拒绝、批准、过期响应和冷恢复路径都保持同一 runId
      **Requirements:** change-lifecycle#生命周期回退保留审计历史, managed-work-execution#host-只能报告发现而不能选择阶段
- [x] 4.4 将 Verify 失败分类为 implementation failure、planning semantics drift、evidence/infrastructure failure，分别路由到 Build、Design 或 Verify blocked/retry。
      **Acceptance:** 分类表逐项测试，基础设施失败不会伪装成代码返工，设计漂移不会降级成普通 repair
      **Requirements:** change-lifecycle#失败分类必须决定真实返工路径
- [x] 4.5 Verify→Build 时重开有依据的 OpenSpec task revision，并创建真实 Repair Work；该 Work 必须完整经过 claim、`tdd` packet、Host、Validator 和 completion claim。
      **Acceptance:** 只改 phase、只改文件、只勾 checkbox 或只观察新 fingerprint 都不能重新进入 Verify
      **Requirements:** managed-work-execution#验证失败必须创建受管-repair-work, change-lifecycle#completion-claim-与验证事实分离
- [x] 4.6 Archive 在任何 closure/publication 副作用前发现 Verify 陈旧时回到 Verify；副作用开始后固定 phase并从 Journal reconcile。
      同时在 closure 与远端 publication 前验证 planning approval/实时 Change branch；兼容升级若只发现冻结 OID 错误，可用 approval + closure candidate 在同 Run 新 epoch 建立替代 publication Work，不得修改其他交付输入。
      **Acceptance:** pre-side-effect reverify 与 post-side-effect unknown-result 两条恢复路径均不重复远端动作
      **Requirements:** change-lifecycle#失败分类必须决定真实返工路径, delivery-governance#外部发布动作以稳定身份恢复
- [x] 4.7 把 definition、composition、Skill、Method Profile 与 Provider 漂移改为同一 Run 的兼容恢复、当前 Work 失效或 `migration_required`，删除 successor generation。
      **Acceptance:** 领取前后漂移矩阵全部指向原 runId，无法证明兼容时阻断
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复, skill-integration#run-记录实际-skill-快照
- [x] 4.8 将预勾选 Tasks 的 `adopt-existing` 变成同一 Run Human Decision，绑定 planning/task revisions/repository/proposal identity，且只能导入 Build completion claims。
      **Acceptance:** 接受、拒绝、重放与漂移测试通过；adopt 不能伪造 Open/Design 历史或跳过 Verify
      **Requirements:** change-lifecycle#completion-claim-与验证事实分离

## 5. 以 runId 重建发布与一致性恢复

- [x] 5.1 升级 Publication Receipt 与 Archive terminal validator，删除 generation并绑定 changeId/runId/verification input/specification closure。
      **Acceptance:** 错误 Run、closure 或旧 epoch Receipt 不能完成 Archive
      **Requirements:** delivery-governance#publication-receipt-证明交付完成
- [x] 5.2 将 Publication 与 Specification Publication Journal 的权威键改为安全 runId，并使用 `specification:<runId>` publication identity。
      **Acceptance:** 响应丢失、重复调用、损坏文件和 legacy 文件并存测试通过且不重复副作用
      **Requirements:** delivery-governance#外部发布动作以稳定身份恢复
- [x] 5.3 将业务发布 item idempotency key 改为 runId、repository、base、head 与 exact OID。
      **Acceptance:** 单仓、多仓、人工创建 MR、已有 MR 与 OID 漂移矩阵均 create-or-recover 或明确阻断
      **Requirements:** delivery-governance#外部发布动作以稳定身份恢复
- [x] 5.4 改造 Consistency Receipt/Store/Review 以 runId 定位归档事实；后续差异只能创建普通新 Change。
      **Acceptance:** 一致性审查不重开、替换或增加原 Run 代次，原 Run 保持终态
      **Requirements:** delivery-governance#publication-receipt-证明交付完成

## 6. 清退 generation 并统一遥测与文档

- [x] 6.1 删除 lifecycle migration domain/service/store/plugin 与 production composition 注册，保留无关的 Delivery v2 migration。
      **Acceptance:** 发布包无 lifecycle generation migration 入口或死依赖，Delivery v2 migration 仍可用
      **Requirements:** change-lifecycle#旧状态迁移必须显式且可证明
- [x] 6.2 删除生产类型、Trigger、projection、checkpoint、命令帮助、JSON/text 输出和安全 allowlist 中的 generation/mode 身份字段。
      **Acceptance:** production source/package 负向扫描通过，仅 archived specs 与不可变历史数据可命中
      **Requirements:** change-lifecycle#预发布旧执行协议不得形成兼容债务
- [x] 6.3 更新 Trajectory 与 OTLP：记录 Open/Design 双批准、Skill delivery/consumption、Work/attempt/epoch、repair/task reopen/reverify 和有界失效分类。
      **Acceptance:** 同一 Change 形成唯一 trace 链，事件可定位真实执行边界且 payload 不含 generation
      **Requirements:** development-telemetry#受管-change-执行必须产生完整可重放遥测
- [x] 6.4 更新 Metric 隐私与基数 gate，不把 checkEpoch、runId、自由 Skill/插件名或 invocation identity 作为 label。
      **Acceptance:** 指标可从审计事件复算且恶意、高基数、未知分类 fixture 全部被降级或拒绝
      **Requirements:** development-telemetry#效率-metric-必须有界且可从审计事件复算
- [x] 6.5 更新 Desktop projection，使同一 Change 只有一个 current card，并可展示当前 phase/Work、Open/Design approval、repair/reverify 与 legacy audit。
      **Acceptance:** receiver 乱序、重复、恢复和新旧事件混合测试不会制造双 current 或提前完成
      **Requirements:** development-telemetry#生命周期遥测来自权威-change-run
- [x] 6.6 更新 self-hosting、runtime-state、specification、skills、CLI 帮助与来源采用报告，解释阶段合同、稳定 Run、四种计数器和 legacy 边界。
      **Acceptance:** 文档命令可运行，不再指导 generation/mode、第五规划工件或跳过任一人工批准
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, change-lifecycle#每个活动-change-使用唯一权威-run

## 7. 以真实消费者验证破坏式切换

- [x] 7.1 在临时单仓 Workspace 用打包 CLI 真实执行 Open Work → Open approval → Design Work → Design approval → Build → Verify → Archive，并在每个边界重启进程。
      **Acceptance:** 全程只有一个 runId，两个批准和每个 Work/Validator/epoch 都可从 Trajectory 核对
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界, change-lifecycle#五阶段必须留下可核对的推进依据
- [x] 7.2 在多仓 Workspace 重复 7.1，注入本机路径重绑定、业务 commit/dirty、目标 OID 漂移、MR 响应丢失和人工已有 MR。
      **Acceptance:** 正常开发变化可恢复，真实拓扑/OID 冲突 fail closed，发布副作用不重复
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, delivery-governance#外部发布动作以稳定身份恢复
- [x] 7.3 运行 Build implementation retry、Build→Design、Verify→Build Repair Work、Verify→Design、Verify blocked retry 与 Archive→Verify 六条完整返工旅程。
      **Acceptance:** 每条旅程保持同一 runId、epoch 单调且由 Runtime 选择 continuation，旧批准/claims/evidence 按规则失效
      **Requirements:** change-lifecycle#失败分类必须决定真实返工路径, managed-work-execution#验证失败必须创建受管-repair-work
- [x] 7.4 增加反作弊 fixture：重引入 generation、自动越过 Open、缺少第二批准、Host 指定 phase、Build 重复设计 Skill、无 Work repair、跨 epoch Outcome 与双 current Run。
      **Acceptance:** 八类受控退化都被同一正式验收 harness 捕获
      **Requirements:** change-lifecycle#预发布旧执行协议不得形成兼容债务, change-lifecycle#五阶段必须留下可核对的推进依据
- [x] 7.5 增加 OpenSpec 权威性 fixture，证明 Design 只更新四类工件、`grilling` 可零问题结束且不能把环境事实转问用户、禁止第五规划文档。
      **Acceptance:** 正向与三类负向案例都由 Skill packet/Validator/文件清单共同验证
      **Requirements:** skill-integration#openspec-四类工件必须保持唯一规划权威, skill-integration#阶段-work-必须装填固定且唯一的-skill-组合
- [x] 7.6 执行 `npm run verify`、package/tracer E2E、OpenSpec strict 与 provenance 校验，生成绑定 commit/package/definition/composition/runId 的验证报告。
      **Acceptance:** 正式验证全部通过，报告可复现且能证明验收对退化敏感
      **Requirements:** development-telemetry#受管-change-执行必须产生完整可重放遥测
- [x] 7.7 清理临时 Workspace、receiver、状态卷、日志和 payload；推送所有提交并确认远端分支与本地 HEAD 一致。
      **Acceptance:** 无临时进程或调试残留，工作树干净且远端包含被验证提交
      **Requirements:** change-lifecycle#五阶段必须留下可核对的推进依据

## Workflow follow-up

- 旧 G1 自举 Run 在本 Change 规划获批后只保留为 legacy audit。
- 新代码完成后以唯一无 generation Run真实执行 Open 和 Design 两个批准边界；仅 Build 可用 `adopt-existing` 接管已完成实现，再完成 Verify 与 Archive。它不是 G2，也不能伪造新 Run 的规划历史。
- Archive 完成后发布规格与业务 MR；Run 不等待 MR 合入，后续差异由一致性审查建立普通新 Change。
