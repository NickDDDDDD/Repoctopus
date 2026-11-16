---
comet_change: repair-archive-publication-endpoint
role: technical-design
canonical_spec: openspec
---

# Design

## Context

普通五仓验收的业务 PR 已创建两条，规格 Journal 已记录推送 OID。Run 卡在 `delivery.publish`，`PublicationReceipt` 尚未生成。另一条五仓返工 Run 已保留后端完成记录并重新通过 Verify，停在同一发布边界。验收使用真实 Git 仓、安装包 CLI 及隔离的本地 HTTPS 发布接口。

## Goals / Non-Goals

- 让 Archive 的业务项和规格项使用同一份已核验的 `DeliveryPolicy`，保留原有副作用权限。
- 让两个现有实验 Run 换包后完成 Publish 并证明终态恢复的幂等性。
- 本次范围限于 Archive 发布路径。发布后的一致性查询与正式 Release 渠道分别评估。

## Decisions

参考固定上游 Comet Classic `35c9860b77b42bafa0c2d80d8d695889f888a924`。其 `classic-sdk-archive-decision.ts` 在提案绑定 remote 和 PR base，`classic-sdk-delivery.ts` 依据已批准目标构造并核对交付结果，`classic-sdk-delivery-checkpoint.ts` 保留原 Run 的归档及验证历史。Repoctopus 采用同一责任边界，由 Runtime 传递已经校验的发布授权，由 Delivery 适配器执行与观察。Comet Classic 的该路径负责验证实际 Git/PR 交付，Repoctopus 仍使用自己的多仓副作用及 Journal。

Archive Runtime 已比较当前 `DeliveryPolicy` 的摘要与冻结输入。规格发布端口接收这份策略，其 GitHub 客户端复用业务发布的 API 与凭据选择。MR URL 继续用于确定仓库和编号。发布集合、Closure、Work 和 Journal 的数据结构沿用现有实现。

CLI 允许以 `--policy` 替换 Workspace 的发布策略。该选项与 Workspace 默认策略使用同一套摘要核验和客户端构造。显式策略的 API 地址及凭据引用均来自这份策略，省略凭据引用时使用 GitHub 适配器的 `GITHUB_TOKEN` 默认值。

受影响的受保护实现采用当前既有组合采纳机制，逐项核对直接前驱的代码、描述符和状态契约。验收保持两个原 Run 与原配置，先核对已创建的两个业务 PR 和规格分支 OID，再继续执行。

### 策略传递与客户端构造

`WorkflowRuns.executeArchiveDelivery` 在已存在的 `deliveryPolicyDigest(input.policy)` 校验后，从同一 `input.policy` 调用 `publishArchive` 和 `publishSpecification`。在 `Delivery.publishSpecification` 的内部签名中增加必填策略参数，信号参数继续位于最后。`FileDeliveryProvider` 从该策略的 `publication.githubApiBaseUrl` 构造 GitHub 客户端，并与业务发布共用客户端构造逻辑。凭据仍由当前已装配的 `EnvironmentCredentialProvider` 根据 Workspace 配置引用解析。MR URL 提供仓库路径和编号，API 主机取自已核验策略。

保留 Runtime 已有的摘要校验位置，覆盖初次尝试和查询恢复。Runtime 显式传递策略，让调用处能按类型强制提供已核验的输入，并把实际请求关联到冻结的 Archive 策略摘要。

本次核对客户端用来构造 MR API 请求的基址、路径和凭据来源。平台响应的 HTTP 重定向由现有 GitHub Adapter 传输实现处理。实验进程的地址白名单仅用于检测对默认 GitHub API 的回退。

### 直接前驱与两个原 Run

基线包对应 `1fdd4a63e76ffc7a15d890690b2a825c6883dafc`。两条实验 Run 保存的 `workflow-runs` 和 `delivery-file` 前驱完全一致。若实现更改后两者代码身份变化，在现有 catalog 和精确前驱回归中登记实际观察到的 codeDigest、descriptorDigest。校验配置、权限和状态 schema 同时满足既有采纳规则。

用两条原 Run 的原配置启动新进程，先验证升级前后的策略摘要、Run ID、Bundle、Closure 和已完成包事实相同。普通轮的规格 Journal 已进入 `pushed`，应采用已验证的 archive source OID，复用业务 PR #1 和 #2，完成缺少的规格 MR。返工轮保存了受管发布 Outcome，应接受该 Outcome 并完成三项发布。然后对每条 Run 交替执行 `resume`、`next`，核对始终返回 completed、收据和 Git/API 副作用计数稳定。

### 验证入口

优先扩展现有的 Archive 组合回归，在 GitHub Adapter 的请求边界记录 URL，覆盖自定义 API 的查询、创建与恢复。另以不同 API 的策略作为输入，核对摘要守卫拒绝该调用，同时检查 API 创建计数和 Git refs。

公开 CLI 验收复用已有五仓工程、本机 Git 远端及测试 HTTPS 发布接口。保留两个原 Run 冻结的地址，重启监听原端口的测试服务。测试进程只允许访问实验 API，并记录其请求地址、MR 创建和 Git 写入次数。最终收据记录包摘要、CLI 响应、Plan、Bundle、Closure、MR 编号、已发布的 Git OID 和两轮实际执行次数。

## Risks / Trade-offs

- 部分完成后重试可能重复提交、推送或创建 MR。验收以实际 Git refs、HTTPS 请求计数、原 Journal 和终态 Receipt 交叉核对。
- 安装包升级可能改变受保护组合。只接受经实际包核对的直接前驱，保留当前策略漂移与状态兼容性守卫。
- 验收使用本地测试凭据。回归应证明配置了自定义 API 时，规格发布所有 API 请求均留在授权目标。
