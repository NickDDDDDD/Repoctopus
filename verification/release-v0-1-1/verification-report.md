# v0.1.1 版本维护与发布准备验证报告

Tested implementation commit: `d243f102ffe336342a061c04e45d8f4d0b4ff399`

Package content SHA-256: `e9602b537ce81e6d636deb287d58ad57e0eb1f872a06d5c2c69f6b38eb5d1961`

Package files: `471`

Package content bytes: `6013443`

## 候选与验证边界

产品包版本为 0.1.1，实际本地候选原始 SHA-256 为 `98c6622bd16819f1bde5ee5d959449850c5bafb2063e6102d6ebc7704d7a2a9b`。上述提交重新构建的候选与此前已实际安装、消费的候选逐字节相同，已比较压缩包原始摘要和内容清单摘要；非打包的发布脚本修复未被误记为新产品字节。

此报告记录本地发布准备与真实消费验收，不宣称 v0.1.1 已公开，也不把源码检查代替后续 Windows 安装器验收。正式 Build/Verify、PR/main CI 和 Release 操作仍由各自真实回执确认。

## 已完成的真实检查

- 修改前发布策略、workflow 和包内容摘要基线为 3 文件、12 项通过。
- 新版本元数据下，5 个真实失败暴露了默认帮助吞掉裸 --version，以及 Resource/三个 Scope 仍为旧版本。修复后 CLI 在业务目录报告自己的包版本，显式帮助优先级保留。
- 最终相关回归 9 文件、48 项通过；类型检查、目标 Lint、架构/品牌检查及 Change 严格规格校验通过。根 lockfile 只改变根产品的两个版本值，依赖解析、独立插件、协议、schema 和第三方版本未批量更新。
- 产品默认遥测版本来自包元数据，原有服务名和显式 OTEL Resource 版本覆盖保持；显式覆盖回归与默认版本检查分别执行，Scope 仍标识实际产品版本。
- 指定候选 tarball 的生产安装包 E2E 通过，包含已安装 CLI --version 与包元数据一致、公共协议、doctor 健康/损坏反例和接入信任边界。独立工具目录中的实际 CLI 输出 0.1.1。
- npx 版本门禁的真实 RED 使用先前保留的 0.1.0 本地候选：旧脚本错误接受后，加上版本核对可明确拒绝。此文件不是公开 v0.1.0 Release 的替换资产。
- 新 0.1.1 候选连续 npx 调用复现 npm 11.19.0 的 null/name 解析失败；同一候选仅启用文档已有 legacy-peer-deps 参数后通过。脚本补齐该参数，在未依赖该环境变量的调用中通过版本、帮助和 project detect JSON 协议验收；没有升级依赖或修改产品来掩盖 npm 失败。
- 真实 Windows PTY 通过安装包公共 project review 批准新的三仓 Workspace，实际生成 README、AGENTS 和本地教程，5 个本地链接均有效。未伪造 TTY、未导入源码 apply；此场景验证初始化，没有启动或宣称完成一个新的五阶段 Change Run。

## 独立审查与修正

初段独立审查无 Critical/Important 代码缺陷。对默认 Resource 版本与现有 OTEL 显式覆盖的措辞建议，经同一 Run 的正式 Design 修订澄清，保留已确认执行配置和已有实现，补充兼容回归。

最终源码审查发现一个 P2：public-smoke 默认检出 dispatch main，而目标 Release 可以是较早的合法 main 提交；主分支版本推进后，新 npx 版本检查会误拒绝正确旧候选。工作流契约真实失败后，将 public-smoke 检出固定到 preflight 核对的精确 Release 提交，候选和公开消费保持同一来源，回归转绿并经独立复核关闭。最终集成证据审查以本次审查回执为准。

初始化外部核对工具曾将正常 YAML 配置当作 JSON 解析；工具修正为使用已安装的 YAML 解析器后复核通过，未修改产品或验收数据。原始失败保留，不将工具错误归为 Runtime 缺陷。

## 正式阶段检查与后续发布

正式 Build Guard 使用 check policy 声明的 `npm.cmd run build`，Verify Guard 使用 `npm.cmd run verify`，并绑定实际命令、完整输入及退出码。实现任务和报告就绪后由当前 Run 执行这些阶段动作；本报告不以提前勾选或人工声明代替真实 Guard 收据。

归档、PR、成功的 main push CI 之后，按用户已授予的发布授权执行既有 prepare；核对同一候选、草稿、工件 ID、SHA256SUMS 后执行 publish，并等待公开下载与 npx smoke。冲突或结果未知先核对，保留原候选和旧 Release；公开结果以远端回执为准，不回写已封存的归档来制造完成事实。

前一 Change 曾发生一次 Desktop 激活偶发失败，原始失败与根因未明的限制继续保留；本次没有将版本更新宣称为该问题的修复。
