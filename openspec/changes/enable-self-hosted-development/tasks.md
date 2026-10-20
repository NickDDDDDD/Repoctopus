# Tasks

## 1. 固定第三方能力与当前基线

- [x] 1.1 在干净主线执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，记录当前通过结果与 Node/npm/平台版本作为重构基线。
- [x] 1.2 从固定 DSH commit 生成 Skill Registry、文件 Provider 和 Webhook 接入的完整源码依赖闭包，逐包记录直接采用、最小适配或排除理由；用来源报告证明没有因依赖数量跳过满足需求的成熟实现。
- [x] 1.3 固定 Matt Skills 上游 commit、MIT 许可证和首批 Skill 文件，登记逐文件摘要与资源引用；运行来源检查验证任一快照漂移都会失败。
- [x] 1.4 扩展 `third_party` 来源清单、架构能力账本和构建文件清单，执行 `npm install`、`npm run check:provenance` 与篡改 fixture 测试验证第三方快照不可静默修改。

## 2. 交付可用的 Skill 能力纵切

- [x] 2.1 采用 DSH Skill Registry 行为闭包建立唯一 `ctx.skills` Service，并用契约测试覆盖 Provider 注册、作用域优先级、同名裁决、不完整发现、取消、失效和 Fiber 撤销。
- [x] 2.2 实现内置 Matt Skill Provider 与项目/用户文件 Provider，首批暴露 `grill-with-docs`、`tdd`、`diagnosing-bugs`、`code-review` 和 `teach`；运行测试验证同名 `tdd` 可替换且 Workflow 不引用 Provider。
- [x] 2.3 实现版本化 `skill list/get/project` Command/API 与受管文件清单，用 Codex 和 OpenCode Adapter fixture 验证相同解析结果、摘要稳定和本地编辑冲突诊断。
- [x] 2.4 将首次 Skill 使用快照绑定到 Run、Checkpoint、Trajectory 和 composition compatibility；运行正文漂移、未使用 Skill 改动和中断恢复测试。
- [x] 2.5 将 `teach` 工作目录限制为 `.repoctopus/learning/<topic>/`，更新默认忽略、Evidence 选择和遥测排除规则；运行临时 Git 仓测试证明个人学习文件不会进入待提交集合或 OTel 事件。
- [x] 2.6 编写 Skill Provider、IDE 投影、替换方法和 Teach 本地状态文档，并按文档从打包产物列出、加载和投影一次 Skill。

## 3. 交付可替换的规格权威纵切

- [x] 3.1 定义唯一 `Specification` Cordis Service 和规范化 change、产物、校验、关闭计划与关闭结果类型；用 App Boot 测试验证零 Provider、一个 Provider 和多个 Provider 的诊断。
- [x] 3.2 实现 OpenSpec Provider，通过受控进程端口调用官方命令并解析版本化结果；用临时项目测试 inspect、严格 validate、prepareClosure、close 和重复 close。
- [x] 3.3 将规格校验接入 Evidence，将 Provider 身份与计划摘要绑定到 Run；运行校验失败、Provider 漂移和普通成功结果绕过测试。
- [x] 3.4 实现规格资料冲突到 Human Decision 的结构化转换，用 Spec 与设计 fixture 验证冲突会阻断受影响步骤且用户决定可以恢复。
- [x] 3.5 编写 Specification Provider 契约与 OpenSpec 接入文档，并用打包 CLI 对本 change 执行 inspect 和严格校验。

## 4. 交付可信且可恢复的平台事件入口

- [ ] 4.1 定义 Provider 无关 Delivery Envelope、Event Inbox Aggregate、Store 事务、租约、Receipt 和状态转换；运行确定性摘要、重复写、并发领取、租约过期和损坏 Journal 测试。
- [ ] 4.2 采用 DSH GitHub Webhook 的请求约束、HMAC 和无损载荷语义实现 GitHub Adapter，并接入 Credential Provider；运行方法、Content-Type、体积、Header、秘密缺失、签名失败和成功 fixture 测试。
- [ ] 4.3 实现 HTTP Host Service 与 Route Contributor，确保 Inbox 原子提交后才返回 202；以故障注入测试证明写入失败返回可重试错误且不丢投递。
- [ ] 4.4 实现 PlatformEvents Service 和 Runner 领取循环，通过 Cordis Effect 与 Operation Ownership 管理 Route、Timer 和活动操作；运行卸载排空、重启恢复、重试等待和死信测试。
- [ ] 4.5 增加 `event status/replay/retry` 管理命令与 OTel 映射，测试重复和乱序事件只产生一个逻辑任务，且输出不含签名、Token、Header 或原始 payload。
- [ ] 4.6 编写 Runner、GitHub webhook、安全边界和失败恢复文档，并按文档使用签名 HTTP fixture 完成一次进程外收件与恢复。

## 5. 交付合入后自动收尾纵切

- [ ] 5.1 扩展 Delivery Intent/State 记录 workspace MR 与完整业务 MR 集合，并用迁移无要求的新状态 Schema 测试事件唯一映射、零匹配、多匹配和主动 refresh 等价行为。
- [ ] 5.2 实现 PostMergeCoordinator，收到唤醒后经 `MergeRequestPort` 重新读取所有 MR 权威状态；用 mock GitHub 测试部分合入、关闭未合入、最后合入、重复事件和乱序事件。
- [ ] 5.3 增加 Post-merge Workflow 与幂等 Run 启动，把检出、Evidence、规格关闭、路径审计和发布表示为 Action Intent/Receipt；运行并发启动与进程中断测试证明只有一个逻辑 Run。
- [ ] 5.4 实现精确 merge commit 的隔离临时检出和合入后 Evidence，测试目标分支继续前进、多个业务仓、失败 Gate、输入漂移与清理行为。
- [ ] 5.5 实现收尾路径与语义 Guardrail，测试只允许主规格、change 归档和验证记录，任何业务源码、未知文件、宽泛通配或与关闭计划不一致的差异均 fail-closed。
- [ ] 5.6 扩展受保护 Delivery Action，在策略完整时自动创建普通收尾 commit、推送并更新原 workspace MR；用 bare remote 测试成功、响应丢失恢复、远端漂移、MR 已关闭以及 merge/force-push/rebase/删分支拒绝。
- [ ] 5.7 为合入事实、Evidence、规格关闭和远端 Receipt 增加低基数 OTel 关联，并更新交付与收尾文档；运行隐私断言和文档命令冒烟测试。

## 6. 完成项目配置、组合和架构治理

- [ ] 6.1 扩展 `repoctopus.yaml` Schema 以配置 Skill Provider、Specification Provider、平台事件和 `postMerge` 策略，并用正反 fixture 验证秘密只能引用 Credential、允许路径不能退化为项目根。
- [ ] 6.2 把新增 Service、Provider、Contributor 与 Application Plugin 加入 builtin catalog 和 composition digest；运行 bootstrap/project、依赖缺失、卸载重载和不兼容恢复测试。
- [ ] 6.3 扩展架构检查，拒绝第二个 Skill/Specification 容器、平台 Adapter 直写 Run、Coordinator 直写领域 Store、非 Provider 关闭规格和未受保护 Git 发布；以违规 fixture 证明每条约束有效。
- [ ] 6.4 更新 README 与架构文档的自举链路、Runner 部署、数据边界和来源关系，执行品牌扫描确保公共产品面没有旧工作流入口或具体宿主项目字段。

## 7. 使用 Repoctopus 自身完成真实闭环

- [ ] 7.1 用打包后的 Repoctopus 对本 change 启动生产 composition Run，加载实际 Skill、调用 OpenSpec Provider、执行实现 Evidence 并保存 Skill/规格/composition 快照；检查 Trajectory 不含测试旁路。
- [ ] 7.2 在临时多仓与 mock 平台中完成签名 webhook → Inbox → 全部 MR 合入核对 → Post-merge Run → Evidence → OpenSpec 同步/归档 → workspace commit/push/MR update 的独立进程 E2E，并强制中断至少一次后恢复。
- [ ] 7.3 执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，生成包含架构约束、第三方来源、恢复实验、已知限制和清理结果的验证报告。

## Workflow follow-up

- 用户批准最终验证报告后，按 Repoctopus Delivery 发布当前 workspace MR；批准不授权自动 merge。
- 当前 MR 合入后，由本 change 新增的平台事件与 Post-merge Run 完成合入后复验、主规格同步、归档、收尾 commit/push 和原 MR 更新；如果平台无法回调，使用 Inbox 回放或主动 refresh 唤醒同一路径。
- workspace MR 最终由团队或代码平台策略合入，Repoctopus 只记录合入事实。
