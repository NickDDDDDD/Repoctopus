---
change: verify-release-multirepo-workflow
design-doc: openspec/changes/verify-release-multirepo-workflow/design.md
base-ref: c18d9be354750dae5052ed312f95d68c0c60b5c1
---

# Windows 多仓候选包验收实施计划

<!-- comet-task-authority: openspec/changes/verify-release-multirepo-workflow/tasks.md -->

## 独立消费与完整流程

<!-- comet-task-ref:4b087a72-25e9-4ea4-827b-a7e517cf6e65 -->

为候选参数、安装失败和验收收据建立失败回归。创建独立 Node 入口和本机 Git/HTTPS 夹具，消费显式 tarball。测试 Host 按实际 packet 调用公共 CLI 完成三仓 Change。复用已有安装包消费、发布收据和本地多仓实验的方法。读取已安装 Skill、按 invocation 提交，不直接改写 Runtime 状态。

## 冷恢复

<!-- comet-task-ref:c7b8f639-34f2-42a1-a78f-b62e5ed48d03 -->

第一驱动进程完成首包后退出，第二进程从持久化标识恢复。核对 Run、计划和首包完成记录及实际执行计数，随后执行第二包与真实 Verify。

## 发布未知结果

<!-- comet-task-ref:957a7a41-9038-4cba-8366-2c12a396081f -->

夹具记录所有入口请求。规格 PR 持久化后断开创建响应，并暂时隐藏列表查询。等待阶段与恢复阶段分别采样原始写请求计数、PR 身份及远端 OID，确认同一 Run 最终完成。终态 resume 与 next 再核对状态及副作用。

## Prepare 门禁

<!-- comet-task-ref:393efa9a-89b0-4f04-85dc-9283369c7770 -->

为工作流显式候选参数、执行顺序和 seal 收据校验建立失败回归。将独立命令接到当前 candidate 作业，并在候选目录外记录工作流证据和诊断。seal 校验关键检查、候选大小与摘要。失败时停止上传候选，单独上传诊断。

## 实包验证和文档

<!-- comet-task-ref:b89cd085-8d91-45b9-8892-c68a5b521bd1 -->

使用 Windows 实际候选包执行独立入口，保存命令和机器收据，验证与 Prepare 相同参数及封存正反例。更新维护者安装文档中的独立验收、证据位置和发布流程。完成分段独立审查及唯一最终集成审查，执行精确的 npm.cmd run verify。完整远端 Prepare 随合入后的下一版本候选执行。
