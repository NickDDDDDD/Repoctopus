# Design

## Context

普通五仓验收的业务 PR 已创建两条，规格 Journal 已记录推送 OID。Run 卡在 `delivery.publish`，闭合收据尚未生成。另一条五仓返工 Run 已保留后端完成记录并重新通过 Verify，停在同一发布边界。验收使用真实 Git 仓、安装包 CLI 及隔离的本地 HTTPS 发布接口。

## Goals / Non-Goals

- 让 Archive 的业务项和规格项使用同一份已核验的 `DeliveryPolicy`，保留原有副作用权限。
- 让两个现有实验 Run 换包后完成 Publish 并证明终态恢复的幂等性。
- 本次范围限于 Archive 发布路径。发布后的一致性查询与正式 Release 渠道分别评估。

## Decisions

参考固定上游 Comet Classic `35c9860b77b42bafa0c2d80d8d695889f888a924`。其 `classic-sdk-archive-decision.ts` 在提案绑定 remote 和 PR base，`classic-sdk-delivery.ts` 依据已批准目标构造并核对交付结果，`classic-sdk-delivery-checkpoint.ts` 保留原 Run 的归档及验证历史。Repoctopus 采用同一责任边界，由 Runtime 传递已经校验的发布授权，由 Delivery 适配器执行与观察。Comet Classic 的该路径负责验证实际 Git/PR 交付，Repoctopus 仍使用自己的多仓副作用及 Journal。

Archive Runtime 已比较当前 `DeliveryPolicy` 的摘要与冻结输入。规格发布端口接收这份策略，其 GitHub 客户端复用业务发布的 API 与凭据选择。MR URL 继续用于确定仓库和编号。发布集合、Closure、Work 和 Journal 的数据结构沿用现有实现。

受影响的受保护实现采用当前既有组合采纳机制，逐项核对直接前驱的代码、描述符和状态契约。验收保持两个原 Run 与原配置，先核对已创建的两个业务 PR 和规格分支 OID，再继续执行。

## Risks / Trade-offs

- 部分完成后重试可能重复提交、推送或创建 MR。验收以实际 Git refs、HTTPS 请求计数、原 Journal 和终态 Receipt 交叉核对。
- 安装包升级可能改变受保护组合。只接受经实际包核对的直接前驱，保留当前策略漂移与状态兼容性守卫。
- 验收使用本地测试凭据。回归应证明配置了自定义 API 时，规格发布所有 API 请求均留在授权目标。
