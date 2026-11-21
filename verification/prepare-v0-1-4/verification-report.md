# Repoctopus v0.1.4 候选验证

Tested implementation commit: `a8e7dccd1e6312b2d245cccedf5c0e0121d4ee54`

Package content SHA-256: `68b4af2602a05868721211c5ea69c0b83b705b7ff68d74203159bbad7eb52ff3`

Package files: `489`

Package content bytes: `6625016`

实际验收包为 `repoctopus-0.1.4.tgz`，文件 SHA-256 为 `96694dfc4e4be478e5992d08841a84f20c5b1ba57f55d11bab63a1d2020bce22`。最终版本提交重新打包所得文件摘要与测试包一致。

- 实包 npx 检查通过，覆盖版本、帮助和项目探测 JSON。实包协议及团队 Skill 组合测试共 6 项通过。构建和生成物一致性检查通过。
- 默认三仓 Run 通过从 Init 到 Archive 的完整验收，首包后换进程恢复同一个 Run，规格 PR 响应丢失后恢复原 PR，终态复读没有重复发布。收据记录的候选文件摘要与本报告一致。
- 默认 Design packet 同时交付固定 Action 和 `codebase-design`。团队五仓场景交付同一份 Action、团队方法及规则资源，默认方法从 packet 移出。Host 根据交付的资源，在原 `design.md` 中记录规则 token 与策略选择依据。两个文档包按已批准的 autonomous + direct 实施，实际内容与回归检查通过。
- 锁文件版本更新曾连带改到一处间接依赖版本范围，最终提交已恢复原范围。重新打包后候选文件字节一致。

多仓验收的审批和发布服务是隔离的实验夹具。GitHub Release Prepare 将从通过 CI 的 main 提交构建并验收正式草稿所用工件。
