# Tasks

## 1. 固定回归与 coverage 领域契约

- [x] 1.1 增加项目探测回归，证明新生成的 required 命令节点显式使用 `covers: ['*']`，并产生需要人工复核的 coverage finding <!-- comet-task:c120d0c8-62fe-4337-afcd-91aa4fe669ab -->
  **Acceptance:** 探测候选不再生成空 coverage；finding 清楚说明 workspace-wide coverage 可在批准前收窄；探测仍不写正式配置
  **Requirements:** project-configuration / 探测候选必须提供可审查的 Change coverage

- [x] 1.2 增加项目审批回归，证明默认 `verify` Profile 缺失或全部 coverage 为空时不能建立可批准请求，而合法的 required coverage 与无 coverage 前置节点可以共存 <!-- comet-task:f653c208-76d0-428d-8193-b15d861c760b -->
  **Acceptance:** 默认 `verify` 缺失、无 required coverage 或 optional-only coverage 时在写正式配置前返回可定位诊断；至少一个 required coverage 节点时正常准备审批；其他独立 Profile 不被误判为 Change Verify Profile
  **Requirements:** project-configuration / Change Verify Profile 必须在审批前静态可用

- [x] 1.3 提取并测试单一 Acceptance coverage resolver，覆盖通配、Task、Requirement、精确 ID、重复、未知、未覆盖和 optional-only 规则 <!-- comet-task:dbae7715-35c0-4eb9-a55b-0104144dc19d -->
  **Acceptance:** Design preflight 与 Verification Input 使用同一纯函数；同一输入产生稳定排序和摘要；既有 Verify coverage 测试保持通过
  **Requirements:** implementation-evidence / Acceptance coverage 使用单一确定性解析权威

## 2. 在 Design→Build 边界 fail-fast

- [x] 2.1 在 Design gate 接入只读 coverage preflight，在 Planning Snapshot 形成后、Human Decision/Build Work 前用当前 Tasks 和实际 Verification Profile 完成精确解析 <!-- comet-task:bd0fae33-6f2e-4af8-8cf6-7cd5549ecfbd -->
  **Acceptance:** coverage 不完整时 Run 保持 Design、没有审批请求、Build Work、Evidence Attempt、仓库 fingerprint 或命令执行；错误指出未覆盖 Acceptance 或无效 selector；preflight 后规划摘要漂移也 fail closed；修正配置后可从同一 Design checkpoint 重试
  **Requirements:** implementation-evidence / Design 完成前必须证明 Verification coverage

- [x] 2.2 增加真实 Runtime 回归，复现旧行为会在 Build Check 后失败，并证明新行为在进入 Build 前阻断，同时合法 coverage 的 Open→Design→Build 路径不受影响 <!-- comet-task:3fa8819f-ba2d-44fc-9ab5-60eab0e9779f -->
  **Acceptance:** 回归同时断言 phase、current Work、Task 状态、Evidence Attempt 数量和 Build Work 缺失；合法路径至少推进到 Build Configure
  **Requirements:** implementation-evidence / Design 完成前必须证明 Verification coverage

## 3. 文档与验证

- [x] 3.1 更新项目接入和 Evidence 文档，解释生成的 `*` 是待确认的安全候选、细粒度 selector 的收窄方式以及 Design preflight 的失败恢复 <!-- comet-task:dde9bfba-dd86-406c-b77f-8a0ce66d2aba -->
  **Acceptance:** 文档不把 `*` 描述为所有团队的最佳实践；明确修改共享配置并重试原 Design checkpoint，不允许手改 Store
  **Requirements:** project-configuration / 探测候选必须提供可审查的 Change coverage; implementation-evidence / Design 完成前必须证明 Verification coverage

- [x] 3.2 运行定向测试、生产 CLI 多仓初始化复现、完整 `npm run verify`、package E2E、tracer E2E、严格 OpenSpec 校验和 Comet 0.5.1 Guard/Check <!-- comet-task:fcc4b227-2a35-473e-8e0e-f1381cb73bdc -->
  **Acceptance:** 旧失败场景在修复前证据可复现、修复后从新初始化项目完成静态和精确 coverage 预检；全部声明检查退出 0；临时项目与日志清理完成
  **Requirements:** project-configuration / Change Verify Profile 必须在审批前静态可用; implementation-evidence / Acceptance coverage 使用单一确定性解析权威

