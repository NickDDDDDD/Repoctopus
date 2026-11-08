# 设计探索摘要

目标：修复生产安装 doctor 的开发资源依赖，并守住来源损坏和只读诊断边界。非目标及验收以 proposal 和 delta spec 为准，无未解决需求问题。

## 方案比较

- 选用：运行诊断继续消费已分发来源清单及实际生产依赖身份；CI 保留源码 lock/integrity/准备脚本审计。使用已有 Cordis Command 与来源诊断平台模块，不新增权威或模式开关。
- 不选：改名分发整个开发 lockfile。增加开发输入负担，仍不能证明实际安装版本，且另有准备脚本未分发问题。
- 不选：ENOENT 时直接略过来源诊断。这会让真损坏变成健康。

## 已核对事实与参考

- npm 根 lockfile 不分发，生产安装不含 scripts/prepare-desktop.mjs；失败位置在运行来源诊断的 DSH 检查。
- 固定 DSH 包均支持通过 Node 产品根 resolver 解析 package.json；Cordis vendored workspace 沿用现有快照校验。
- Comet 0.5.1 的 manifest 必需资源检查及实际安装后 doctor E2E 可复用为设计原则，不引入其 SDK，也不复制新上游代码。
- 源码审计脚本独立存在并仍在标准 verify 中；需要正反例证明没有弱化。

## 授权与当前状态

用户已授权代理执行中间人工确认，并要求修复、合入 main 后验证直到通过。Open 已经以当前产物哈希通过正式 Guard；此处候选设计将通过正式 Design 提案/决定入口确认，未绕过 Runtime 或手改 Store。
