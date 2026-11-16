# Archive 发布 API 设计探索

## 已确认范围

修复已冻结 Archive 的业务与规格发布使用不同 API。以原两条 Windows 五仓 Run 验证首次发布和部分完成后继续，保留原策略、归档和 Verify 证据。

## 候选方案

借鉴固定 Comet Classic 上游的目标绑定和交付核对。Runtime 在既有策略摘要校验后将同一份 DeliveryPolicy 交给两个发布入口。规格发布端口要求该策略，Delivery 复用 GitHub 客户端构造。

复用现有 Journal 和精确直接前驱采纳。分别核对两个原 Run 的真实 checkout、已推送 OID、已创建 MR、终态收据和冷恢复。当前批准的 OpenSpec delta 满足该设计。

## 待确认

技术方案和 Build 执行配置待当前 Design 决定。
