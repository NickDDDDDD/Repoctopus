# GitHub Releases 与 npx 验证报告

- Tested implementation commit: `8639597ea66bb9b13459f3cd5e5518b71c81e24c`
- Package: `repoctopus@0.1.0`
- Package files: `459`
- Package content bytes: `5660455`
- Package content SHA-256: `51c095776c50208d3034f4764f78ce8de6bd2bfc4510f2f148cef1739391fc76`
- 验证环境为 Windows x64、Node.js 24.21.0、npm 11.19.0 和 Comet Classic 0.5.1。

## 验收

- 三个定向测试文件共 13 项通过。测试覆盖精确来源、草稿的部分上传重试、Tag 与资产冲突、来源标记、篡改摘要、写权限和工件解包边界。
- 使用真实 GitHub API 与远端 Git 引用验证基础提交 `fa12a31` 的 `main` push CI 和 `verify` 作业。候选分支提交、版本不匹配和本地发布写入均被拒绝。该检查未写入 GitHub。
- 从实现提交 `2d2c6a9` 执行 Prepare 的候选命令。CLI 对实际 tarball 通过 package E2E 和空缓存 npx 帮助与 `project detect --json`。桌面包通过结构检查及八项安装验收，包括激活、单实例、托盘、退出、卸载和注册项恢复。候选 EXE 为 116547350 字节，SHA-256 为 `119cd21855139f85c941daf181039f338c2bb8d01a286d279161d6f20fc960fa`，与真实安装回执一致。封存检查复算三个资产身份。
- Windows 打包在已有构建输出上首次遇到 Electron 解压目录重命名 EPERM。移开本次生成的旧输出后重跑桌面步骤并通过，原先已验证的 CLI 包字节保持相同。GitHub 作业使用干净 checkout。
- 最终文档提交重新打包，实际 tarball 的 package E2E、空缓存 npx 帮助与 JSON 协议再次通过。该 tarball 的规范化内容摘要如上。
- actionlint 1.7.12、TypeScript 检查和 ESLint 已通过。Build 的独立分段审查发现并复核了 v4 工件目录、权限、远端引用刷新、Release ID、来源标记及恢复说明修正。
- 最终独立集成审查无 Critical 或 Important 问题。审查者复算三份候选文件摘要并核对八项 Windows 安装回执。托管 Windows 失败会保留作业日志并阻止发布，失败回执的 JSON 目前不单独上传。
- 真实 Release 草稿、公开下载和公网 URL 的 npx 验收按已批准设计在合入后执行。本地候选来源记录使用演练 ID，未创建 Tag 或公开资产。
