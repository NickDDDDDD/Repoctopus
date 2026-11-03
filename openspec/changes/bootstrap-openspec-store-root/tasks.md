# Tasks

## 1. 固定真实故障与获批 Root 计划

- [ ] 1.1 用固定 OpenSpec 1.14.3 CLI 在临时非空 Git Workspace 重现 `store_register_root_unhealthy`，建立“无 `openspec/` 时 register 失败”的红测。
      **Acceptance:** 测试调用真实安装包 entry而非 FakeProcess，断言错误码/结构化诊断对应缺失健康根，并证明未写业务仓 pointer或 `repoctopus.yaml`。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 1.2 在项目探测领域建模 `registered-exact | healthy-unregistered | missing-root | partial-or-unhealthy | conflicting-registration`，把 Provider/version、Workspace/Store identity和允许动作纳入候选摘要。
      **Blocked by:** 1.1
      **Acceptance:** 领域矩阵覆盖五种 disposition、Windows等价路径和 identity冲突；相同语义产生稳定摘要，任一授权事实变化产生不同摘要或 blocker。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 1.3 让 Human Decision展示 Root bootstrap与Store/pointer写入计划，并在 apply 前重新观察批准事实。
      **Blocked by:** 1.2
      **Acceptance:** 测试证明用户能看到将创建的 Root及Store id；批准后目录、Provider、Store或Workspace identity漂移会使决定失效且没有副作用。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根

## 2. 建立可恢复的 Root bootstrap

- [ ] 2.1 扩展 Store binding领域合约，加入不可变 `prepare-root` Intent/Receipt、固定初始化argv、初始disposition与有界结果码。
      **Blocked by:** 1.2
      **Acceptance:** 合约测试覆盖digest稳定性、不同request/Workspace/Provider/argv的identity隔离，以及篡改Intent、重复Receipt和跨request恢复拒绝。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 2.2 在OpenSpec平台适配器中实现根观察与官方初始化，使用固定安装包entry和无shell精确argv，不手写Provider私有文件。
      **Blocked by:** 2.1
      **Acceptance:** 端口测试断言精确执行 `init <workspace> --tools none --profile custom --language zh-CN --no-animation --no-copilot-cloud`；abort、timeout、非零退出、无效输出和路径越界均返回结构化诊断。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 2.3 为Root初始化持久化受限ownership/manifest checkpoint，并通过重新观察恢复“已落盘但结果未知”。
      **Blocked by:** 2.2
      **Acceptance:** 中断测试覆盖Intent后、init执行中、init落盘后和Receipt前；重启只恢复同request拥有且identity/manifest未漂移的根，既有或并发文件一律阻断且不删除。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 2.4 让健康既有根走 `already-healthy` 路径，让部分/不健康既有根fail closed且返回doctor诊断。
      **Blocked by:** 2.2
      **Acceptance:** 测试证明健康根没有内容改写，部分根不调用`init --force`、不清理目录、不写Root Receipt或后续配置。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上

## 3. 串联Store、多仓pointer与配置最后发布

- [ ] 3.1 重构OpenSpec Store registration为“健康证明后register、显式context复验”的结构化适配器，区分已登记、刚登记、冲突与结果未知。
      **Blocked by:** 2.2
      **Acceptance:** 单元测试覆盖精确registration、健康未登记、同id异checkout、metadata不一致、register已成功但结果丢失和无效JSON；不得回退default/nearest root。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 3.2 在onboarding事务中按 `prepare-root → register-store → pointers → repoctopus.yaml` 排序并复用现有request-scoped Intent/Receipt。
      **Blocked by:** 2.3, 2.4, 3.1
      **Acceptance:** 故障注入覆盖每个步骤；任何前置失败都没有后续副作用，重试只补缺失Receipt，同一动作不会重复写入。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 3.3 恢复现场已有“register Intent存在但Receipt缺失”的同request事务，不保留直接登记缺失根的旧分支。
      **Blocked by:** 3.2
      **Acceptance:** 以用户报告现场形状建立测试：新代码补做Root preparation、完成原register Intent并发布一次配置；Intent identity漂移时仍阻断。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根
- [ ] 3.4 保持业务仓本地Root与pointer冲突检查，证明Workspace bootstrap不会扩大到覆盖业务仓。
      **Blocked by:** 3.2
      **Acceptance:** 多仓测试含一个可安装pointer仓和一个已有本地Root仓；冲突仓使事务在任何pointer/config发布前停止，既有文件逐字节不变。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上

## 4. 真实CLI、多仓验收与文档

- [ ] 4.1 建立隔离OpenSpec home/registry的真实CLI集成夹具，并验证它绝不读取或写入开发者registry。
      **Blocked by:** 3.1
      **Acceptance:** Windows与CI测试启动前后都证明registry目标位于受控临时目录，失败清理只删除已验证的临时路径；无法证明隔离时验收失败而非退回mock。
      **Requirements:** specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.2 用真实CLI完成全新非空Workspace、健康未登记Root、中断恢复、部分Root和Store冲突的端到端矩阵。
      **Blocked by:** 3.3, 3.4, 4.1
      **Acceptance:** 成功路径的显式`context --store`精确指向临时Workspace且四类OpenSpec规划目录可用；失败路径无pointer/config提前发布、无真实registry污染。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.3 更新项目接入、Specification Authority与故障排查文档，解释Root创建、Store本机登记、多仓pointer及安全恢复顺序。
      **Blocked by:** 4.2
      **Acceptance:** 文档不再声称首次接入只执行register；给出公司新仓场景、可操作诊断和重试入口，明确禁止手工改Runtime Store或盲删`openspec/`。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 4.4 核对Comet 0.5.1采用边界与第三方来源记录，确保只采用事务不变量而未复制源码。
      **Blocked by:** 4.2
      **Acceptance:** provenance检查通过；采用报告记录参考模块、固定版本、采用/拒绝内容与许可证结论，不把Comet状态文件或单仓假设带入产品。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根

## 5. 交付验证

- [ ] 5.1 在隔离的模拟多仓项目中通过正式CLI完成一次首次初始化，随后创建并严格校验一个最小Change，证明Store pointer与Specification Provider可实际消费。
      **Blocked by:** 4.2, 4.3, 4.4
      **Acceptance:** 全程不使用Repoctopus自举Runtime、不手工编辑journal；第二进程冷启动仍解析同一Store，模拟业务仓没有复制规格权威。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
- [ ] 5.2 运行相关Vitest、真实CLI/package E2E、typecheck、lint、architecture/provenance/generated、严格OpenSpec和完整`npm run verify`，形成正式验证报告并清理临时产物。
      **Blocked by:** 5.1
      **Acceptance:** 全部命令成功；分支每次提交均已push；没有临时Workspace、隔离registry、调试日志、测试Store或未跟踪产物残留。
      **Requirements:** project-configuration#获批项目接入以可恢复事务物化规格根; specification-authority#workspace-store-登记必须建立在健康规格根之上
