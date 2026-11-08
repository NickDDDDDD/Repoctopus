# Windows Archive 路径与跨实现恢复验证

## 结果与根因

原失败多仓 Run 已通过修复包公开 CLI 完成真实规格关闭、两个业务 MR 和一个规格 MR，进入 completed。原 Verify Input、Gate/Bundle、Build Binding/Plan/Check/两包完成事实及 Archive input 保留，验证命令仍只执行原来的两次。

路径问题来自受管 checkout 与 publication 的 Git 命令没有在 Windows 启用命令级长路径能力。组合恢复问题来自把原规划来源身份用于比较当前执行实现，同时 Archive 依赖闭包没有完整涵盖实际 Delivery authority。修复分别收拢受管 Git 调用，并在既有 Guard 中复核当前执行组合；历史证据继续按原来源校验。

commit/push 规则保持：源提交 OID、插件实现摘要、规划/验证内容身份和发布坐标各有职责，不能靠推迟 push 避免身份漂移。

## 实际旧包到新包验收

- 原 Run：change-agent-lab-v010-workspace-verify-windows-longpath-20261108-ba8f171d976c917a。
- 旧包源提交：04d37b5494fa1cf3bc2837312096f0c2401fa5a4；修复候选源提交：d4b69ed8e831fc9f9c33a5eefaa6c9682c5c66db。原包与失败现场保留，新包独立安装，未覆盖旧工具。
- 同一冻结 close Work 与已接受 Outcome 被公开 resume/archive-publish 接续；没有新 Run 替代，没有手改 Store 或降级重验。
- 三个唯一 MR：[backend #8](https://github.com/NickDDDDDD/backend/pull/8)、[web-front #12](https://github.com/NickDDDDDD/web-front/pull/12)、[Workspace #6](https://github.com/NickDDDDDD/agent-lab-v010-workspace/pull/6)。均指向独立验收分支 acceptance/windows-longpath-20261108，未修改产品 main。
- 实际归档四份文件，最长完整候选路径 276 字符。Windows LongPathsEnabled=0，五仓 local/global/system core.longpaths 均未设置；修复没有改动这些持久配置。
- 四个新进程交替 resume/next 后 Run、checkpoint 和 trajectory 原始散列不变，保持 done/terminal，原 Receipt/OID/MR 不变。
- 13 个旧 Store 的 785 个文件和 45 份旧报告逐项散列核对未变。
- 原 Run/Work 的组合变化事件与采纳身份见 original-run-acceptance.json；未新增 Build/Design 回退或 Verify 调用。

包摘要与安装验证见 candidate-package.json；实际路径、终态散列、MR/OID、保留事实和旧现场完整性见 original-run-acceptance.json。操作命令原始输出、旧包、私有 packet/Host 身份和完整 ledger 留在独立实验 Evidence，未把令牌或机器绝对路径提交到产品文档。

## 自动化与检查

- TDD RED/GREEN 与基线逐项见 tdd-evidence.json。准备错误不计入产品 RED。
- 当前新增生产集成文件 4 项通过；六个相关文件共 95 项通过；类型检查和目标 lint 通过；独立安装候选包的 package e2e 1 项通过。
- 兼容矩阵覆盖 close/publish 两个 checkpoint 的代码、配置、schema、authority、错误/多个前驱拒绝及过期执行者无副作用。
- 自动化发布故障覆盖 MR 已应用但响应与可见性暂缺：真实 Journal 停于 mr-unknown，新 Cordis 实例沿原 invocation/operation 恢复，不重复创建 MR。没有人为干扰本次真实 GitHub 发布。
- 完整验证采用 check policy 的精确 argv `npm.cmd run verify`，VITEST_MAX_WORKERS=2；最终完整命令、结果与输入收据以 Comet Build/Verify 和 CI 记录为准。本文件不以局部测试冒充全量通过。
- 独立审查结论与夹具边界见 review.md；最终输入变化时补审受影响部分。

## 限制与清理

借鉴 Comet 的身份职责分离、受保护输入复核与原 checkpoint 恢复；Cordis 组合兼容与 Windows 受管 Git 适配由本项目实现，不宣称 Comet 已有相同代码。

命令级长路径不能解除 Git for Windows 对显式 GIT_DIR 参数的独立长度上限，也不承诺外部 hooks/工具支持任意深度；本次修复与负例针对已复现的 276 字符文件路径。未修改系统设置、移动 checkout 或扩大不相关插件的兼容前驱集合。

自动化临时仓与目录通过 afterEach 清理；真实受管归档 checkout 在发布完成后清理。原失败证据、候选包、MR 与验收文档是保留的测试产物，未作为临时文件删除。未启动调试服务。

## 完整命令结果

修正环境准备、来源目标摘要与组合预期快照后，完整 `npm.cmd run verify` 返回 0：201 个测试文件通过、1 个跳过，1109 项测试通过、5 项跳过、0 失败；Vitest 耗时 1132.64 秒。19 项规格验证、生成文件、命名、架构、provenance、Dashboard ledger 和 managed package content 检查全部通过。原始失败与成功复跑分别保留，详见 validation-history.json，不把首次失败改写为成功。

该普通完整检查不冒充 Comet 的输入绑定收据；后续实际执行正式 Build/Verify Guard。当前报告保存事实与包绑定，不宣称尚未执行的正式阶段已经完成。

本轮核对了本地 trajectory 的 Run/Work 与组合采纳事件；未连接公司 SigNoz 验证远端查询或看板，未把本地事件持久化等同于远端接收成功。

## 当前包输入绑定

Tested implementation commit: `f21c5026a4496ac1df6fda39ffc3704f0aedb152`

Package content SHA-256: `139141734461bc654b5785036b52221b99ea47840392780bd10e47239b2c6329`

Package files: `468`

Package content bytes: `5957187`

这四项绑定最终元数据候选包，见 final-candidate-package.json；不覆盖 d4b69ed 原候选的摘要。f21c502 重新打包、独立安装并从公开 CLI 冷恢复 completed 原 Run，组合与原 Receipt 不变，Verify 仍为两次。真实旧包 Run 的关闭与三个 MR 发布发生于 d4b69ed 修复候选；随后仅增加回归、Evidence、配套来源摘要与组合测试快照，产品 Runtime 实现未变。报告不把最终候选的终态恢复冒充再次完成全五阶段。合入 main 后另用新包、新五仓 Run 验证全流程。

附加诊断发现已安装 npm 包的 doctor 读取缺失的 package-lock.json 时失败，属于已有诊断资源分发问题，不阻断本次公开 Run 恢复与发布。未向安装包注入源码文件、未绕过 provenance；本次明确记录为未修复的非阻断观察，不宣称打包 doctor 通过。
