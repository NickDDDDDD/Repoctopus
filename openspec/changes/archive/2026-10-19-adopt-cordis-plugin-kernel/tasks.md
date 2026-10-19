# Tasks

## 1. 固定基线并引入第三方内核

- [x] 1.1 记录当前 CLI、Run、Evidence、Delivery 与发行包的行为基线，并执行 `npm run verify` 保存可比较结果，确认重构前主分支全部检查通过。
- [x] 1.2 从固定 DeepSeek Harness commit 复制 `@deepseek-ai/cordis` 4.0.4 与 `@deepseek-ai/cordis-plugin-loader` 1.0.5 各一份完整上游源码、包元数据和 MIT 许可证，写入机器可读来源清单；执行 `npm run check:provenance` 验证目录摘要与上游身份。
- [x] 1.3 配置内部 workspace 与精确锁定的 Cordis 间接依赖，使 Core 和 Loader 源码可以在 Windows 与 Linux 构建；执行 `npm install`、`npm run typecheck` 和创建、卸载 Cordis Fiber 的冒烟测试。
- [x] 1.4 扩展来源检查，拒绝 `third_party/cordis` 与 `third_party/cordis-plugin-loader` 的未登记修改，并以篡改单个 fixture 文件的测试证明检查会失败、恢复后会通过。

## 2. 建立 Cordis App Boot 与 composition

- [x] 2.1 定义只用于导入前准入、供应链与状态兼容的静态 Plugin Descriptor；以单元测试验证稳定规范化、重复标识、无效版本和摘要漂移诊断。
- [x] 2.2 实现薄 composition compiler，把领域配置确定性翻译为 Loader Entry，只检查静态准入、权威能力唯一性和 composition digest；以配置乱序测试证明摘要稳定，以未知插件 fixture 证明模块求值前拒绝。
- [x] 2.3 实现 App Boot，创建 Cordis Context、装载 Loader、选择 bootstrap/project composition、检查 surface 所需 Service 并有界关闭；以 bootstrap、project、缺失 Service 和重复关闭测试验证。
- [x] 2.4 删除实验性的产品 Runtime、Runtime Provider、通用依赖图和直接 `ctx.runtime` 写入路径；执行 `rg` 架构检查与 App Boot 测试证明 Cordis 是唯一应用 Runtime。
- [x] 2.5 建立 Effect 生命周期与活动操作排空测试，重复执行加载、卸载、再加载，验证注册、监听器、Timer、Watcher 和测试资源恢复到基线。

## 3. 交付 Project、Run 与 Manual Action 可运行纵切

- [x] 3.1 定义直接继承 Cordis `Service` 的 Project、RunStore、WorkflowRuns、ActionDispatcher 和 CommandRouter 契约及 Context 类型扩展；执行类型检查证明消费者只依赖 Service 契约。
- [x] 3.2 将多仓 Project Probe 和文件 RunStore 注册为 Provider 插件，复用经过重审的领域与平台函数；运行 project-probe、runtime-store、workflow-contract 和恢复回归测试。
- [x] 3.3 保持 Engine 为纯函数，并把锁、Transition Journal、原子提交、Trajectory、Checkpoint、幂等与恢复闭包收进 RunStore transaction；运行并发写、崩溃注入和重复请求测试。
- [x] 3.4 实现 WorkflowRuns Service 与 Manual Action Contributor，使用 `action.proposed → Intent → Receipt → Outcome` 两笔 Run 事务；运行测试证明外部等待不占用 Run 锁且中断可以恢复。
- [x] 3.5 把 `project probe` 与 `run start/status/next/record/resume` 作为命令 Contributor 接入 CommandRouter，再由 CLI Application Plugin 调用；运行对应 CLI E2E 并确认不存在直接服务构造路径。
- [x] 3.6 打包当前纵切并在隔离目录安装，执行项目探测、Run 启动、下一动作、Manual Receipt 和恢复命令，证明不依赖源码仓路径。

## 4. 接入 Command Evidence、Gate、Checkpoint 与 OTel

- [x] 4.1 定义 EvidenceCoordinator Service 与 Contributor 注册表，保留 Attempt、Node Journal、Receipt、Artifact、Bundle 与 Gate 的独立持久化生命周期；运行 Evidence 生命周期和恢复测试。
- [x] 4.2 将 Command Evidence 注册为 Contributor，记录实现身份与 composition digest，并以通过、失败、零测试、输入漂移和实现升级不复用 Receipt 的测试验证。
- [x] 4.3 让 WorkflowRuns 只在 RunStore transaction 内重新核对 Gate 并接受 Bundle，删除 Evidence 直接写 Run 的路径；运行并发推进、陈旧状态版本和无 Gate 拒绝测试。
- [x] 4.4 将 Evidence 命令接入 CommandRouter，并实现 OTel Provider，在本地事实提交后输出 composition、Provider 与 Contributor 的允许列表身份；运行 Evidence CLI E2E 与测试 Exporter E2E。
- [x] 4.5 提交 Repoctopus 自身的 `repoctopus.yaml` 与验证 composition，用新路径执行本 change 的 Run、Command Evidence 与 Gate 接受，强制终止一次进程后执行恢复，保存可核对的自举验收记录。

## 5. 完成共享配置与团队插件接纳

- [x] 5.1 扩展 `repoctopus.yaml` Schema 以声明领域 composition，保留仓库、Evidence 和 Delivery 字段；运行 Schema fixture 验证原始 Cordis 配置和未知 Loader 表达式被拒绝。
- [x] 5.2 实现团队插件静态 Descriptor 解析和 import 前准入，验证包身份、契约版本、配置 Schema、来源、代码摘要与状态兼容范围；以带模块求值副作用的未登记 fixture 证明拒绝发生在 import 前。
- [x] 5.3 限制 `.repoctopus/local.yaml` 不能新增插件、替换共享 Provider、降低约束或扩大权限类别，并运行本机覆盖测试验证路径、端口与资源字段仍可合法覆盖。
- [x] 5.4 将共享配置、composition 与本机覆盖摘要分别绑定到 Evidence 指纹和 Run；运行配置漂移、列表乱序和本机端口变化测试。
- [x] 5.5 更新项目接入文档与示例，说明 bootstrap/project composition、团队插件可信边界和不直接维护 `cordis.yml`；按文档从空目录完成一次探测到确认配置的 E2E。

## 6. 迁移剩余产品能力到同一插件树

- [x] 6.1 将 Managed/Attached Service、Browser Journey 与 Visual Inspection 注册为 Evidence Contributor，并通过 Effect 管理进程、浏览器和文件交换资源；运行 service-browser E2E 与卸载资源残留测试。
- [x] 6.2 将 Delivery、Git 与代码托管平台实现注册为 Service Provider 或 Contributor，把 Delivery 命令接入 CommandRouter；运行 Delivery CLI、失败恢复、批准漂移和禁止自动 merge 测试。
- [x] 6.3 将项目接入、Human Decision、浏览器安装/诊断和 Provenance 命令迁入对应插件，运行现有项目接入、Human Decision、Managed Browser 与来源 E2E。
- [x] 6.4 删除公共生产入口中全部产品服务直接构造函数，以及 `RepoctopusRuntime`、`EvidenceRuntime` 和其他旧组合根；执行架构扫描证明公共入口只能经 App Boot 解析 Service。
- [x] 6.5 更新 Evidence、Delivery、项目接入、运行状态和 Telemetry 文档的 Service 边界、诊断与恢复说明，并运行文档命令冒烟检查。

## 7. 完成组合兼容、重载与操作排空

- [x] 7.1 把 composition digest 与影响语义的实现身份写入 Run、Checkpoint、Evidence、Action Receipt、Delivery Snapshot 和 Trajectory；运行序列化与损坏输入测试。
- [x] 7.2 实现写前组合比较：相同组合继续、显式兼容变化记录 `composition.changed`、不兼容变化进入 `migration_required`；验证漂移状态仍可只读且不能写入。
- [x] 7.3 使用 Cordis Loader 重载普通 Telemetry 或 Evidence Contributor，验证旧 Fiber 完整释放后新 Fiber 激活，配置无效时给出诊断且不产生第二套生命周期。
- [x] 7.4 验证卸载时停止接纳新操作、AbortSignal 取消安全操作、Journal 边界后的操作完成或留下可恢复事实，并以关闭超时测试证明有界 disposer 行为。
- [x] 7.5 执行真实自举中的普通插件重载与进程中断恢复，在运行状态文档记录组合兼容、失败模式和人工修复入口。

## 8. 收紧发行与架构治理

- [x] 8.1 更新构建和发行文件清单，嵌入 Cordis、Loader、Plugin Descriptor 和内置 composition；运行 `npm pack` 后在隔离目录执行最小 CLI 闭环。
- [x] 8.2 扩展架构治理，明确 `domains`、`services`、`plugins`、`platform` 与 `app` 边界，拒绝新的直接组合根、产品 Runtime、未登记生产文件和第三方源码漂移；以正反 fixture 验证。
- [x] 8.3 更新 README 与架构文档，明确 Cordis 唯一应用 Runtime、纯 Engine、持久化 Run、产品 Service、Provider/Contributor 和可信边界；执行品牌检查确认公共产品面不暴露 DSH 命令或具体宿主项目信息。
- [x] 8.4 运行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，再执行 Repoctopus 自举 change 的中断恢复、普通插件重载与组合漂移，生成包含 composition digest 和已知限制的验证报告。

## Workflow follow-up

- 用户批准最终验证报告后，按 Repoctopus 交付流程提交、推送并创建或更新本 change 的 MR。
- MR 合入且主分支复验通过后，再同步主规格并归档本 change。
