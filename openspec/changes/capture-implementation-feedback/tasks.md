# Tasks

## 1. 配置与 Evidence 最小纵切

- [x] 1.1 定义并实现版本化 `repoctopus.yaml`、`.repoctopus/local.yaml` Schema、字段级覆盖权限和 canonical digest，运行配置单元测试验证等价键序与路径分隔符产生相同摘要、削弱门禁的覆盖被拒绝。
- [x] 1.2 实现 Evidence Profile 到不可变 DAG 的编译器，运行图测试验证拓扑排序、循环拒绝、独立分支继续和依赖节点阻断。
- [x] 1.3 定义 Attempt、Receipt、ArtifactRef、Finding、Bundle、Gate Outcome 的版本化类型与 JSON Schema，运行 schema round-trip 和未知主版本拒绝测试。
- [x] 1.4 实现本地内容寻址 Artifact Store 和 Bundle manifest，运行重复内容去重、摘要校验、原子写入及损坏对象拒绝测试。
- [x] 1.5 实现最小命令 Adapter 与 `passed|failed|incomplete|passed_with_warnings` 聚合，使一个配置命令可以生成完整 Bundle；运行纵切集成测试并核对 Artifact、Receipt 和 Outcome。

## 2. Comet 机制采用与输入可信度

- [x] 2.1 对固定 Comet 基线的进程、Evidence、Fence、Retention、Journal 和 Lock 候选文件执行依赖闭包分析，提交采用清单并运行来源摘要检查确认只引用固定 commit。
- [x] 2.2 移植并改造命令 spawn、进程 identity 和进程树终止机制，运行 Windows 与 Linux 行为测试验证结构化 argv、超时、取消、PID 复用和仅终止自有进程。
- [x] 2.3 实现多仓 Fingerprint Builder，运行测试验证 HEAD、tree、dirty 文件内容、配置、lockfile、工具、Adapter、Journey 和 Artifact 变化都会使摘要失效，绝对路径不进入共享摘要。
- [x] 2.4 实现开始/结束 Fence 与确定性 Receipt 复用，运行集成测试验证采集期间漂移产生 `superseded`、完全相同且未过期的命令结果可标记 `reused`、服务与浏览器不会默认复用。
- [x] 2.5 更新 `third_party/comet` 许可证、source manifest、adoption report 和行为特征测试，运行 `npm run check:provenance` 验证每个采用文件的上游与目标摘要。

## 3. Journal、恢复、保留与隐私

- [x] 3.1 把 Evidence 节点执行接入 intent/completion Journal 和原子投影，运行故障注入测试验证 Receipt 落盘后中断可以恢复且不会重复已确认副作用。
- [x] 3.2 实现带进程 identity 的资源 lease 和 mutation lock，运行并发测试验证冲突 Profile 不会重复占用端口、服务、浏览器上下文或临时目录，陈旧 lease 仅在 owner 失效后回收。
- [x] 3.3 实现引用闭包 Retention 与清理命令，运行测试验证活动 Attempt、批准快照、每个工作流 Run 最近成功 Bundle 和归档前失败 Evidence 不会被删除，孤立对象按期限或容量清理。
- [x] 3.4 在 Artifact 写入前实现允许列表、敏感模式脱敏和不可脱敏失败策略，运行凭据、Cookie、授权头、私钥、绝对路径和项目自定义模式测试确认原值不进入对象、状态或诊断。
- [x] 3.5 实现命令日志的字节/行/时长上限及前后摘要，运行超限测试核对截断 finding、默认 20 MiB 与前后各 200 行策略及可配置门禁影响。

## 4. Managed 与 Attached 服务反馈

- [x] 4.1 实现 Managed Service Adapter 的启动、日志采集、反向依赖停止和恢复，运行集成测试验证正常完成、提前退出、超时、中断恢复与 PID 复用都不会遗留或误杀进程。
- [x] 4.2 实现端口、HTTP 和日志正则的组合 readiness，运行测试验证端口开放但健康失败不会进入 Ready，并保留每次探测的有界诊断。
- [x] 4.3 实现 Attached Service Adapter 和 build identity 校验，运行测试验证无身份服务只产生 `observed`、匹配当前指纹时可按 Profile 升级、Runtime 永不停止外部进程。
- [x] 4.4 为服务 DAG 建立纵切 fixture，运行前后端并行启动、健康检查、依赖命令和清理测试，验证失败只阻断相关分支。

## 5. 浏览器与视觉反馈

- [x] 5.1 精确锁定 `playwright-core` 并实现显式 managed Chromium 安装/doctor 命令，运行测试验证普通安装不下载浏览器、缓存缺失返回明确命令、revision 不匹配不能产生 `verified` 证据。
- [x] 5.2 实现声明式 Journey Compiler 和 Browser Adapter，运行测试覆盖导航、等待、文本/可见性/URL 断言、桌面与移动 viewport、截图、console/page error 和失败请求。
- [x] 5.3 实现系统 Chrome/Edge 与固定 Chromium 的来源识别，运行测试验证系统浏览器结果默认是 `observed`，固定且匹配的 managed Chromium 才能满足正式门禁。
- [x] 5.4 定义并实现版本化 `VisualInspectionRequest/Response` 端口，运行 contract 测试验证 request、截图摘要、viewport、验收标准和 response finding 关联完整，缺少 Adapter 时必需节点为 `incomplete`。
- [x] 5.5 把权威资料冲突接入 Human Decision，运行场景测试验证页面符合设计图但违反 Spec 时产生 `requirements-conflict`、暂停受影响节点且不自动选择依据。

## 6. 项目探测与用户确认

- [x] 6.1 实现受作用域限制的 `project detect`，运行 fixture 测试验证 Git、Node、Maven/Gradle、常见端口和健康端点只写入带来源与不确定项的 `.repoctopus/drafts/`。
- [x] 6.2 实现已有共享配置的 reconcile diff，运行测试验证探测不会覆盖正式配置或人工字段，并能稳定报告新增、删除、冲突和待确认项。
- [x] 6.3 把 draft 与 Agent 补全结果接入 Human Decision，运行协议测试验证缺少可信用户确认时不能创建或更新 `repoctopus.yaml`，批准内容与最终写入摘要一致。
- [x] 6.4 更新项目配置与接入文档，按文档在临时多仓 fixture 完成 detect → 补全 → 确认 → 首次 Evidence Run，核对命令和结果可复现。

## 7. CLI、Runtime 与 OpenTelemetry 集成

- [x] 7.1 增加 Evidence CLI 的 `plan`、`run`、`status`、`resume`、`inspect`、`clean` 和浏览器管理 envelope，运行 CLI contract 测试核对 JSON 版本、稳定错误码、退出码和人工决定输出。
- [x] 7.2 在唯一 Runtime composition root 接入配置、DAG、Evidence Store、Adapter、Journal、lease 和 Engine Gate 投影，运行端到端测试验证只有当前 `verified` 必需证据可以推进 Verify，CLI 不得通过普通成功记录绕过 Gate。
- [x] 7.3 实现零测试结构化识别，运行 npm/Maven fixture 验证退出码为零且执行数为零时产生 `no-tests-detected`，并按共享 Profile 得到 warning 或 blocking 结果。
- [x] 7.4 扩展 OTel mapping 和 Delivery Cursor 重放，运行内存 OTLP 测试验证 Run/Attempt/节点/Artifact/Gate 的稳定关联、重试身份与后端故障不回滚本地事实。
- [x] 7.5 运行遥测隐私测试确认命令输出、服务/浏览器日志、健康正文、DOM、截图、视觉请求/响应、绝对路径和敏感值不出现在 Trace、Log 或 Metric 属性。
- [x] 7.6 更新 Runtime、Evidence、Telemetry 和人工决定文档，运行文档中的完整 CLI 示例并核对架构图与实际模块边界一致。

## 8. 产品级验证与分发

- [x] 8.1 建立合成多仓 E2E，运行测试覆盖并行 DAG、四种 Bundle 结果、漂移失效、Receipt 复用、崩溃恢复、lease 冲突、清理和业务失败不静默重试。
- [x] 8.2 建立服务与浏览器 E2E，运行 Managed/Attached、双浏览器信任等级、桌面/移动 Journey、视觉响应和 requirements-conflict 场景，核对全部临时进程、端口和浏览器上下文被安全释放。
- [x] 8.3 更新 npm 分发清单、默认 Schema 和 ignore 模板，运行 package E2E 验证从打包产物安装后可以完成配置、命令 Evidence 和 inspect，不包含 fixture、绝对路径或具体宿主项目信息。
- [x] 8.4 运行 `npm run verify`，确认 typecheck、lint、构建、全部测试、生成物、品牌、来源与 OpenSpec 严格校验通过，并清理测试产生的临时日志、服务、浏览器上下文和孤立 Artifact。

## 9. 真实多仓接入验收

- [x] 9.1 在独立 `agent-lab-workspace` 规划并提交 companion change，维护其自己的 `repoctopus.yaml`，运行 detect/reconcile 验证配置来自用户确认且 Repoctopus 产品仓不出现示例项目专有字段。
- [x] 9.2 运行真实项目 Evidence Profile，验证四个前端包构建、Maven `verify`、零测试 finding、Vite、两个 Spring 服务、两个健康端点、桌面/移动 Journey 和结构化视觉响应进入同一 Bundle。
- [x] 9.3 修改一个被指纹覆盖的输入并重跑，验证旧命令 Receipt 失效、服务与浏览器重新采集、开始/结束漂移不会被描述为通过。
- [x] 9.4 中断并恢复一次 Managed 运行后执行清理，验证只终止 Runtime 自有进程、保留可审计失败 Evidence、四个业务仓没有非预期修改。
- [x] 9.5 生成 Repoctopus 产品 E2E 与真实接入验收报告，核对报告明确区分机器证据、观察结果、fixture 前端与后端尚未形成业务调用的限制，并通过用户评审后进入交付。

## 10. 架构复审与来源收敛

- [x] 10.1 逐项复审 `app`、`domains` 和 `platform` 的生产实现，对照固定 Comet 基线与旧 `agents-workspace`，记录源码采用、算法抽取、行为重建、Repoctopus 新能力及仍需收敛的并行模型。
- [x] 10.2 采用 Comet 的文件 identity、竞态安全读取、Windows 短暂失败重试与原子写入原语，强化 Resource Lease 和 Artifact Store 的文件替换防护，并更新来源清单与行为测试。
- [x] 10.3 抽取 Comet Snapshot 的选择前后 Fence 与内容复核规则，强化多仓 Fingerprint，验证采集期间同一路径内容变化会被拒绝。
- [x] 10.4 增加机器可检查的能力归属账本和旧工作流隔离检查，覆盖全部生产源码、第三方来源映射、旧 Hook/Skill/阶段/批准口令和项目专有路径，并接入 `npm run verify`。
- [x] 10.5 把 Evidence Gate 接入唯一 Runtime 转换，将已批准 Delivery Snapshot 绑定的 Bundle 纳入 Retention root set，并通过绕过、漂移、恢复和清理 E2E。
- [x] 10.6 评估 Delivery Transition Store 与核心 Runtime Journal 的公共事务原语，消除可以安全共享的重复写入协议，同时保留 Delivery 聚合状态和 Evidence 追加事实的领域差异。
- [x] 10.7 重新运行完整验证、真实多仓验收和架构检查，更新正式报告后再次交给用户评审。

## Workflow follow-up

- Repoctopus 产品变更和 `agent-lab-workspace` companion change 分别接受评审与合入。
- 两个评审单元全部合入并完成合入后复验后，按项目交付流程归档本 OpenSpec change。
