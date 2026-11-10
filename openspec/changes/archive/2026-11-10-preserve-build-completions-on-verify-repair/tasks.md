# Tasks

## 1. 局部 Verify 修复垂直切片

- [x] 1.1 在领域和生产 Verify 路径建立真实 RED：四个可区分的已完成包中一个实现检查失败，断言原代码错误地失效全部 completion，保存失败命令和原因；回归不能只比较最终 projection。 <!-- comet-task:445e47c3-f66a-4390-9a76-a9b8fbdd81e0 -->
- [x] 1.2 修正 Verify 失败分类及修复 Plan 复核，使用现有失败 Evidence、Acceptance/Plan 关系验证范围，保留真实输入仍有效的独立包凭证；以局部失败回归转绿及原 Plan 语义身份保持为验收。 <!-- comet-task:da090b63-9a31-43a1-b82c-805a0a29be61 -->
- [x] 1.3 让已完成 Task 的实现修复通过普通受管 Execute、新 Check 和 Verify 完成，沿用 Task IDs 及有效配置，不新增 Repair Work kind 或影子任务；以同一 Run 真正执行单包修复、其余包 Execute 计数不增加为验收。 <!-- comet-task:1532b36d-0809-4d7b-974f-36a60807a939 -->
- [x] 1.4 将实际失败、影响/保留范围、修复 Work 与新检查接入既有 Trajectory/OTLP 记录，补齐本组对应设计说明与回归；验收恢复原因不虚报 Plan 漂移、事件可关联且指标不包含高基数或敏感原文。 <!-- comet-task:7872e6c7-872a-490c-817e-4b87cf035268 -->

## 2. 依赖与权威边界

- [x] 2.1 覆盖包依赖传播、跨仓读取、无法证明范围的阻断及有依据的真实全局失效；验收仅受影响闭包失效，未知范围不伪造最小集合，真实全局变化不错误保留凭证。 <!-- comet-task:732baf3b-8ef1-46e1-8987-4f3c1b33556c -->
- [x] 2.2 复核保留 completion 的实际包契约、依赖、输入及授权，覆盖真实 Plan/Design 变化和修复期间的输入漂移；验收沿相应权威恢复，等价 checkbox/commit 提交的既有保护仍通过。 <!-- comet-task:1cb4397d-0cba-43f3-9f72-91198bc0a336 -->
- [x] 2.3 验证旧 epoch、错误 invocation、缺失 consumed layers、能力或分支越权、重复或畸形 Outcome 的拒绝；验收原始失败/拒绝历史保留，修复不能绕过 Host、Validator、Build Check 或 Verify。 <!-- comet-task:22fddfd1-41fc-49bb-8658-a6ffc9ccc628 -->

## 3. 恢复与交付验证准备

- [x] 3.1 在失败持久化、修复 Plan 接受、单包修复完成及新 Check 接受后分别退出并以新进程 resume/next；验收同一 Run、稳定保留凭证、正确修复进度和无重复 Execute，不重复审批有效配置。 <!-- comet-task:ae91bbe7-9ad9-48b4-8239-2ccc013b261e -->
- [x] 3.2 使用本次实际打包安装的公共 CLI 在全新多仓实验目录完成四包局部失败→修复→Check→Verify 场景，保存节点/Execute 次数、Plan/completion/Gate 身份及负例；不得以源码内部调用或手改 Store 冒充安装包验收。 <!-- comet-task:ca51bd44-ea75-4e37-b880-c464bde108bb -->
- [x] 3.3 完成当前实现的独立审查，整理真实 RED/GREEN、相关回归和多仓安装包回执，固定验证报告及 check-policy 的完整命令入口，确保后续 Comet Verify 可以实际执行；此勾选不宣称后续完整阶段检查、归档、CI 或发布已经完成。 <!-- comet-task:996f4530-3aae-4e0a-8671-23d51e0ff58b -->

## Workflow follow-up

- 当前 Open 产物经用户审查后进入正式 Design；深化同一 design.md 并取得正式设计及本 Change 执行配置批准后才能实施。
- Build 任务及检查就绪后，同一 Comet Run 实际执行精确 `npm.cmd run build` 与 `npm.cmd run verify`；完整检查通过前不得归档。
- 完整 Verify 与独立审查合格后，再核对归档及交付授权；本次不发布 Release，不覆盖旧实验 Store，也不修改其他活动 Change。
