# 工作流 Skill 与宿主支持集成验收

Tested implementation commit: `e020134851d8e904767ddfaa47f7f37a369c189a`
Package content SHA-256: `f25e2ad07a2e04122f622e99bcc42d51dfa61ba3aeec80c407a763c43988884b`
Package files: `485`
Package content bytes: `6324801`

合并宿主扩展归档后，保留了两份 OpenSpec 中各自新增的要求，并通过严格校验。Windows 上从实际 tgz 安装生产依赖的包回归通过，接入 E2E 的 5 项测试通过。重新打包确认内容摘要与原候选一致。

[原安装包和 IDE 验收](../install-workspace-workflow-skills/verification-report.md)
