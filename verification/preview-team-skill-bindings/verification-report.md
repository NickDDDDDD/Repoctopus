# 团队 Skill 预览验收

Tested implementation commit: `e4f197ba2795fcc19d7dd413b9e43b0553f7ca4e`

Package content SHA-256: `a1e3b35b34bc2c11dec65dc93ba497404d5e1991ac80887aa1ba5d36598fd795`

Package files: `487`

Package content bytes: `6502339`

在 Windows 构建并安装实际 `.tgz`，运行 `test/e2e/skill-preview.e2e.test.ts` 的 9 项公开 CLI 验收。全部通过。

- 终端和 JSON 都展示九个 Work 的 Skill 位置、角色、Provider 与来源。Build Check 中 `code-review` 排在团队指导之前，Build Execute 区分 TDD 和 direct，Build 重试显示诊断 Skill 的条件。
- 按实际安装包生成的教程复制 Skill 正文和 YAML。首次 Init 和已有引导刷新成功，刷新保留区块外的团队文本。在同一接入配置添加 Open 绑定，从真实 Run 领取 Open Work 后，Skill 名称、角色、顺序与预览一致。
- 创建 Run 之前预览不新增运行状态。创建并领取后再预览，公开 Run 状态无变化。固定文件、正文和资源的测试标记未出现在预览输出。
- 不合法的 Work、slot、本地或共享 YAML、缺失 Skill、冲突的 TDD 方法及可执行团队插件配置返回失败诊断。只读查询会指出可执行团队插件，并在导入插件之前退出。

TDD 先观察到新增命令在旧版本返回 Usage，再完成 CLI、教程与回归。源代码针对性测试共 40 项通过。独立审查对实现提交重新核对，39 项针对性测试通过，无未决问题。类型、Lint、架构与变更级 OpenSpec 严格检查通过。完整门禁由同一 Comet Run 的 Verify 收据记录。
