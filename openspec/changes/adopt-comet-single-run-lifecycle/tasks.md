# Tasks

## 1. 建立单一权威 Change Run 纵切

- [ ] 1.1 固定旧协议的失败基线：用领域与打包 CLI 回归证明 `--generation` 可创建并列 Run、重复启动受可变 Project Snapshot 阻断，并记录 Comet 0.5.0 稳定 runId/CAS 对照；验证这些测试在旧实现上按预期失败。
      **Acceptance:** 回归测试稳定复现并列 generation 与正常代码变化导致的恢复冲突，并固定 Comet 0.5.0 对照身份
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run
- [ ] 1.2 将 `ChangeRunIdentity` 与确定性 `changeRunId` 改为仅由 Workspace/change 派生，升级 lifecycle schema 并删除 mode/generation 身份字段；用规范化、碰撞、跨 Workspace、冻结与序列化测试验证唯一身份。
      **Acceptance:** 同一 Workspace/change 始终得到同一无 generation runId，不同 Workspace 或 change 不碰撞，schema 与序列化不再含 mode/generation
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, change-lifecycle#预发布旧执行协议不得形成兼容债务
- [ ] 1.3 定义稳定 `ChangeRunStartIdentity`，让重复 `run start` 只比较 Workspace、Provider、仓库拓扑、目标基线与 definition/composition，不比较会随 Build 改变的 HEAD/tree/dirty；用单仓、多仓、代码变化和真实拓扑漂移矩阵测试验证恢复或冲突。
      **Acceptance:** 正常 Build 后重复启动恢复原 Run，Provider、仓库集合、目标远端/分支、基线或 definition/composition 漂移仍 fail closed
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run
- [ ] 1.4 破坏性升级 Application/CLI `run start`，删除 `--generation` 和 `--mode`，并使并发首次启动通过同一 RunStore 键收敛；运行打包 CLI 与并发进程测试证明调用方不能分配代次或选择 Run 类型。
      **Acceptance:** CLI 拒绝 generation/mode 参数，并发启动只创建一个稳定 Run 且后续调用幂等恢复
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, change-lifecycle#预发布旧执行协议不得形成兼容债务
- [ ] 1.5 建立 legacy 数据隔离测试，证明新 locator 不扫描 `-g<n>-` Run 或 `*.g<n>.json` 文件、不改写历史数据，并为不兼容旧 schema 返回有界 `migration_required` 诊断。
      **Acceptance:** legacy fixture 保持字节不变且不参与当前 Run 定位，旧 schema 只能只读审计或返回 migration_required
      **Requirements:** change-lifecycle#旧状态迁移必须显式且可证明

## 2. 用 checkEpoch 建立阶段证据 fence

- [ ] 2.1 在 lifecycle reducer 中加入 machine-owned `checkEpoch`，初始为零且每次接受 transition 原子递增一次；领域测试覆盖前进、回退、完成、非法 transition、溢出与不含 transition 的普通 CAS。
      **Acceptance:** 每个合法 lifecycle transition 恰好递增一次 epoch，非法 transition 与普通 Run CAS 均不改变 epoch
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch, change-lifecycle#生命周期回退保留审计历史
- [ ] 2.2 将 transition journal、checkpoint 与五阶段推进依据绑定 from/to epoch，并让恢复逻辑拒绝缺失、倒退或与当前 lifecycle 不一致的 epoch；用冷启动和并发 CAS 测试验证。
      **Acceptance:** journal 与 checkpoint 可重放出唯一 epoch，缺失、倒退、并发过期或跨阶段写入全部 fail closed
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch, change-lifecycle#五阶段必须留下可核对的推进依据
- [ ] 2.3 升级 ActionIntent、Receipt、Outcome、Work packet/checkpoint/session 与 Validator identity，使 claim 时冻结当前 epoch，提交及恢复时核对 runId/work/attempt/input/epoch；用 stale、跨 Work、跨 attempt 和并发 transition 测试验证。
      **Acceptance:** 当前 epoch 的完整 Work 链可提交，旧 epoch、错误 attempt、错误 Work 或 transition 竞态结果只能保留审计而不能推进
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份, managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 2.4 将 Verification Input、Evidence binding/attempt/gate 从任意 stateVersion 等值改为 checkEpoch 与完整输入身份；测试证明 telemetry 等普通 CAS 不使证据失效，而阶段变化使运行中或已完成的非 reusable 证据 superseded/blocked。
      **Acceptance:** 非阶段 stateVersion 变化不触发重验，epoch 变化稳定产生 phase-changed 或 stale-epoch，旧证据不能通过 Gate
      **Requirements:** change-lifecycle#阶段转换建立检查证据-epoch, change-lifecycle#五阶段必须留下可核对的推进依据
- [ ] 2.5 收紧 reusable Evidence：只有当前 Work identity、命令、输入、环境、Provider、fingerprint 与 policy 全部复核时才可复用；运行跨 epoch、仓库漂移和 Acceptance 漂移矩阵。
      **Acceptance:** 可证明等价的 Receipt 才能在当前 gate 使用，任何未复核身份或语义漂移均要求重验
      **Requirements:** change-lifecycle#五阶段必须留下可核对的推进依据

## 3. 收敛同一 Run 的恢复、漂移与既有实现接管

- [ ] 3.1 把 definition、composition、Skill、Method Profile 与 Provider 漂移处理改为同一 Run 的兼容恢复、当前 Work 失效或 `migration_required`，删除创建 successor generation 的返回值；用各类漂移和领取前后矩阵测试验证。
      **Acceptance:** 所有漂移结果都指向原 runId，兼容漂移可恢复，不兼容漂移阻断且不会产生新 Run
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复, skill-integration#run-记录实际-skill-快照, skill-integration#work-分离可执行-skill-与不可执行-method-profile
- [ ] 3.2 删除 change-lifecycle migration domain/service/store/plugin 与 production composition 注册，保留无关的 Delivery v2 migration；架构测试证明发布包不存在 lifecycle generation migration 入口或孤立依赖。
      **Acceptance:** lifecycle migration 代码和注册完全移除，Delivery v2 migration 保持可用，架构依赖扫描无死引用
      **Requirements:** change-lifecycle#旧状态迁移必须显式且可证明, change-lifecycle#预发布旧执行协议不得形成兼容债务
- [ ] 3.3 将预勾选 Tasks 的 `adopt-existing` 改为同一 Run 内稳定 Human Decision，绑定 planning/task revisions/repository/proposal identity；测试覆盖接受 imported claims、拒绝后恢复 pending、响应重放、漂移与仍需 Verify。
      **Acceptance:** adopt 决定不改变 runId，可信响应幂等且不能跳过 Verify，身份漂移或伪造响应被拒绝
      **Requirements:** change-lifecycle#completion-claim-与验证事实分离
- [ ] 3.4 更新 pull-based `run next` continuation，使普通回退、重试、Human Decision、unknown Host、验证失败和 Archive 恢复都留在同一 Run；运行从 Build 回退再恢复的生产 composition 纵切。
      **Acceptance:** 所有 continuation 由 Runtime 选择并保持同一 runId，调用方不能通过目标 phase、generation 或 mode 绕过状态机
      **Requirements:** change-lifecycle#生命周期回退保留审计历史, managed-work-execution#受管-work-必须从原执行断点恢复

## 4. 以 runId 重建发布与一致性恢复

- [ ] 4.1 升级 Publication Receipt 与 Archive terminal validator，删除 generation 并绑定 changeId/runId/verification input/specification closure；领域与防伪测试覆盖错误 Run、错误 closure 和旧 epoch 证据。
      **Acceptance:** 只有当前 runId 与有效 Verify/closure 身份的 Receipt 能完成 Archive，序列化不再包含 generation
      **Requirements:** delivery-governance#publication-receipt-证明交付完成
- [ ] 4.2 将 Publication Journal 与 Specification Publication Journal 的权威键和文件名改为安全 runId，并以 `specification:<runId>` 建立规格 publication identity；用响应丢失、重复调用、损坏文件和 legacy 文件并存测试验证。
      **Acceptance:** 同一 Run 的重复发布从原 Journal 恢复且不重复副作用，legacy generation Journal 不被新 Store 读取或改写
      **Requirements:** delivery-governance#外部发布动作以稳定身份恢复
- [ ] 4.3 将业务发布 item idempotency key 改为 runId、repository、base、head 与 exact OID，运行单仓、多仓、人工创建 MR、已有 MR 和 OID 漂移矩阵。
      **Acceptance:** 同一远端动作可 create-or-recover，OID 或目标身份变化会阻断而不是误认成功，MR 是否合入不改变 Run 终态
      **Requirements:** delivery-governance#外部发布动作以稳定身份恢复
- [ ] 4.4 改造 Consistency Receipt/Store/Review 以 runId 定位归档事实；测试证明后续一致性审查可以创建普通新 Change，但不会重开、替换或增加原 Run 代次。
      **Acceptance:** consistency 恢复只关联原 runId，后续修订拥有独立 Change 且原 Run 始终保持终态
      **Requirements:** delivery-governance#publication-receipt-证明交付完成

## 5. 清退 generation 并统一遥测与文档

- [ ] 5.1 删除生产类型、Trigger、projection、checkpoint、命令帮助、JSON/text 输出和安全 allowlist 中的 generation/mode 身份字段；增加 production source 与 package 内容负向扫描，允许 archived specs 和不可变历史数据继续存在。
      **Acceptance:** 发布源码与打包协议不存在 lifecycle generation/mode 字段或参数，扫描仅豁免明确的历史审计材料
      **Requirements:** change-lifecycle#预发布旧执行协议不得形成兼容债务
- [ ] 5.2 更新 Trajectory 与 OTLP mapping：所有 lifecycle/Work/Skill/tool/Validator/wait/reconcile 事件以 runId 关联，阶段事件带 checkEpoch、Work 事件带 attempt/epoch，并删除 generation 属性。
      **Acceptance:** 同一 Change 的事件形成唯一 trace 链，epoch/attempt 可关联且 OTLP payload 不含 generation
      **Requirements:** development-telemetry#生命周期遥测来自权威-change-run, development-telemetry#受管-change-执行必须产生完整可重放遥测
- [ ] 5.3 更新指标与隐私/基数 gate：仅导出有界 phase-changed/stale-epoch 等分类，不把 checkEpoch、runId 或自由身份作为 Metric label；用恶意 payload、未知分类和高基数 fixture 验证。
      **Acceptance:** Metrics 可由审计事件复算且 label 集合有界，epoch 数值和高基数身份不会进入 Metric labels
      **Requirements:** development-telemetry#效率-metric-必须有界且可从审计事件复算
- [ ] 5.4 更新 Desktop projection，使同一 Change 只有一个 current card，并把旧导入 Run 标为 legacy audit 而不参与进度聚合；运行 receiver 乱序、重复、恢复与旧新事件混合测试。
      **Acceptance:** 本地 Dashboard 对当前 Change 只投影唯一 Run，legacy 事件可审计但不会覆盖或并列当前状态
      **Requirements:** development-telemetry#生命周期遥测来自权威-change-run
- [ ] 5.5 更新 self-hosting、runtime-state、specification、skills、CLI 帮助和来源采用报告，解释 stable Run、CAS、attempt、sequence、checkEpoch 与 legacy audit 边界；执行文档中的全部命令冒烟测试。
      **Acceptance:** 文档不再指导用户选择 generation/mode，示例命令可运行且四种递增量的职责表述一致
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, change-lifecycle#阶段转换建立检查证据-epoch

## 6. 以真实消费者验证破坏式切换

- [ ] 6.1 在临时单仓 Workspace 用打包 CLI 从空状态执行 `Open → Design → Build → Verify → Archive`，每次进程重启都只用 `run start`/`run next` 恢复稳定 Run，并核对 Work、epoch、Evidence、Receipt、Journal 与 OTLP identity。
      **Acceptance:** 独立进程黑盒完成五阶段且全程只有一个无 generation runId，阶段 epoch 单调、普通 CAS 不误增，所有产物关联同一 Run
      **Requirements:** change-lifecycle#五阶段必须留下可核对的推进依据, development-telemetry#受管-change-执行必须产生完整可重放遥测
- [ ] 6.2 在团队多仓 Workspace 重复 6.1，并注入本机路径重绑定、业务 commit/dirty 变化、目标 OID 漂移、MR 响应丢失与人工已有 MR；验证拓扑身份、Work 输入和发布恢复各自使用正确冻结边界。
      **Acceptance:** 多仓黑盒对路径和正常开发变化可恢复，对真实拓扑/OID 冲突 fail closed，发布副作用不重复
      **Requirements:** change-lifecycle#每个活动-change-使用唯一权威-run, delivery-governance#外部发布动作以稳定身份恢复
- [ ] 6.3 增加反作弊与验收灵敏度 fixture，分别重新引入调用方 generation、跨 epoch Outcome、stateVersion 误判证据陈旧、legacy Journal 读取和双 current Run；证明同一主黑盒 harness 均按预期失败。
      **Acceptance:** 五类受控退化都会被主验收捕获，而正确实现保持通过
      **Requirements:** change-lifecycle#预发布旧执行协议不得形成兼容债务, change-lifecycle#阶段转换建立检查证据-epoch
- [ ] 6.4 执行 `npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e`、OpenSpec strict 与 provenance 校验，生成绑定被测 commit/package/definition/composition/runId 的验证报告，并清理临时 Workspace、receiver、状态卷、日志和捕获 payload。
      **Acceptance:** 全部正式验证通过，报告与被测提交和包摘要一致，清理后无临时进程、状态、日志、payload 或未推送提交
      **Requirements:** change-lifecycle#五阶段必须留下可核对的推进依据, development-telemetry#受管-change-执行必须产生完整可重放遥测

## Workflow follow-up

- 旧 G1 自举 Run 在本 Change 规划获批后只保留为 legacy audit；新代码完成后以唯一无 generation Run 接管并完成 Verify 与 Archive，它不是 G2。
- Archive 完成后发布规格与业务 MR；Run 不等待 MR 合入，后续差异由一致性审查建立普通新 Change。
