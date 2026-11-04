# Tasks

## 1. Freeze the conflicting historical contracts

- [x] 1.1 为四个历史Change建立characterization matrix，锁定Binding capability identity、Configure全量能力、外部Host精确声明和Plan correction各自的现有行为。 <!-- comet-task:0a8c7088-c1e8-4a09-9f7c-33c269824f5e -->
      **Blocked by:** none
      **Acceptance:** 测试和设计证据明确指出每条规则的owner、输入、持久化事实和失效边界；不得只记录commit message
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [x] 1.2 使用公共外部Host协议固定真实RED：Configure成功后，相同Host ID以Plan最小能力claim并提交candidate，`run next`在Plan validator前抛出完整Binding能力异常。 <!-- comet-task:40d4a113-a339-4b5e-8350-52448f19ea84 -->
      **Blocked by:** 1.1
      **Acceptance:** fixture断言claim、packet、invocation和submission均已持久化，异常来自全局Binding能力重建；测试不修改Store、不匹配完整人类错误全文
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [x] 1.3 固定测试盲点：证明嵌入式E2E Host在每个Work声明能力超集，而既有外部Host测试只覆盖claim、不覆盖Outcome processing。 <!-- comet-task:b33d75b1-b5e0-43e9-b174-18653731e251 -->
      **Blocked by:** 1.2
      **Acceptance:** 新回归必须在缺少任一侧时失败，防止单元测试分别通过却纵向合同再次冲突
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略

## 2. Establish one capability authority

- [x] 2.1 破坏性升级ExecutionBinding schema，删除Host capability digest、Plan Evidence host capability digest和对应serializer/fixture/compatibility分支。 <!-- comet-task:5961fcea-c280-417f-9900-3c6e816cf2f3 -->
      **Blocked by:** 1.3
      **Acceptance:** 生产代码定向搜索不再存在跨Work capability identity；旧schema活动Run只返回结构化`migration_required`，没有双读或默认值猜测
      **Requirements:** managed-work-execution#buildstrategy-与-executionbinding-使用独立身份
- [x] 2.2 将Configure Work收窄为当前Action真实所需capabilities，并保持Strategy、Workspace和coordinator Host identity验证。 <!-- comet-task:e28bb111-aeba-443f-9788-6d8bfe6c75ea -->
      **Blocked by:** 2.1
      **Acceptance:** Configure不要求未来Execute的repository/process能力；能力不足仍在当前Configure claim前失败
      **Requirements:** managed-work-execution#build-configure-产生可批准的不可变配置
- [x] 2.3 统一WorkDispatcher与ManagedWorkExecutor的pre-claim capability validator，禁止从Work requirements反向补齐Host声明。 <!-- comet-task:cfd4ea4f-d1fb-48d3-bcc6-89ea93e7bed6 -->
      **Blocked by:** 2.2
      **Acceptance:** Configure、Plan、Execute和Check共享同一helper；缺失能力时claim、packet ownership和invocation计数均为零
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域

## 3. Align Outcome and recovery semantics

- [x] 3.1 删除Plan、Execute和Check Outcome processing中的capability-based Binding rebuild，只保留原claim身份与Binding-owned事实验证。 <!-- comet-task:52d11eab-cc19-4341-9721-94a7265daf1e -->
      **Blocked by:** 2.3
      **Acceptance:** Plan最小能力submission进入原validator并产生唯一Plan revision；不创建Configure Work或第二个Plan Work
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [x] 3.2 统一三个入口的Outcome acceptance顺序和共享helper，保留candidate correction与processing-error边界。 <!-- comet-task:0eeed472-c996-4b9b-9b64-60282c15d9fc -->
      **Blocked by:** 3.1
      **Acceptance:** Plan、Execute和Check不再维护独立能力顺序；candidate rejection保留同一claim，程序错误继续fail closed
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [x] 3.3 对齐Comet unknown execution恢复：reconcile原claim，仅在权威未执行证据后允许受控retry。 <!-- comet-task:530dc513-95c6-4c56-af8c-f3ee38bb1659 -->
      **Blocked by:** 3.2
      **Acceptance:** unknown状态不派发Configure、不新建Work、不重放副作用；进程重启后仍引用原invocation
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域

## 4. Prove the vertical product contract

- [x] 4.1 建立外部Host最小能力纵向E2E：Configure→Plan→Execute blocked→Execute accepted→Check，覆盖单仓和多仓。 <!-- comet-task:9ef440e3-3a54-47f9-9340-e418eb12902f -->
      **Blocked by:** 3.3
      **Acceptance:** 每个Action只声明自己的最小能力；合法claim正常推进，能力不足只阻断当前Work，Strategy/Binding和approval保持不变
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略
- [x] 4.2 增加重启、重复pull、并发claim、submission重放和unknown reconcile矩阵。 <!-- comet-task:a05a32be-6e54-4ff8-bdd5-91ff023cd280 -->
      **Blocked by:** 4.1
      **Acceptance:** 每个边界只有一个claim/invocation/accepted Outcome；重复调用返回相同continuation或revision conflict
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [x] 4.3 更新Trajectory、OTLP和Dashboard projection，区分claim capability rejection、executor blocked、unknown reconcile和真正Binding drift。 <!-- comet-task:a113e6dc-1e46-4abb-a94a-2cf9da74352f -->
      **Blocked by:** 4.2
      **Acceptance:** 最小能力Plan/Execute不会增加binding drift或Configure retry指标；identity和capability文本不进入Metric labels
      **Requirements:** development-telemetry#build-策略绑定与人工等待必须可观测

## 5. Verify and deliver

- [ ] 5.1 运行领域、Service、CLI、单仓/多仓E2E、重启与架构测试，并执行strict OpenSpec、typecheck、lint、generated、provenance和完整`npm run verify`。 <!-- comet-task:3cdbf292-6c52-45b3-847b-2a8ac24a18c3 -->
      **Blocked by:** 4.3
      **Acceptance:** 所有门禁通过；定向搜索证明没有全局Binding capability identity或三个入口的重复能力顺序
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 5.2 保留round4旧Run和错误输出作为正式失败fixture，用修复后的打包产品启动相同两包TDD多仓验收。 <!-- comet-task:8d4294ba-4368-4fcf-9840-99a8c335b820 -->
      **Blocked by:** 5.1
      **Acceptance:** 不编辑旧Store；新Run完成Configure→Plan并能正确阻断/接受Execute Host，最终继续到Check
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略
- [ ] 5.3 更新运行时文档和正式验证报告，提交、推送并清理临时日志、JSON与scratch输出。 <!-- comet-task:71cbf4a9-a53c-43a3-b1ea-994682579485 -->
      **Blocked by:** 5.2
      **Acceptance:** 文档说明Work capability、Binding和unknown recovery的唯一owner；验证报告绑定最终commit和命令结果，工作树干净且远端同步
      **Requirements:** development-telemetry#build-策略绑定与人工等待必须可观测
