# Tasks

## 1. Open 宿主审批纵切

- [ ] 1.1 为非 TTY Host 无法合法回传当前 Open 决定建立真实失败回归，同时固定当前请求、提案、四件套和 isolation 的读取合同；保存 RED 命令与诊断。 <!-- comet-task:45cc005b-f601-4196-996a-36d1b4ab5dfd -->
      **Acceptance:** 回归在原实现上因缺少公共宿主回传路径失败，不能用伪造 TTY、内部 Service 调用或 Store 写入冒充复现。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 1.2 实现有界的当前决定材料读取和显式 Host-mediated 提交，复用统一组合及规划决定权威；补齐 CLI／服务回归和公开用法。 <!-- comet-task:eb078f36-db52-45a1-ad98-02f90f0e1016 -->
      **Blocked by:** 1.1
      **Acceptance:** 非交互 Host 提交已取得的匹配用户选择后，Runtime 接受 Open 并按当前 isolation 和规划重验规则创建 Design Work；原终端路径仍通过。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 1.3 将读取、提问、等待、提交和核对步骤接入 ask continuation 与 Host 指引，优先原生提问并支持对话选项回退；增加协议测试和使用说明。 <!-- comet-task:fbc0c4ae-7dfa-4e77-830d-de9eff46e8ac -->
      **Blocked by:** 1.2
      **Acceptance:** 指引包含实际请求允许的选择及必需输入；无用户答复时不调用决定提交，无可用交互上下文时提供终端回退，不要求用户手工复制摘要。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交

## 2. 独立审批与恢复边界

- [ ] 2.1 覆盖 Design、执行意图修订和 Build Plan 风险请求，通过同一公开交互路径处理真实类型及必需字段；更新相应文档并运行参数化回归。 <!-- comet-task:dcf7ce8a-35df-4cb3-b0f9-1e62672a1b5c -->
      **Blocked by:** 1.3
      **Acceptance:** Open 决定不能批准 Design，其他等待不被伪装成规划批准；同一入口所有现有决定种类均有成功或拒绝的明确路径。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.2 为错误 Run、requestId、proposalHash、旧阶段、非法选择和规划／Provider 漂移增加先红后绿回归，复用当前规划有效性及隔离校验。 <!-- comet-task:2b099ab6-895c-49ed-a88b-2bc003535bf5 -->
      **Blocked by:** 2.1
      **Acceptance:** 每类非法响应都有可定位诊断，缺失或不兼容 isolation 在写入批准前被拒绝；当前请求及其他有效决定不受损，不产生部分批准。合法参与 Run 保留同语义规划批准复用，无请求参与事实的 Run 不能凭同名 change 冒领批准。
      **Requirements:** change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.3 验证真实用户交互与普通 Work Outcome 的边界，核对来源和授权依据的记录、缺答复保持等待及终端回退；运行负例并完善信任边界说明。 <!-- comet-task:bb96f143-5cd5-4691-b286-b437f58ff22a -->
      **Blocked by:** 2.1
      **Acceptance:** Work Outcome 或推荐值不能充当 Human Decision；Host 回传不伪装为另一个 IDE 认证会话，文档不把本地 CLI 参数宣称为独立人类点击证明。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.4 在提问后、决定已接受但响应返回前分别中断并以新进程核对恢复；覆盖重复和冲突回传，记录原请求及后继身份。 <!-- comet-task:531e8859-c670-472f-8370-f36b2bf790d6 -->
      **Blocked by:** 2.2, 2.3
      **Acceptance:** 原请求或已接受决定可核对；不重复推进 phase/checkEpoch，不重派已接受后继 Work，不覆盖原决定，也不因恢复额外要求批准。
      **Requirements:** change-lifecycle#宿主人工决定恢复保留原请求及已接受结果

## 3. 观测与实际安装包验收

- [ ] 3.1 对齐实际采用的 Comet 固定来源、provenance 和 Human Decision／Wait 观测，运行来源审计、遥测隐私与有界标签测试并更新字段说明。 <!-- comet-task:4c916fb7-f239-4117-ba92-d31b9dbce115 -->
      **Blocked by:** 2.4
      **Acceptance:** 观测只来自已持久化决定，可关联原请求且不上传问答正文或凭据；没有新审批后端、SDK 依赖或用遥测提交决定的入口。
      **Requirements:** specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 3.2 用规范 Git 字节打包并独立安装，在真实多仓目录验证 Open／Design 两次独立审批、isolation、公开 CLI 提交和冷恢复；至少保存一次真实宿主原生问题、用户选择及 Runtime 接受的完整回执。 <!-- comet-task:cb90b94f-8f60-4e40-8e55-c11e34c53123 -->
      **Blocked by:** 3.1
      **Acceptance:** 安装包身份、真实交互来源和请求／提案／阶段前后事实可核对；无终端手工决定即可完成宿主路径；模拟 Host 与真实 UI 证据明确区分，未完成真实交互时不宣称验收通过。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案

## 4. 集成验证准备

- [ ] 4.1 完成独立集成审查和相关回归，整理正式验证报告、实际包身份与 RED／GREEN／恢复回执，并固定 Comet 完整 Build／Verify 的精确检查入口。 <!-- comet-task:85e5ae15-673f-49c4-869f-684fe4cd9f36 -->
      **Blocked by:** 3.2
      **Acceptance:** 无未处理阻断发现，源码与验证候选一致；报告不提前宣称后续 Guard、归档、CI、合入或发布已完成，不放宽严格包身份校验。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案

## Workflow follow-up

- Open 四类产物完成并通过预检后，取得当前范围的人工批准，进入正式 Design；深化同一 design.md 并确认正式设计及本 Change 的执行配置后才能实施。
- 同一 Comet Run 实际执行 check policy 声明的完整 Build 与 Verify，依据真实收据判断结果。
- 完整 Verify 和独立审查通过后核对归档及交付授权；本次不发布 Release，不收尾或修改其他未归档提案。
