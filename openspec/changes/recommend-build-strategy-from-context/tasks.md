# Tasks

## 1. 打通未决偏好到 Design 决定的生产路径

- [x] 1.1 先建立缺参默认冻结的失败回归，再更新启动偏好与建议协议，验证缺参、部分输入、完整输入和非法输入 <!-- comet-task:a62e6fb0-79be-4feb-b8f4-ced99cf94d42 -->
  **Acceptance:** 修复前公开启动路径因静默补全而失败；修复后缺参可进入 Open，部分偏好不被覆盖，非法值不创建 Run，完整值仍需当前可信批准；spec approval prepare 绑定同一 Run 候选和隔离意图，不再补默认策略；相关类型与回归检查通过。
  **Requirements:** change-lifecycle / 未指定的启动偏好不得成为已批准策略。
- [x] 1.2 将 Design Work 的完整建议接入当前决定视图与原子批准路径，验证 Configure 使用同一已批准策略 <!-- comet-task:2b7a50f4-1883-401e-a4a7-1923062a0f3e -->
  **Acceptance:** 公开 Work Outcome 可提交两轴建议、理由与来源；缺项或非法候选保留原 invocation 进入可补交纠正，不提前记成功；陈旧响应不能进入 Build；真实当前 Design 决定一次批准规划与策略，Configure 不追加相同配置问题；同步更新运行时状态及协议说明。
  **Requirements:** change-lifecycle / Build Configuration 只允许受支持的固定策略；场景建议与策略授权保持可核对且可恢复。
  **Blocked by:** 1.1。

## 2. 接通场景建议和用户接入体验

- [x] 2.1 更新入口、Design 与 Configure Skill 的责任及安装模板，用消费契约检查验证场景指引与 Runtime 权威一致 <!-- comet-task:6c5c49ef-7a54-4189-af15-ad85e9394d5d -->
  **Acceptance:** 入口不要求先选全才启动；Design 分别分析两轴并展示当前偏好；Configure 不再宣称重新批准策略；已安装入口、冻结 packet 与模板保持一致，不增加独立方法或规划权威。
  **Requirements:** skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略；change-lifecycle / Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 1.2。
- [x] 2.2 更新 CLI 帮助、工作流说明和 Workspace 本地教程，用生成产物检查和实际命令验证缺省与显式选择示例 <!-- comet-task:a701ac8f-c99a-40cf-99aa-e6d6477fe3e2 -->
  **Acceptance:** 文档清楚区分推荐、偏好、批准和实际执行；示例覆盖两轴独立与能力限制，没有默认为已批准或新增第三次常规确认的说明；初始化生成文档与源码说明一致。
  **Requirements:** change-lifecycle / 未指定的启动偏好不得成为已批准策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 2.1。

## 3. 守住恢复、能力与执行证据边界

- [ ] 3.1 扩展决定及恢复回归，验证相同提案、响应丢失、显式改选和等价收尾的审批及失效次数 <!-- comet-task:e50b95cd-d8e9-4d5e-aee7-b898aa205a16 -->
  **Acceptance:** 新进程复用原请求或接受事实，覆盖 Provider approval 已写入但 Run gate 尚未提交的中断；相同配置只批准一次；run revise-strategy 从安全 Build/Verify 边界进入受管 Design，执行未知时阻断、终态拒绝、请求重放幂等，改选不复用旧答复；提交、checkbox、措辞或单纯能力缺席不使相同策略重新批准；真实规划或策略变化仍触发现有正确恢复路径。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 1.2。
- [ ] 3.2 验证四种支持组合及缺能力分支，核对实际 Execute Skill、TDD 和委派回执约束 <!-- comet-task:67524809-8c40-40c4-b28e-3e05e578cba3 -->
  **Acceptance:** 两轴四种组合均可被合法选择；tdd 实际交付方法且要求 RED/GREEN/回归证据；direct 保留适用检查；多 Agent 要求真实受管委派证据，缺能力明确阻断不静默降级；autonomous 不接受未声明的委派。
  **Requirements:** skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略；change-lifecycle / Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 2.1；3.1。

## 4. 真实安装包多仓验收与完整验证

- [ ] 4.1 用实际候选包和宿主执行小型多仓 Change，完成场景建议、原生 Design 选择、实际执行、同 Run 冷恢复和 Archive <!-- comet-task:2171ed0c-5507-4d1e-a071-7e0414535fd8 -->
  **Acceptance:** 行为修改、可分工多包和纯文档场景有实际依据；至少一次真实宿主原生选择并经正式接口提交；在决定和首包边界冷恢复保持有效事实；到 Archive 后无重复发布；现有配置、Work/Skill 与恢复遥测对应实际批准选择，不以自造批准替代真实交互。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；未指定的启动偏好不得成为已批准策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 2.2；3.2。
- [ ] 4.2 完成独立审查与完整 Verify，交付绑定实现和实际验收包身份的正式验证报告 <!-- comet-task:d55b0d76-6d49-481c-be64-881c115c4ff7 -->
  **Acceptance:** 独立审查无未解决阻断项；声明的完整验证和严格规格校验通过；`verification/recommend-build-strategy-from-context/verification-report.md` 包含实际实现提交、包内容摘要、文件数及字节数，原始实验记录可追溯，明确未覆盖限制。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；Build Configuration 只允许受支持的固定策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 4.1。

## Workflow follow-up

- 获得当前交付目标与影响的明确授权后，归档、创建 PR，并在 CI 通过后合入；不把归档动作列为实现 checkbox。
