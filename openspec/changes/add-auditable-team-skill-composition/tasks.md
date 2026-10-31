# Tasks

## 1. 固定现状与领域合同

- [x] 1.1 为未声明 team binding 时的现有 Action/augmentation 组合、个人同名 Skill 不得进入团队 Run、调用方不得替换 Action 增加 characterization tests；运行相关 Vitest 文件并观察现状被固定。
- [x] 1.2 为未知 target/slot、重复 binding、Provider 歧义、带写权限 guidance、Action replacement 和冻结后漂移增加 red tests；确认测试因产品能力缺失而失败。
- [x] 1.3 定义 `TeamSkillBinding`、replaceable augmentation slot、`EffectiveSkillComposition`、规范化顺序与稳定摘要；运行领域单测并确认跨输入顺序摘要稳定。

## 2. 编译共享团队组合

- [x] 2.1 扩展 `repoctopus.yaml` 类型、Schema、Loader、示例和配置摘要，接纳版本化 `lifecycle.skillBindings` 的 guidance/replacement 角色；运行项目配置单测并确认非法路径和本机字段被拒绝。
- [x] 2.2 实现纯 `SkillCompositionCompiler`，校验 definition target/slot、角色、顺序、唯一 Provider、capability/invocation/resource contract；运行编译器单测并确认同输入得到同摘要。
- [x] 2.3 在 lifecycle definition 中为允许替换的 augmentation 建立显式 slot contract，保证 Action 不进入可替换集合；运行 definition/architecture tests。
- [x] 2.4 强化共享/本机配置合并边界，禁止 `.repoctopus/local.yaml` 和用户目录改变团队 binding；运行不同用户目录和不同父路径测试。

## 3. 交付真实纵切

- [x] 3.1 将有效组合身份纳入 Cordis composition、Run snapshot、Work input 和恢复兼容检查；运行重启、同摘要恢复和不兼容漂移测试。
- [x] 3.2 改造 Work materialization 与 Context Assembler，按冻结顺序交付 Action、内置 augmentation、team guidance/replacement 的真实内容与资源；运行 packet/Host contract 测试。
- [x] 3.3 让 Host outcome 只可对当前 packet layer digest 提交 consumed 回执，拒绝旧层、未知层和补推成功；运行 managed execution 反作弊测试。
- [x] 3.4 在临时单仓 Workspace 配置一个 guidance 和一个 augmentation replacement，执行至少 Open/Design/Build packet 纵切并核对组合、内容与消费事实。
- [x] 3.5 在临时多仓 Workspace 重复纵切并覆盖不同父目录、重启和 Provider 漂移，确认路径不进入共享摘要且漂移 fail closed。

## 4. 遥测与桌面投影

- [x] 4.1 定义 composition compiled/rejected/drifted、binding resolved、layer delivered/consumed 的版本化 Trajectory 事件；运行 schema 与重放测试。
- [x] 4.2 扩展 OTLP 映射、隐私和基数门禁，保证正文、Prompt、本机路径、个人身份和自由名称不进入指标；运行 telemetry mapping/privacy tests。
- [x] 4.3 更新 Desktop projection 和当前 Work UI，按 Action、内置 augmentation、team guidance/replacement 展示 resolved/delivered/consumed；运行 reducer、组件和 Windows 打包测试。
- [x] 4.4 用同一 OTLP receiver 驱动桌面投影，确认没有文件查询或轮询旁路，重复 envelope 收敛为相同状态。

## 5. 文档与验收

- [x] 5.1 更新项目配置、Skill Provider、lifecycle、遥测、Dashboard 和 self-hosting 文档，明确 consumed 不是方法证明；运行文档链接与示例校验。
- [x] 5.2 运行 `npm run spec:validate`、相关 package/tracer E2E、`npm run verify`，生成绑定验证 HEAD、Run、配置和 composition digest 的正式验证报告。
- [x] 5.3 清理临时 Workspace、receiver、状态卷、日志和 payload，确认 `git status` 只包含预期产品与正式证据文件；提交并推送远端分支。
