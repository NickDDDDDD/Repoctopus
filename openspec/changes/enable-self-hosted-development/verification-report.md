# enable-self-hosted-development 验证报告

## 报告状态

- 结论：实现与本 change 的 Proposal、Design、Delta Specs 和 Tasks 一致，49 项任务已完成。
- 状态：业务 MR 与 Change MR 已拆分并登记到正式 Delivery，等待用户批准最终快照；批准不授权 merge。
- 验证日期：2026-10-21。
- 分支：`feat/enable-self-hosted-development`。
- 业务 MR：Draft PR #8；Change MR：Draft PR #9。
- 实现基线：`bdcf6f43a311c16220d23352bc2cd439ef6c5adb`。
- 实现代码树：`f68681ab88b95cb38c574111bbb4c6ecd3cb3681`。

## 结论

Repoctopus 现在可以用一个 Cordis project composition 组合可替换的 Skill 与 Specification Provider、持久 Platform Event Inbox、长期 Runner、一次性补偿和受保护的 Post-merge 动作。签名平台事件只负责实时唤醒；`post-merge reconcile` 与日常 `run start` 前置检查在 Webhook 缺失时调用同一个 Coordinator。Coordinator 必须重新读取全部业务 MR 的权威状态，随后以确定的合入事实创建或恢复稳定身份的 Post-merge Run。精确检出、Evidence、OpenSpec 同步/归档、路径审计、普通 commit/push 和原 Change MR 更新都由可恢复 Intent/Receipt 边界保护。

Change 是团队共享工作单元，不建立由 MR author、Git author、Bot 或 Runner identity 推导的独占 owner。多个 Runner 可以重复查询和验证同一 change；共享状态卷使用 Inbox Lease，独立状态卷使用 Change MR 分支精确 OID、普通非强制 push 和等价结果核对收敛远端副作用。

Change MR 与业务 MR 可以位于同一物理仓库，但不能复用同一个 MR。准备快照时，相同远端、源分支和目标分支的角色冲突会被拒绝；平台返回业务 MR 后，Delivery 再按稳定 MR 身份核对。业务 MR 合入关闭后，独立 Change MR 才能继续接收合入后 Evidence、主规格同步和 change 归档。

开发 checkpoint 已把本地 commit 后立即普通 push、建立 upstream、远端精确 OID 核对作为完成条件。Post-merge 路径继续禁止自动 merge、force push、rebase、删除分支、替换 Change MR 或修改业务源码。

## 验证环境

| 项目       | 值                                 |
| ---------- | ---------------------------------- |
| 操作系统   | Windows 10 Pro，64 位，build 26200 |
| Node.js    | 24.21.0                            |
| npm        | 11.19.0                            |
| Git        | 2.56.0.windows.2                   |
| OpenSpec   | 1.14.3                             |
| Repoctopus | 0.1.0                              |

## 自动验证

| 验证                         | 结果                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run verify`             | 通过；TypeScript、ESLint、构建、81 个测试文件、329 个测试通过，1 个 Windows 条件测试跳过         |
| `npm run format:check`       | 通过；产品代码、测试、文档与 OpenSpec 文件符合统一格式                                           |
| `npm run check:generated`    | 通过；生成物无漂移                                                                               |
| `npm run check:brand`        | 通过；公共产品面命名一致                                                                         |
| `npm run check:architecture` | 通过；184 个生产源文件、20 个能力所有者及受保护源码边界通过                                      |
| `npm run check:provenance`   | 通过；20 个 Comet 派生文件、60 个不可变 Cordis 文件、24 个 Matt Skill 文件和 8 个固定 DSH 包通过 |
| `npm run spec:validate`      | 通过；9 项 spec/change 严格校验，0 失败                                                          |
| `npm run test:package-e2e`   | 通过；1 个隔离安装与打包 CLI E2E 通过                                                            |
| `npm run test:tracer-e2e`    | 通过；1 个独立 tracer E2E 通过                                                                   |
| `npm run check:upstream`     | 通过；DSH 与 Comet 默认分支均未偏离 2026-10-21 固定基线                                          |
| `npm audit --omit=dev`       | 通过；生产依赖已知漏洞 0                                                                         |
| `git diff --check`           | 通过                                                                                             |

唯一跳过项是 `filesystem-safety.test.ts` 中普通文件在读取期间被替换的竞态夹具。Windows 对已打开文件的替换语义无法稳定制造该 POSIX 场景；同文件中的临时文件篡改与父目录 Junction 逃逸仍在 Windows 执行，POSIX 替换场景由 Linux CI 承担。

本轮完整验证最初两次在 `self-bootstrap.test.ts` 检测到仓库输入选择变化。定向复现确认生产指纹保护正确，根因是并行的 `platform-event-recovery` E2E 在未忽略的 `test/` 子目录创建和删除临时 bundle。测试改为在已忽略且可解析依赖的 `node_modules/.repoctopus-platform-event-recovery-build-*` 中构建后，`self-bootstrap` 与恢复 E2E 并发组合连续 3 次通过，随后完整 `npm run verify` 通过。修复没有放宽指纹一致性检查。

## 架构约束证据

- Cordis 是唯一应用 Runtime；Engine 保持纯函数，Skill、Specification、PlatformEvents、WorkflowRuns、Evidence、Delivery 和 PostMergeCoordinator 通过 Service、Provider 与 Contributor 组合。
- 架构检查拒绝第二个 Skill/Specification 容器、平台 Adapter 直写 Run、Coordinator 直写领域 Store、非 Provider 关闭规格，以及绕过受保护动作的 Git/MR 发布。
- Workflow 只引用稳定能力，不绑定 Matt、OpenSpec 或 GitHub 的具体实现。项目 composition 选择一个规格权威；catalog 可以同时容纳备用 Provider。
- OpenSpec 的 Proposal、Delta Specs、Design 和 Tasks 是规划权威。普通设计决定保存在当前 `design.md`；验证事实保存在 Evidence 与本报告；不存在 `implementation-notes.md`、独立 ADR 或第五类 OpenSpec 产物。
- Post-merge Trigger 只绑定 MR 身份、merge commit、mergedAt 等权威事实，不把轮询产生的 `observedAt` 纳入 Run 身份。`merged` Delivery 只在没有更活跃匹配时作为恢复候选。
- 临时检出的逻辑身份仍由完整 Run ID 与 marker 核对，磁盘目录使用固定长度摘要，避免 Windows Git object/pack 深路径超限；无正确 marker 的目录不会被复用或删除。
- 普通 project composition 在配置 `postMerge` 时装配一次性 Coordinator、Action Provider 与命令 Contributor，但不装配 HTTP Host、Webhook Route 或后台 Timer；CLI 子进程完成补偿后正常退出。
- 多 Runner 不依赖人员归属或本地全局锁。远端竞争恢复要求胜出提交是同一审计基线的直接子提交，并逐项核对 tree、message、author 和原 Change MR；不等价结果停止而不是覆盖。
- Delivery 允许 Change MR 与业务 MR 同仓，但要求分支拓扑可区分，并在 Adapter 返回后按 `provider + repositoryId + number` 拒绝同一 MR 身份；URL 不作为绕过稳定身份核对的依据。
- 尚无人工决定且所有动作仍为零次尝试的 `pending` 时，重复准备相同快照幂等返回；新快照以新请求取代旧请求并保留被取代身份。旧响应、已批准状态和已开始动作不能被覆盖。

## 第三方来源

| 来源               | 固定版本或提交                                                                                                 | 采用边界                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| DeepSeek Harness   | `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`，MIT                                            | 直接使用 Skill Registry 包；适配文件 Skill 与 GitHub webhook 可信接入；不引入 Agent、Session、Workspace 或 fire-and-forget Webhook Runtime |
| Cordis             | 4.0.5，MIT                                                                                                     | 60 个文件保持官方 npm 发布快照不修改                                                                                                       |
| Cordis Loader      | 1.0.6，MIT                                                                                                     | 保留原始 module namespace 的上游重载修复，快照不修改                                                                                       |
| Comet              | `master` `575ab0d172e8105257b3c9172b8c8a9b628960ca`；0.4.5 tag `c90af44a4474662d7853aae76ce785404974fb0a`，MIT | 20 个来源登记的 Engine、Run、Evidence、Git/文件安全派生文件；多仓与 Post-merge 语义由 Repoctopus 原生实现                                  |
| Matt Pocock Skills | `49dd158d1076134a641b33efb035946536778336`，MIT                                                                | 固定 24 个文件；首批提供 code-review、diagnosing-bugs、domain-modeling、grill-with-docs、grilling、tdd 与 teach                            |
| OpenSpec           | 1.14.3                                                                                                         | 首个 Specification Provider；替换 1.14.1 后重新覆盖 inspect、严格 validate、prepareClosure、幂等 close 与打包契约                          |

DSH 与 Comet 的网络漂移检查独立于离线 `verify`，每天由 workflow 只读执行。发现漂移只触发审计，不自动移动固定基线。

## 自举与恢复实验

### 生产 composition 自举

- Run `self-enable-self-hosted-development` 使用正式 project composition 完成，状态为 `completed`，`stateVersion` 为 11。
- 该阶段 composition 摘要为 `sha256:94479412ba711c84750d8e1cbeeb191674b5d04c51ce3a73519f63e738888357`。
- Run 首次使用时绑定了 Matt Provider 的 `code-review` 与 `tdd` 内容/资源摘要，并接受 Evidence Bundle `7b3d8e253512af71582b97f0b3c471d1628e801b1f01beb1d4d4c378ff1bb2db`。
- Run 当时绑定 OpenSpec 1.14.1 的规格快照；随后安全升级到 1.14.3，并由当前 Provider 契约、打包 E2E 和本报告中的 9 项严格校验重新验证。旧快照不被静默改写。

### 独立进程 Post-merge E2E

`test/e2e/self-hosted-post-merge.e2e.test.ts` 在临时Workspace 仓库、两个业务仓、三个 bare remote 和 mock 平台中执行以下真实链路：

1. 独立 Runner 接收带 HMAC 的 GitHub webhook，并在 Inbox 原子持久化后返回 202。
2. 测试向 Runner 发送 `SIGKILL`，确认事件保持 `pending` 或 `leased`，再启动新进程等待租约恢复。
3. 恢复后的 Coordinator 通过 MergeRequestPort 重新读取全部业务 MR，忽略 payload 中的合入声称，并记录精确 merge commit。
4. 唯一 Post-merge Run 对两个业务仓执行隔离检出和 Evidence Gate。
5. OpenSpec Provider 同步主规格并归档 change；路径 Guardrail 拒绝范围外修改。
6. 受保护 Delivery 动作在Workspace 仓库创建普通收尾 commit、push 原分支、核对本地与 bare remote OID，并只更新原 Change MR 一次。
7. 测试核对 Run `completed`、一个 Evidence Bundle、归档存在、主规格已更新、工作树干净且临时目录已清理。

为排除偶然调度成功，同一强制终止场景额外连续执行 4 次并全部通过。完整 suite 还覆盖 Event Inbox Journal 中断、Lease 过期、重复/乱序事件、并发 Run 启动、Git/OpenSpec/MR 响应丢失、Evidence 失败与漂移 fence。

### 多 Runner 与启动补偿

- `PostMergeCoordinator.reconcile()` 按 change ID 稳定排序枚举当前 Delivery Store 中 `in_review` 和 `merged` 候选，通过已登记业务 MR 进入现有权威刷新；候选模型不包含 MR author 或 Change owner。
- 单项平台或执行失败转换为该 change 的稳定失败诊断，后续候选继续处理；打开、关闭未合入、全部合入、重复完成与失败路径由 Coordinator、Action 和发布测试共同覆盖。
- `post-merge reconcile` 使用短生命周期 project composition；真实 CLI 子进程在空候选 workspace 返回 `checked: 0` 后退出，证明没有遗留 HTTP Listener 或 Timer。
- `run start` 在创建新日常 Run 前调用同一命令入口，并把完成、等待、阻断和失败计数作为结构化 CLI diagnostic 返回，不把旧收尾结果静默隐藏。
- 两个独立 Git 工作区从同一 Change MR 分支基线生成相同关闭 tree：第一个 Runner 普通 push 成功；第二个 Runner读取远端提交并核对 parent、tree、message 与 author 后，通过原子 `update-ref` 收敛到胜出 OID，工作树保持干净且不产生第二次 MR 更新。
- 非等价远端提交仍由既有漂移测试证明 fail-closed；实现没有引入 force push、rebase、分支删除或最后写入者覆盖。
- 真实自举准备阶段发现报告状态措辞修正后旧 `awaiting_approval` 无法安全替换。新增状态机测试证明相同快照不增加事件，新快照记录被取代请求，旧响应失败；已经决定或开始发布的状态仍拒绝覆盖。

本 E2E 在实施期间实际发现并修复了五类集成问题：生产 webhook processor 只唤醒却不执行 Run、`merged` Delivery 无法在 Run 建立前崩溃后重新定位、`observedAt` 导致 Trigger 漂移、完整 Run ID 导致 Windows Git 深路径超限，以及两个 E2E bundle 位置一度污染并行仓库指纹。最终实现分别用完整执行入口、分层恢复匹配、权威 Trigger 投影、marker 保护的短物理目录和忽略目录内隔离 bundle 解决。

## 安全、隐私与清理

- webhook secret、GitHub Token 和 Git 作者身份只通过 Credential Provider 的环境引用提供；配置、Inbox 状态、测试输出和 OTel 属性不保存秘密值。
- 原始 webhook payload 保留在受权限控制的 Inbox Artifact，不进入普通日志、Span 或 Metric；高基数 ID 不进入 Metric。
- Post-merge 发布只允许配置声明的 `commit + push + merge_request.update`，并在执行前后核对原 MR 身份、分支、开放状态和 head。
- E2E 的临时仓库、bare remote、bundle、Runner 进程和检出目录均由 `afterEach` 清理。本轮验证没有产生新的 `repoctopus-self-hosted-*` 或多 Runner fixture 遗留；系统临时目录中保留了本轮开始前已存在的上游审计目录和一个较早的 Post-merge 测试目录，未把无法确认归属的旧目录当成本轮产物删除。Git 工作树只包含本报告与任务状态更新。

## 已知限制

- 文件 Event Inbox 的 Lease 只协调共享同一状态卷的 Runner；独立状态卷允许重复计算，并由 Change MR 分支远端 OID 栅栏收敛发布结果。这不是共享数据库调度、自动扩缩容或零重复计算意义上的生产级 HA。
- 当前只有 GitHub Adapter；CodeHub Adapter、远程 Skill 市场、Skill 管理 UI、多规格权威合并和生产级 HA 不在本 change 范围内。
- 独立进程 Post-merge E2E 使用 mock 平台 API 和本地 bare remote。真实业务 PR #8 尚未合入，Change PR #9 尚未登记到正式 Delivery，因此真实 GitHub 合入回调、主规格同步与 change 归档留待批准快照建立后复验。
- Runner 要实时接收 Webhook 仍必须位于平台可达环境；开发机无法接收公网 webhook 时，可以使用 Inbox replay/retry，或由短生命周期 `post-merge reconcile` 经公开 Coordinator 重新读取权威平台状态。
- 第一版一次性候选发现依赖当前 Workspace 的 `.repoctopus/deliveries/`；没有复制或共享持久状态的全新 clone 不能自动发现全部历史 change。受验证的远端索引或共享 Store 留给后续 change。
- 未发布的 Delivery state v1 不做静默迁移，返回 `migration_required`。组合、Provider 或状态 Schema 不兼容时同样只允许只读诊断。
- 多仓发布可恢复但不宣称跨仓原子事务；部分远端动作成功后保留事实，从失败点核对并继续或由人工处理。
- Repoctopus 不自动 merge Change MR，也不以 force push、rebase、删分支或创建替代 MR 修复漂移。

## 回退方式

在 PR 合入前，可在当前功能分支通过新的普通提交撤销；不得改写已经公开的分支历史。合入后如需回退，应从 `main` 创建普通 revert 分支和 MR。已经持久化的 Inbox、Run、Evidence、Delivery 与 Receipt 保持可读，不应删除或伪装成旧版本可写状态。

## 批准含义

批准本报告表示接受当前实现、验证结论、第三方固定来源和上述已知限制，并授权 Repoctopus Delivery 按已登记的业务 PR #8 与 Change PR #9 发布最终快照。批准不授权 merge、force push、rebase、删除分支、改变目标分支或扩大仓库集合。任何代码树、报告、策略、仓库选择、远端基线或动作计划变化都会使批准失效并要求重新验证。

Change PR #9 与业务 PR #8 写入正式 Delivery 并绑定批准快照后，业务 PR #8 才能进入人工合入。合入后，平台事件与 Post-merge Run 应再次执行精确合入代码验证、主规格同步、change 归档、收尾 commit/push 和原 Change MR 更新；该合入后证据将作为本报告的后续复验记录。
