---
comet_change: verify-release-multirepo-workflow
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-18-verify-release-multirepo-workflow
status: final
---

# Design

## Context

Release Prepare 已将构建出的 CLI tarball 传给安装和 npx 验收。现有多仓实验已验证过工作包恢复和发布响应丢失，实验依赖预先准备的仓库和本机路径。见 [Proposal](proposal.md)。

当前 Windows candidate 作业预算为 35 分钟。它先构建和打包，随后执行包消费、npx 和桌面安装器验收，再调用 `scripts/github-release.mjs seal`。封存会检查干净的精确提交、CLI 摘要和桌面验收收据。候选目录有固定文件清单，诊断需要独立存放。

## Goals / Non-Goals

用指定的 `.tgz` 完成一条可重复的 Windows 多仓验收。单独执行和 Release Prepare 共用入口。验收范围聚焦消费后的 CLI、一个小 Change 和两个已知恢复边界。

测试 Host 按实际 Work 读取 Skill、执行固定的小任务并提交 Outcome。各阶段门禁使用隔离实验的测试答复。该场景验证 Runtime 与公共 CLI 的运行协议；人工评审的质量由开发流程中的独立审查覆盖。

## Decisions

### 独立入口和候选身份

增加 `npm run test:windows-multirepo-package-e2e -- <candidate.tgz>`，对应 `scripts/windows-multirepo-package-e2e.mjs`。显式路径为必填输入。入口先检查 Windows、Git、候选文件及 npm 调用环境，记录字节数和 SHA-256，再在临时消费目录安装生产依赖，使用安装后的 `bin/repoctopus.js`。

每次公共 CLI 调用都使用新 Node 进程，并记录 argv、退出码、阶段和 JSON 结果。控制器只持有测试场景配置和已持久化的标识。独立脚本放在标准 Vitest 收集范围之外，其契约和收据校验进入常规测试。

备选的源码集成测试适合快速回归，但安装后的依赖布局和入口需要从候选包消费才能覆盖。多仓入口接受维护者先前生成的包，使同一条验收可以单独复现。

### 三仓垂直切片

场景创建一个 Workspace、两个平级业务仓及对应的临时 bare 远端。仓库从空 Git 历史初始化。公共 Init 完成接入，公共 Verify 配置入口建立两个真实 Node 标记检查，测试通过正常配置设置本地发布端点。每个业务仓分配一个小型标记任务，共同构成一条 Change。

测试 Host 依次处理 Open、Design、Build Configure、Plan、Execute、Check、Verify 与 Archive。它领取 Work 后检查当前 Action Skill 正文和所需增强层，再执行指定任务和检查，并提交由当前 invocation 约束的 Outcome。两包各保留真实失败和转绿结果，Verify 执行实际命令。

多仓 Git 状态、OpenSpec Store registry、宿主 Skill 目录和测试配置都位于隔离目录。测试控制环境关闭外部遥测，使用仓库级 Git 身份，独立设置 Git 全局配置来源。短临时路径降低测试自身的路径噪声。

### 首包后的冷恢复

控制器分两次启动驱动进程。第一进程在首包完成且完成事实持久化后退出，保存原 Run、Plan、首包完成身份与业务文件摘要。第二进程从持久化标识恢复，先调用 `run resume`，再继续 `run next`。

核对原 Run 和计划身份、首包完成记录及执行计数，随后完成第二包。首包成功的实施计数应为一次。中断点设在已提交完成事实的边界，测试结果会明确记录这个位置。

### Archive 发布响应丢失

测试夹具提供 Git smart HTTP 与 GitHub 兼容 HTTPS 接口。Git 请求只到本机测试服务；API 基址通过现有配置注入。HTTPS 使用专用测试证书与子进程信任配置。

业务 PR 按正常 Archive 路径建立。创建规格 PR 时，夹具先验证远端分支、持久化 PR，再断开响应，并暂时在列表中隐藏该 PR。接口入口记录全部创建请求和 Git receive-pack 请求，包括失败或被拒绝的请求。

结果未知时，换进程执行 `resume`、`next` 和原发布入口，核对同一 Run 与原 invocation 仍处于 reconcile，写请求计数保持稳定。恢复查询可见性后，原调用采纳已存在的规格 PR，最终 Run 为 completed。PR 身份、远端分支 OID、完成记录和 Verify 证据需与恢复前事实一致。随后交替执行终态 `resume` 和 `next`，再次核对远端效果及状态。

验收编排和故障注入位于测试侧。Engine、Cordis Service、领域模块及平台适配器通过已安装 CLI 的正常装配执行。

### Prepare 接线与封存

Prepare 将 `REPOCTOPUS_PACKAGE_CANDIDATE` 对应的实际文件作为显式参数传入。新验收在 `seal` 前运行，输出路径由 `REPOCTOPUS_WORKFLOW_E2E_EVIDENCE` 指向候选资产目录之外。封存通过 `RELEASE_WORKFLOW_EVIDENCE` 读取收据，并核对成功状态、实际包摘要与大小、Run 终态、冷恢复及发布去重检查。

缺少收据、状态失败、关键检查缺失或候选文件改变时封存失败。新增契约测试检查实际参数、执行顺序、收据绑定和失败路径。诊断上传使用独立的 Actions artifact，执行条件为 `always()`，与通过后上传的正式候选资产分别绑定。

Windows candidate 作业预算调整为 55 分钟，独立验收预算先设为 15 分钟，单次 CLI 和 npm 安装均有超时。预算耗尽时保留最后阶段与原始输出。独立验收预算会在实际执行后复核。

备选的独立 Prepare 作业会新增候选传输和身份核对边界。现有 candidate 作业已经持有待封存文件，直接在其中复用独立入口能集中完成验收与摘要核对。

## Validation

先为候选输入、测试收据、故障注入时序与发布工作流契约写失败回归，再实现独立入口和 Prepare 接线。

Windows 实测使用本次代码构建出的安装包，以公共 Init 开始运行两个业务仓的一条 Change。验收收据包括候选摘要、各阶段、两次驱动进程、Run 和计划身份、首包完成记录、PR 与推送计数、原始命令日志和终态探针结果。

本次在 Windows 本地执行与 Prepare 相同的入口参数和证据环境，并覆盖封存收据的正反例。GitHub Prepare 的完整远端执行随合入后的下一份发布候选完成。正式 Verify 执行仓库检查和独立集成审查，核对源码调用、实际安装包证据和规格场景。

## Risks / Trade-offs

- 本地托管夹具覆盖受控 GitHub 协议场景，真实平台的权限和配额仍需发布环境核对。
- npm 安装依赖网络可用性。安装超时按环境失败记录，整个验收保持失败状态。
- 丢弃响应前若没有真实创建 PR，实验只覆盖请求失败。因此夹具以持久化创建记录和远端 Git 引用证明注入边界。
- 超时或驱动异常可能留下测试子进程。退出路径需要停止所拥有的服务进程、保存诊断，并对已核对的临时根进行清理。诊断输出保留在独立证据目录，避免清理时一起丢失。

## Rollout

维护者文档增加独立命令、前提、正常输出和失败证据位置。合入后，下一份候选按新 Prepare 门禁验收。若验收暴露产品缺陷，保留失败证据并定位处理，发布流程保持失败状态。
