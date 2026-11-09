# Workspace 初始化引导验证报告

Tested implementation commit: `4372d098d7266a00c2fbc7df91482860db2ace7f`

Package content SHA-256: `da55bf6bff556ffd71f6c891f23156df95cab80b3063708edcfb65d68b446af3`

Package files: `470`

Package content bytes: `6000100`

## 范围与包身份

安装后的公共 CLI 在获批接入时生成根 README、AGENTS 和本地教程；保留团队内容，接入失败沿同一请求恢复。候选由上述精确提交构建并独立安装生产依赖，未注入源码文件或伪造 TTY。候选原始 SHA-256：`e1bf1f9c6600c0d139d9ee535cfa4a0cdb4b24614fe2725f08673520cf3c75ea`。这是尚未公开的本地候选，不替换既有 v0.1.0 Release。

## 已完成的验证事实

- 首个接入回归在旧实现中因缺失本地教程得到真实 RED，正常生成后转绿。
- 文件保护覆盖受管区块损坏、重复/残片、UTF-8、BOM、混合换行、文件身份替换、并发变化、父目录和符号链接。接入覆盖拒绝/请求修改、配置最后发布、部分安装后恢复及 confirmed 重放幂等；相关 27 项回归通过。
- 独立 Build 审查发现的两个 P2：损坏标记残片、缺少整组物化复核，均有失败复现与持久回归，修复后独立复跑 27 项通过。
- 指定候选 tarball 的 package E2E 通过，覆盖安装后公共协议、来源诊断和项目接入未获可信终端批准时的无共享引导副作用。类型检查与目标 Lint 通过。
- 新三仓项目（Workspace、web、backend）：在真实 Windows PTY 先拒绝接入，确认不生成引导，再通过新请求批准接入并生成全部引导。
- 已有 README/AGENTS 的单仓项目：真实 PTY 批准后，区块外原始 CRLF、无结尾换行及团队规则按字节比较保持不变。
- 两个场景均提取生成教程的原始 PowerShell 启动及恢复代码块，在真实终端执行；分别启动 Open Run 并从新进程恢复同一身份。此项验证启动/恢复入口，不宣称跑完新 Change 的五阶段。
- 两个场景共验证 10 个本地 Markdown 链接，均存在且为有效文件。
- 最终生成的 README 与教程经 GitHub GFM 实际渲染，首个标题和仓库表格均正确显示；HTML 区块与 Markdown 正文之间保留分隔空行。
- 新增渲染器及安装器已登记到既有接入组件的 `sourceFiles`，源码变化进入组件代码摘要；组合快照回归与实际包身份一致。
- 三仓现场另行模拟旧接入已存在配置/Store/Run、但缺失全部引导的情况；执行教程中的新成员接入原始代码块，以现有共享配置准备并批准新请求，全部引导恢复，公共 Run state 与补齐前完全相同。

## 复现与证据

自动化入口为 `npm test -- test/workspace-guides.test.ts test/project-onboarding.test.ts` 与 `REPOCTOPUS_PACKAGE_CANDIDATE=<实际候选> npm run test:package-e2e`。交互批准由实际 `project review` 接收终端输入，未绕过安装包 CLI。包身份、场景结果和恢复身份摘要见同目录 `acceptance-receipt.json`；完整原始命令、输出与独立审查报告保存在本次会话 Evidence 中。

正式 Build Guard 使用 check policy 声明的完整构建 `npm.cmd run build`；Verify Guard 使用标准完整验收 `npm.cmd run verify`，由同一 Comet Run 提交各自真实收据。本报告的写入不代表该后续 Guard、CI、归档、PR 或 Release 已完成。最终状态与完整检查退出码以该 Run 的实际回执为准。
