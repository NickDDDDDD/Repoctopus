# 安装包来源诊断验证

Tested implementation commit: `bab005f273236926113d6c4bfb66ee906ec2e473`
Package content SHA-256: `c6187c00239b0f4dba852c49f665d0ea607770383a930ec7bc19f15e44eba8cd`
Package files: `468`
Package content bytes: `5959560`

## 根因与改动

运行 doctor 的来源诊断曾把源码 lockfile 和准备脚本当成发布运行资源，导致 npm 生产安装 ENOENT。安装后检查现在使用既有来源清单、受保护摘要及实际生产依赖身份；开发脚本仍拥有完整 lock/integrity/禁止依赖图/开发准备审计，未修改其内容或标准 verify 接线。

固定 Comet 0.5.1 commit `35c9860b77b42bafa0c2d80d8d695889f888a924` 的参考为 `domains/skill/platform-install.ts` 的随包 manifest 检查与 `scripts/release/package-e2e.mjs` 的安装后 doctor 检查。仅借鉴职责划分与验证方法，无新增上游源码副本、SDK 或持久状态 schema。

## 已执行证据

- 原实现的无开发资源回归真实失败于缺少 lockfile；新增包 E2E 针对修复前 main tarball 同样失败于该位置。未回退产品源码制造 RED。
- 依赖解析中 CommonJS NODE_PATH 回退、最近依赖元数据缺失被祖先副本掩盖各有独立真实 RED→GREEN。当前实现限定正常祖先 node_modules 查找，存在的最近包目录缺少元数据立即失败；保留正常 hoisting 与文件系统 symlink 解析。
- 来源回归 23 项与产品 composition 回归 1 项通过；包括健康生产 fixture、缺失/格式/名称/版本错误、禁止声明、正常 hoisting，以及真实源码审计版本/integrity/准备脚本三个失败反例。
- 类型检查和针对修改文件的 ESLint 通过；完整源码来源检查通过。
- 最终提交构建的指定 tarball 经真实 `omit=dev` 消费 E2E 通过：无 lockfile、准备脚本与 Electron 开发依赖；公共 doctor 健康成功、Cordis 资源篡改结构化失败、恢复后成功；每个诊断后 Run、Checkpoint、Trajectory 原始字节保持一致。
- 独立审查覆盖最终实现和测试，两个 P2 解析发现已解决，无未解决 Critical、Important 或 Minor。

原始完整日志由本轮外部隔离证据目录保留；仓库报告不嵌入本机路径、用户身份或凭据。早期 fingerprint 失败和审查前包结果保留历史，不冒充最终候选证据。

## 正式准入与边界

任务实现与上述相关检查不代替阶段准入。完整 `npm.cmd run verify` 的真实结果、输入身份、日志及是否复用，以本 Change 的 Comet Build/Verify Guard 收据为准；完整检查失败不得归档或交付，修复后仍需重新通过。归档、PR CI 与合入 main 后安装包复验分别核对，不从代码审查推断通过。

未执行 Node22 独立进程矩阵、pnpm 实际安装或 Desktop 安装验收，本次不宣称这些项目通过。诊断的生产包身份检查不冒充完整 npm 文件加密完整性审计；开发源锁 integrity 校验继续由 CI 承担。
