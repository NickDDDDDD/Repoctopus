# 多仓 Build 漂移恢复验证

Tested implementation commit: `d6ba7977da0947878c8610b49c8867f4095581c7`

Package content SHA-256: `fb211c77e4bb7c3aae785a03ce411bdb9c4a65a49bc3498c1b57300f8b588420`

Package files: `493`

Package content bytes: `6824477`

## 候选包

在该提交执行 `npm run build` 与 `npm pack --ignore-scripts`。以上规范化内容摘要由 `scripts/package-content-digest.mjs` 对实际候选计算。候选 `repoctopus-0.1.5.tgz` 的传输 SHA-256 为 `87d03f7b33593fb246a53a7d7e129af7dd4123b22b1ba06271adc7ea1831d6c6`。

## 修复前回归

- #114。首包已接受后，另一支工作树推进只读仓远端，本地以 `pull --ff-only` 获取，从未修复的 main 构建的 v0.1.5 安装包冷启动 `run resume` 在 Build 要求全仓 reconciliation。
- #115。首包已接受后，在包范围外的 Backend 单独提交，Git 祖先核对通过，从未修复的 main 构建的 v0.1.5 安装包冷启动 `run next` 同样进入 reconciliation。

## Windows 多仓安装包

两条 Issue 都使用本报告的实际候选，通过 npm 安装到独立目录。测试从真实 Init、宿主审批和 Git 提交走到 Archive，使用本地 Git 远端和 GitHub API 模拟服务。首包后启动新进程，核对原 Run、Plan、Work、epoch、checkpoint 和接受事实。各实验彼此隔离，模拟命名相同所以确定性 Run ID 相同。

| 场景 | 结果 |
| --- | --- |
| #114 只读仓从另一个工作树同步 | 通过。冷 `resume` 保留 1/2 个已完成包和当前 Work，最终 completed。 |
| #115 Backend 独立提交 | 通过。冷 `next` 保留 1/2 个已完成包和当前 Work。额外构造包含 Backend 的 Archive intent，在派发任何发布副作用前被拒绝。正常 intent 完成。 |
| 当前 Work 运行时读取依赖变化 | 通过。原 Work 保持到 Host 回传已知失败。CLI 重新读取了持久化的原 invocation，Runtime 在证明无剩余写入后派发新 Work，原 Run 完成。 |

三个候选场景的真实 PR base/head 都通过 Git 远端 OID 核对。两条业务 PR 的三点差异各只有 `docs/acceptance.txt`，另有一条规格 PR。包括规格 PR 响应丢失后的去重及重复终态恢复。

补充回归在本次实现的前序候选已通过。后续包使用 Backend 时当前包先验收，随后包从新的输入基线执行。未授权 checkout 被拦截，切回原分支后可重观待执行包。已完成包的读取依赖变化时，原实现 OID 和历史 RED 保留，重新取得 GREEN 和 regression 证据。

独立审查复核了运行中读输入漂移、精确 submission 拒绝、恢复到绑定 checkout、历史 RED 复用以及 PR 创建前的远端 source/target 校验，未留下阻断项。Git 路径回归覆盖外部提交之后又撤销的路径，发布回归覆盖远端 source 临时变化以及修复后同一发布 journal 重试。

## 全量验证

正在执行全量 `npm run verify`。Comet Build Check 与 Verify Guard 的结论将在实际检查结束后记录。
