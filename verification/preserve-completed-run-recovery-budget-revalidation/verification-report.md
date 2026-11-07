# 当前候选包与终态恢复复验

- Tested implementation commit: `b334f9cffc4ee5ca9f6a58a99b9401ad92e130c1`
- Package content SHA-256: `13fad2c836df214f2baaac6c08c2ecaeb2a31455ef83f53f9e67e0f2ec5655a2`
- Package files: `467`
- Package content bytes: `5951541`
- Tarball SHA-256: `c957d744113f2980f6a6a62f1bb6b22a11d8aabfb0ef7f99f5437fc6019bc866`

本报告记录当前提交的新打包、独立安装和有界终态恢复复验。完整五仓生命周期仍由原 `f22e29ff0261a376d9c8e2dc36c0235a5c901781` 候选的 C3 验收证明，见[原完整验收报告](../preserve-completed-run-recovery/verification-report.md)。没有把当前复验写成一次新的完整开发或发布流程，也没有改写原报告及原始现场。

## 当前提交与原 C3 的关系

实际核对 `f22e29f..b334f9c`：差异仅为 Comet 配置及状态、两份验证报告，以及 Windows 重流程测试的时间预算与注释；没有发布源码变化。当前提交使用稳定产物重新 `npm pack --ignore-scripts`，新包与原 C3 包经独立 `Buffer.compare` 逐字节相同；归一化身份、467 个文件、5951541 字节及原始 tarball SHA-256 也相同。新包安装到独立 prefix，未在产品工作树重新构建或修改产物。

原报告继续保留原始源码、全流程、实际 Close、三个 MR 和收据归属；当前报告将同一个实际验证过的产品包与当前提交及新增冷恢复运行关联。现有报告检查器保持不变，不新增豁免或放宽其提交祖先及包内容约束。

## 当前包真实冷恢复

- 对原 C3 完成现场创建新的五仓验证副本，逐文件核对原 Run 身份，并经公共 Store register 入口登记独立 registry；不编辑或重建 Run。
- 正常副本四次、业务目录暂时退役四次，通过新包执行两种 `resume`／`next` 顺序；另有九次独立 `status`。共 17 个不同进程 PID，原始 executable、argv、cwd、退出码及响应均留存。
- 全部响应为 completed、done/terminal、空 currentWork／nextActions，没有虚构当前项目观察；完整 Run、Checkpoint、Trajectory 及所有事件和副作用计数不变，stateVersion 242、checkEpoch 17。
- 业务目录在 finally 中恢复；未再次执行 Evidence、Close、Publish、push 或创建远端 MR。
- 11 个旧 Store 的 665 个文件，以及 31 份旧报告／摘要重算 SHA-256 均不变。原 C3 原始报告摘要仍为 `57fdc6463739536b344d717b1b3428e070e725170b852bd5742cf6e9fe35c6a3`。

## 独立复核与正式检查边界

独立 artifact reviewer 核对了当前 HEAD、源码差异、包字节、17 次实际进程响应、完整三元组和旧现场哈希，也核对了本报告 header 对原检查器的提交祖先与包身份契约；无 CRITICAL/IMPORTANT。该审计没有重跑 CLI、修改产品或伪造正式检查收据。

当前提交的 Linux CI 实际通过 1090 项测试、跳过 4 项；Windows 第三次正式命令实际通过 1089 项测试、跳过 5 项，均为 199 个测试文件通过、1 个跳过。两边严格规格均为 19 项通过；命令最终仍因旧报告未覆盖测试文件的预算修改而 exit 1，不能将测试通过写成完整 Verify Guard 通过。Windows 测试部分耗时 1805.56 秒，说明原 30 分钟外层预算确实不足以容纳完整命令。补齐本报告后仍需原命令的新正式完整收据。

## 原始证据

新独立目录为 `lab-b334-recovery-1108`，其中保留 package、安装 prefix、公共登记、每次进程账本和原始响应：

| 文件                                                      | SHA-256                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `current-candidate-revalidation.md`                       | `3e4febff35922567877b3c47dbb9833cb5934b65196f92d6f035bd2f676459dc` |
| `evidence/current-candidate-summary.json`                 | `54dffd981ecd809f06d34f64d40017e820189a4ff5b6cd4e7c303f1fd272de16` |
| `evidence/reviewer-current-candidate-artifact-audit.json` | `c8c03399af4bbfe02e71a434dc9223f933a7c75c872df60b5a8aaa0c6c80bf39` |

完整生命周期、当前包冷恢复、独立审计和正式门禁分别保留真实范围；本报告在后续正式检查前固定，最终门禁结果以同一 Comet Run 的实际收据为准。
