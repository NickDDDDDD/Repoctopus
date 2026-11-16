# Tasks

## 1. 复现与绑定前防护

- [ ] 1.1 固定真实三仓复现及保护回归。
  **Acceptance:** 基线安装包在解除跟踪提交后通过 `resume` 和 `next` 报同一 Workspace 的 `unaccepted-head`，Work ID 保持一致，记录 `work-reconcile` 的实际返回。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 1.2 在 Build Configure 的受保护接受前检查运行时文件跟踪。
  **Acceptance:** 有冲突时给出仓库和路径且缺少初始 Binding/checkpoint，清理提交后换进程可继续原 Configure，正常本地输出通过。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪

## 2. 已绑定 Run 的受限恢复

- [ ] 2.1 使用 Git 与现有仓库输入策略分类清理候选。
  **Acceptance:** 纯运行时输出解除跟踪通过，混合业务提交、普通文件删除、运行时文件内容修改、其他仓变化、分支变化、历史改写和观察不全均被拒绝。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 2.2 在 `resume` 与 `next` 的同一 Build 恢复入口接纳纯清理进度。
  **Acceptance:** 一次受保护提交更新原 Run 的 Workspace checkpoint 和对应 blocker，保留有效 Approval、Plan、Work 与 Completion。重复 pull 不重复应用。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 2.3 验证原 invocation、并发和提交中断边界。
  **Acceptance:** 原结果未知时保留待核对执行，过期 Run revision 或 checkout 不写入，受保护提交中断可恢复为一次接受且无部分状态。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交

## 3. 交付证据与用户说明

- [ ] 3.1 用 Windows 实际安装包完成独立多仓验收。
  **Acceptance:** 两条真实多仓序列覆盖绑定前清理及已绑定后清理。分别从新进程调用 `resume` 和 `next`，核对同一 Run、未完成 Work、先前有效完成事实、混合提交拒绝和后续 Build Check、Verify。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪, change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 3.2 更新 Runtime 状态说明与正式验证证据。
  **Acceptance:** 文档准确说明初次防护、已绑定恢复和需要另行处理的冲突，验证报告绑定安装包与实际 CLI 收据，证明恢复遥测没有加入路径或 OID 指标标签。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪, change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
