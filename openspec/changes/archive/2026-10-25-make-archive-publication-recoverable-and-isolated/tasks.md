# Tasks

## 0. 固定故障与上游边界

- [x] 0.1 为当前 Archive 污染调用者分支建立真实 Git 失败测试，并记录业务/规格 MR 已成功但本地 branch ahead 的基线。
      **Blocked by:** None
      **Acceptance:** 测试在现有实现上证明 Archive 后 branch 名不变但 HEAD 被规格提交前移，upstream 仍停在验证 OID
      **Requirements:** specification-authority#isolated-closure-candidate, delivery-governance#isolated-specification-publication
- [x] 0.2 更新 Comet 0.5.0 采用映射，记录 archive transaction、workspace finish journal、观察优先恢复与清理围栏的采用边界。
      **Blocked by:** 0.1
      **Acceptance:** 来源检查通过；映射明确不复制 Comet 双运行时、产品命令壳和等待合入模型
      **Requirements:** delivery-governance#recoverable-specification-publication

## 1. 保留隔离 Closure 候选

- [x] 1.1 扩展 Closure Result 与 Journal Receipt，使其绑定不透明 checkout identity 和 base OID。
      **Blocked by:** 0.2
      **Acceptance:** Result/Journals round-trip 保留候选身份；跨 checkout、跨 base 或缺失 candidate fail-closed
      **Requirements:** specification-authority#isolated-closure-candidate
- [x] 1.2 修改 OpenSpec Provider，关闭后不复制回开发者工作树、不提前清理候选，并支持 committed candidate 重放。
      **Blocked by:** 1.1
      **Acceptance:** close 成功、失败和恢复前后调用者 branch、HEAD、index、porcelain 完全一致；官方 archive 至多执行一次
      **Requirements:** specification-authority#isolated-closure-candidate, specification-authority#recoverable-closure-journal

## 2. 建立可恢复规格发布 Journal

- [x] 2.1 定义 `prepared → committed → pushed → completed` 规格发布 Journal、canonical digest、CAS Store 与精确转换守卫。
      **Blocked by:** 1.2
      **Acceptance:** 非法跳转、identity 漂移、重复 operation、OID/MR 不完整和 CAS 冲突均被拒绝
      **Requirements:** delivery-governance#recoverable-specification-publication
- [x] 2.2 在隔离 checkout 提交精确 Closure allowlist，并恢复 commit 成功但 Journal 尚未推进的窗口。
      **Blocked by:** 2.1
      **Acceptance:** 只接受 base 的单个子 commit、精确 changedFiles 和固定 message；额外 diff、错误 parent 或多个 commit 阻断
      **Requirements:** delivery-governance#isolated-specification-publication, delivery-governance#recoverable-specification-publication
- [x] 2.3 以 observe-first 方式发布 archive branch、创建或采纳唯一 MR，并稳定返回原 Publication item。
      **Blocked by:** 2.2
      **Acceptance:** push/MR 响应丢失可恢复；remote OID、head/base 或多个候选漂移时 fail-closed；重放不改变 Receipt identity
      **Requirements:** delivery-governance#recoverable-specification-publication
- [x] 2.4 只在规格 Journal completed 后清理 checkout，并让终态在 checkout 已缺失时仍可由远端事实重放。
      **Blocked by:** 2.3
      **Acceptance:** 非终态失败保留 checkout；终态清理后重试不重新 commit/push/create MR
      **Requirements:** delivery-governance#recoverable-specification-publication

## 3. 修正 Archive orchestration

- [x] 3.1 删除 Business Delivery 的 Closure 脏路径例外，让同仓业务发布重新要求原实现 worktree 完全 clean。
      **Blocked by:** 2.4
      **Acceptance:** Archive 不传 allowedDirtyPaths；业务 push/MR 仍绑定验证 OID，规格 diff 只存在隔离 checkout
      **Requirements:** delivery-governance#isolated-specification-publication, change-lifecycle#recoverable-archive-publication
- [x] 3.2 组合业务与规格发布 Receipt，并在任一部分失败时保持 Archive 可重试、全部精确完成时一次性终结 Run。
      **Blocked by:** 3.1
      **Acceptance:** 业务已发布/规格失败后重试只继续规格；最终 Receipt 完整且 Run completed/nextActions 为空
      **Requirements:** change-lifecycle#recoverable-archive-publication
- [x] 3.3 将 Archive CLI 的 Evidence attempt 与 Work attempt 改为不同参数并更新恢复提示。
      **Blocked by:** 3.2
      **Acceptance:** prepare 只接受 `--evidence-attempt`，publish 只接受 `--work-attempt`；旧歧义参数给出准确诊断
      **Requirements:** change-lifecycle#archive-attempt-identity

## 4. 生产验证与文档

- [x] 4.1 增加真实 Git fault-injection 集成测试，覆盖 after-commit、after-push、after-MR 与 checkout cleanup。
      **Blocked by:** 3.3
      **Acceptance:** 每个窗口由新进程式 Adapter 重放恢复，commit/push/MR 各至多一次，调用者工作树始终不变
      **Requirements:** delivery-governance#recoverable-specification-publication, specification-authority#isolated-closure-candidate
- [x] 4.2 增加生产组合 Archive E2E，验证同仓与多仓边界、Publication Receipt 和终态投影。
      **Blocked by:** 4.1
      **Acceptance:** E2E 使用真实文件 Store、Git worktree 与 RunStore，不 mock Journal/Closure Gate；同仓自举不污染 source branch
      **Requirements:** change-lifecycle#recoverable-archive-publication, delivery-governance#isolated-specification-publication
- [x] 4.3 更新 Delivery、Self-hosting、CLI 和架构文档并完成正式验证。
      **Blocked by:** 4.2
      **Acceptance:** OpenSpec strict、`npm run verify`、package E2E、tracer E2E、生产依赖审计与 provenance 全部通过
      **Requirements:** specification-authority#isolated-closure-candidate, delivery-governance#recoverable-specification-publication, change-lifecycle#archive-attempt-identity

## Workflow follow-up

- 四类 OpenSpec 产物 strict 通过并获得可信 Design approval 后进入 Build；当前分支保持公开，每次 commit 立即 push。
- Verify 使用正式 Acceptance Trace；Archive 前后记录调用者 branch、HEAD、upstream、index 与 porcelain 作为自举证据。
- 本 Change 只完成发布准备与 MR 创建，不等待或自动合入任何 MR。
