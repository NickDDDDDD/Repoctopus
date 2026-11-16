# Archive 发布策略验证报告

Runtime 校验冻结的 Delivery Policy 后，把同一份策略用于业务及规格发布。文件 Delivery Provider 共用 GitHub 客户端构造，使用已配置的 API 基地址和 Workspace 凭据引用。改变冻结地址时，Runtime 在发出 HTTP 请求或改变远端 ref 前拒绝。

[安装包验证报告](../../../verification/repair-archive-publication-endpoint/verification-report.md)记录修复前后、包摘要和测试范围。[五仓验收收据](../../../verification/repair-archive-publication-endpoint/acceptance-receipt.json)记录两条原 Run 的 Verify Bundle、Close 和发布事实、回放顺序与请求入口记录。

两条 Run 都达到 `completed`。普通轮复用两个业务 PR 和已推送的规格 OID，仅发送一次规格 PR 创建请求。返工轮保留既有后端包的完成记录，发布三个 PR，仅推送一次规格分支。每轮四次新进程终态读取均保留原收据和 Runtime 文件。

独立审查发现 CLI 的 `--policy` 可指定不同于 Workspace 的凭据引用。修复后，两个发布路径都从经过摘要核验的策略取凭据，省略引用时使用 `GITHUB_TOKEN` 默认值。最终安装包完成第三条隔离五仓 Run，28 次 API 请求均使用了显式获批的测试凭据，并再验证前两条 Run 的终态没有产生额外请求。

完整产品验证由 Comet 使用 `npm.cmd run verify` 执行，检查结果记录在当前 Change Run。
