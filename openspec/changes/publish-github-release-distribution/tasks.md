# Tasks

## 1. 选定版本与构建候选

- [ ] 1.1 接入维护者手动触发的 Release workflow。验证远端 `main` 归属、精确 SHA 的完整 CI、版本与 Tag 的匹配，覆盖条件不满足时无写入的情形。 <!-- comet-task:8c2969a5-bd33-4300-a327-8514a214105a -->
- [ ] 1.2 复用固定依赖、CLI 构建和 Windows NSIS 打包命令。通过一次候选构建确认输出包含预期的 CLI tarball 与 Windows x64 安装器，且都来自同一 checkout。 <!-- comet-task:b336b12d-356e-46ce-9c78-3a77b81b8bee -->
- [ ] 1.3 用候选 tarball 执行独立消费者的 CLI 协议验证和空 npm 缓存的 `npx` 验证，检查 Windows 消费路径。 <!-- comet-task:b42691b9-d66c-4799-8df6-f58027688bf2 -->
- [ ] 1.4 对候选桌面安装器运行既有包检查与 Windows 安装到卸载验收，确认安装、激活及清理回执。 <!-- comet-task:9aaa1d43-bb64-4e6b-aeec-5319b5443520 -->

## 2. 草稿与校验

- [ ] 2.1 生成 `SHA256SUMS` 和发布来源信息。通过摘要复算及故意改动一份资产的用例验证文件传递边界。 <!-- comet-task:3cd3ddc3-da07-4f27-911c-b7ce67f09126 -->
- [ ] 2.2 增加最小权限的草稿步骤。用成功、上传中断重试和 Tag 或资产冲突用例验证草稿复用、拒绝覆盖与公开前核对。 <!-- comet-task:ff5d5c96-3243-46f1-94ea-be983104d8ba -->

## 3. 团队使用文档

- [ ] 3.1 更新 README 与安装指南，提供固定版本 Release URL 的 `npx` 命令、Desktop 资产用途和本地包安装路径。校对命令在源码外的执行方式，验证公开前说明准确。 <!-- comet-task:adb1e577-0ff1-45dc-bae4-918afedde3dd -->
- [ ] 3.2 记录维护者触发构建、复核草稿、公开预发布、复验及失败恢复的步骤。按文档执行只读或候选演练，核对每一步的输入与证据。 <!-- comet-task:9c6f36f3-ef8e-47dc-a92f-ffc63111d03c -->

## 4. 集成验证

- [ ] 4.1 检查 workflow 的分支触发、权限和资产传递契约，执行组合验证，记录候选身份与本地或 GitHub 验收结果。 <!-- comet-task:e396e92b-436d-4299-a052-4a31b1f66ff8 -->

## Workflow follow-up

- 发布流程合入后，确认目标 `main` 提交的完整 CI 通过。
- 生成、核对并公开 `v0.1.0` 预发布，验证公开资产的 SHA-256 和固定 URL。
- 在源码仓以外用空 npm 缓存执行实际 Release URL 的 `npx`，核对帮助输出和 CLI JSON 响应。
