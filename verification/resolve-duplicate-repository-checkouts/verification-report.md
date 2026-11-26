# 多仓接入 checkout 验证

Tested implementation commit: `15fa233bff5a3646265a5f48bbdb8986632df7dc`

Package content SHA-256: `c30f7724a8f412fed6a28ce7f21c05cb3d3ce784fa9eb4baa9ed57368eb520dd`

Package files: `493`

Package content bytes: `6846122`

## 修复前回归

Windows 的公开 `project detect` 在两个同远端 checkout 并存时只列出 Workspace 和无冲突业务仓。显式选择其中一项仍报 `Selected repository is not in the current scan`。提交 `c9f3bf5` 的 CLI 回归先复现候选遗漏。

## Windows 实包验收

从该实现提交运行 `npm run build` 与 `npm pack --ignore-scripts`，再用 `npm install --ignore-scripts --omit=dev` 独立安装 `.tgz`。归档文件的传输 SHA-256 为 `da89711b89c5c2bb4a3947dfbd4209266a6f66ec10e954094eca94be40b2e349`。组合验收运行公开 CLI 并使用隔离的本机 Git 远端。

- `project detect` 显示同一远端的两个路径。未选定路径时，Init 阻止生成批准请求。
- 支持含空格的相对路径，拒绝同组双选和范围外 checkout。显式选择无冲突仓时，可以排除其他组。
- 修改草稿状态并移除冲突记录仍无法生成请求。已授权路径的远端变化或同源 checkout 互换会被审批复查拦截。恢复原 checkout 后可以完成同一接入请求。
- 只向所选业务仓写入 OpenSpec pointer。未选副本保持原样。重新接入保留有效登记的路径与 ID，冲突的仓库 ID 请求被拦截。
- 独立 CLI 进程完成接入后，以有效 Git 分支启动第一个 Change 并进入 Open。

## 回归和检查

关联工作树回归验证了普通提交保留 checkout 身份，原地改向 Git 管理目录会改变身份。旧 Verify 探测保留手工配置中仓库 ID 差异的原有判定，相关探测测试 6 项通过。针对安装包的多进程场景最初超出默认 30 秒测试限制，设置该场景的 120 秒上限后复跑通过，最终候选的实包验收耗时 31.54 秒。

对当前实现运行的完整 `npm run verify` 中，1335 项测试通过、4 项跳过。生成物、品牌、架构、来源和 Dashboard 检查通过，OpenSpec 严格校验 16 项通过。末项 `check:managed-execution-report` 要求为含改动的候选补齐可复构摘要。记录摘要后单独补跑此检查，重构的安装包内容与实测候选一致。

独立审查复核了批准边界、显式仓库选择、同源替换、linked worktree 指针和旧探测规则。最终没有未解决的严重或重要问题。
