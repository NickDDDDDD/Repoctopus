# Tasks

## 1. 来源治理与最小构建

- [x] 1.1 建立 Node.js、TypeScript、Vitest、ESLint 和 esbuild 的最小维护环境，使用 npm 锁定依赖；运行 `npm install`、`npm run build` 和一个 smoke test，确认构建产物能由受支持的纯 Node.js 环境执行。
- [x] 1.2 在 `third_party/comet/` 保存 MIT 许可证、固定 commit、机器可检查的来源清单和采用报告；运行 `npm run check:provenance`，确认每个复制文件都有原路径、目标路径、摘要和采用方式。
- [x] 1.3 为 Comet Engine 与 Workflow Contract 候选模块生成依赖闭包，先运行适用的上游测试，再完成最小编译 spike；若闭包跨入无需求模块，按 Stop Conditions 暂停对应采用并记录到 `implementation-notes.md`。

## 2. Engine、工作流契约与 Runtime

- [x] 2.1 采用满足需求的 Engine 完整边界和测试，将产品命名集中映射为 Repoctopus；运行 Resolver、Guardrail、Eval 和 Run 转换测试，确认 Engine 不访问文件、Git 或网络。
- [x] 2.2 实现版本化 Workflow Package Schema、规范化、摘要和 Run 内不可变快照；运行无效步骤、未知动作、不可达步骤、无出口循环和运行中定义漂移测试。
- [x] 2.3 建立 Runtime composition root 和端口，实现 `start`、`status`、`next` 与测试用 `record` 的最小闭环；运行同一输入重复解析、不同 Run 隔离和未知事件拒绝测试。

## 3. 多仓探测与运行快照

- [x] 3.1 实现只读 Git Adapter 和直接子目录探测，输出稳定排序的仓库身份、路径、远端、分支、HEAD 和工作树摘要；运行 clean、dirty、detached HEAD、无远端、非 Git 目录和路径含空格测试。
- [x] 3.2 启动 Run 时保存不可变 Project Snapshot 及摘要，并把仓库身份关联到 Run 和 Trajectory；运行两个独立仓库、重复远端身份和仓库路径逃逸测试。
- [x] 3.3 证明探测过程不写业务仓：E2E 前后比较 Git 状态与文件树，预期除 Repoctopus 本地状态目录外没有业务仓变化。

## 4. Trajectory、Checkpoint 与恢复

- [x] 4.1 实现版本化追加式 Trajectory Event、Run State、Checkpoint Manifest 和转换 Journal；运行正常提交、重复事件、陈旧 stateVersion、尾部损坏和跨 Run 引用拒绝测试。
- [x] 4.2 实现临时写入、刷盘、原子替换和中断恢复；在写 Trajectory 后、写 Run State 后和写 Checkpoint 后分别注入崩溃，重启后预期得到同一最终状态或明确可修复诊断。
- [x] 4.3 实现 resume probe、Git 事实刷新和 reconciliation；运行 HEAD 变化、dirty 摘要变化、仓库移动、工作流定义变化和无变化恢复测试。
- [x] 4.4 实现 `doctor` 对状态、Trajectory、Checkpoint、来源清单和遥测队列的只读诊断；确认 doctor 不静默修复或删除损坏证据。

## 5. OpenTelemetry 输出

- [x] 5.1 定义版本化领域事件和 OTel 映射，覆盖 Run 根 Trace、步骤 Span、状态与恢复 Event/Log 以及基础 Metric；使用 in-memory exporter 验证标识关联、时间、结果和低基数属性。
- [x] 5.2 实现允许列表、敏感字段过滤和制品引用，覆盖 Token、Cookie、授权头、环境变量值、超长正文和截图引用测试；确认原始内容不进入普通属性。
- [x] 5.3 实现非阻塞发送、有限内存缓冲、持久化 Delivery Cursor 和健康诊断；模拟 OTLP 端点不可用及 Runtime 重启，确认工作流继续推进、本地 Trajectory 完整，并从最后成功位置补发且保留事件身份。
- [x] 5.4 提供不含凭据的开发 Collector 配置和 OTLP/HTTP 集成测试；运行本地 mock receiver 或测试 Collector，确认 Trace、Log 和 Metric 都能被接收。生产 SigNoz Dashboard 和 Ubuntu 运维留在后续 change。

## 6. 公共 CLI 与纵向 E2E

- [x] 6.1 实现 `repoctopus project probe`、`run start`、`run status`、`run next`、`run record`、`run resume` 和 `doctor`，统一退出码、文本渲染和版本化 JSON envelope；运行 CLI 契约快照测试。
- [x] 6.2 构建只依赖 Node.js 的可分发 CLI，在临时目录只安装生产依赖或使用打包产物执行，不加载 TypeScript 源码；运行 `npm run test:package-e2e`。
- [x] 6.3 运行多仓 tracer E2E：创建两个临时 Git 仓、探测、启动、记录、结束进程、恢复并检查 OTLP 接收数据；预期 Run、Trajectory、Checkpoint、仓库摘要和遥测标识一致。
- [x] 6.4 运行公共品牌检查，确认 CLI、状态路径、错误信息和生成文件不暴露 `comet` 产品名；许可证和 `third_party` 来源记录不受该检查限制。

## 7. 文档与最终验证

- [x] 7.1 编写 Runtime 架构、状态模型、恢复语义、遥测字段和本地开发说明；从干净检出按文档执行一次 tracer E2E。
- [x] 7.2 更新 `implementation-notes.md`，记录每个采用模块、偏差、未采用原因、验证证据和是否影响规格；确认所有外部行为偏差都已获得用户决定。
- [x] 7.3 运行 `npm test`、`npm run lint`、`npm run build`、`npm run check:generated`、`npm run check:provenance`、`npm run test:package-e2e`、`npm run test:tracer-e2e`、`npm run spec:validate` 和 `git diff --check`。
- [x] 7.4 生成正式验证报告，列出需求映射、测试结果、未执行项、上游采用范围、许可证、遥测脱敏结果、已知限制和回退方式；只有用户批准报告后才允许 commit、push 或创建 MR。

## Workflow Follow-up

- 本 change 的实现只在本地工作树进行，正式验证报告批准前不提交、不推送、不创建 MR。
- 报告批准后，交付动作仍按用户对具体动作的授权执行。
- MR 合入后再建立后续垂直切片，不在本 change 追加已明确排除的能力。
