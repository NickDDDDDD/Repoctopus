---
comet_change: release-v0-1-1
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 proposal.md 的发布目标和 specs/product-distribution/spec.md 的版本一致性要求。现有 Release workflow 已有 main 精确提交 CI、Windows 候选构建、草稿、同资产 Publish 与公开下载/npx 验收，继续作为发布权威。本次不重做这些机制。

当前根包与 lockfile、CLI_VERSION、观测 Resource 和桌面 OTLP Scope 含独立的 0.1.0 文本。桌面插件和内置插件另有自己的描述符版本，不能仅凭字符串相同就视为产品版本。

## Goals / Non-Goals

**Goals:**

- 以根包元数据表达唯一产品发布版本，生成的 CLI 与 Desktop 观测均带正确产品身份。
- 新版用户安装示例、独立消费验收、Windows 安装器定位与 v0.1.1 一致。
- 沿既有发布流程保存精确提交、CI、候选工件、草稿与公开下载回执，失败可核对恢复。

**Non-Goals:**

- 不更改五阶段、审批、Run 身份、执行或恢复语义；不引入新迁移和兼容路径。
- 不把插件描述符版本、协议/schema 版本或第三方版本绑定到产品包版本。
- 不把 Release 流水线的外部运行结果变成新的运行时状态机；不追加自动发布后台。

## Decisions

### 单一产品版本来源

使用一个小型平台侧产品版本模块静态导入根 package.json 元数据，由已有 esbuild 构建内联到产品产物。CLI、Resource 配置及桌面 OTLP 编码引用该值；不读取消费者当前目录的 package.json，也不依赖 Electron 跨进程内存。新增源文件按既有架构所有权登记。根 lockfile 仅更新自己的包版本，不更新依赖解析。

备选方案是发布时同步多份常量；它不能防止下次发版遗漏。另一个方案是在运行时从当前目录或路径猜测包版本，会混入业务项目身份和额外 I/O，不采用。

内置插件及桌面 composition 的独立插件版本保留原语义。此处的产品遥测版本是诊断数据，不作为新的执行或审批权威。

### 验收落在用户能观察的边界

先在包版本更新后得到 CLI/遥测版本的真实失败，再接入共享版本来源转绿。安装包 E2E 比较安装后的公开 --version 与包元数据；npx smoke 增加版本核对；相关遥测回归核对最终 Resource 与三个 OTLP 信号的 Scope。避免仅测试常量等于另一个常量。

README 与安装指南的当前安装示例升级到 v0.1.1，关于旧版 v0.1.0 缺少初始化引导的历史说明保留。Windows 测量脚本沿用既有 releaseAssetNames 和包版本派生文件名，不继续定位旧安装器。

### 先交付版本维护，再执行既有 Release

Change 内任务完成版本维护、独立消费验证与可执行的发布输入/恢复计划。Comet 按既有阶段完成 Verify、Archive 与 PR 交付；main CI 成功后，当前 Agent 按用户已授予的 v0.1.1 发布授权执行现有维护者流程：

1. 固定 main 的完整提交及成功的 push CI，核对 v0.1.1 Tag/Release 无冲突。
2. 启动现有 workflow 的 prepare；候选运行 CLI 包 E2E、npx、Windows 打包/安装/卸载验收，并保留工件 ID 与摘要。
3. 核对成功 Prepare 的候选、草稿与三份公开资产计划，再用同一提交、Tag、工件 ID 启动 publish。
4. 核对 public-smoke、实际公开下载字节与 npx，保存外部发布回执；不回写已封存的归档目录。

备选方案是在版本 Change 合入前执行 Prepare；它违反既有 main 精确 CI 前置条件。另一方案是把 Publish 作为 Build 任务完成条件，会产生合入依赖循环，均不采用。任务完成与公开 Release 完成分开如实报告。

## Risks / Trade-offs

- [元数据导入遗漏某个打包入口] → 核对 CLI、Desktop Main/Host 的构建产物及实际包版本；保持发布包根元数据和固定导入路径。
- [观察版本修改影响组合快照] → 只更新因真实代码变化受影响的期望值；保留组件版本语义，不以放宽断言恢复测试。
- [Windows 或网络验收失败] → 按同一流水线及工件恢复，结果未知先查 Run/草稿/资产，不重建或覆盖已绑定候选，不绕过安装器门禁。
- [已有 Desktop 偶发激活问题] → 首轮失败与未定位限制保留在原验证报告；本次如再现先保留真实证据定位，不把发版当作修复结论。
- [权威资料冲突或候选身份改变] → 停止受影响步骤，核对源提交、Tag、工件和已有资产；规格级范围变化返回用户确认，不选择性忽略。

## Migration Plan

使用新版本与新 Tag 分发，不修改 v0.1.0。发布失败时保留既有公开版本可用；同一候选可验证恢复时复用原结果，不能恢复或已有公开资产需要更正时采用新的版本号。团队升级按现有安装与项目接入指南执行，无数据迁移。
