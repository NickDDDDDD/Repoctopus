---
change: recommend-build-strategy-from-context
design-doc: openspec/changes/recommend-build-strategy-from-context/design.md
base-ref: a25b9f7
archived-with: 2026-11-19-recommend-build-strategy-from-context
---

# 场景化执行策略实施计划

<!-- comet-task-authority: openspec/changes/recommend-build-strategy-from-context/tasks.md -->

执行 autonomous + TDD + thorough，沿用当前 worktree。唯一任务完成权威为上述 tasks.md，本文只映射实施顺序，不建立 checkbox。

## 第一段：偏好、候选与原子接受

<!-- comet-task-ref:a62e6fb0-79be-4feb-b8f4-ced99cf94d42 -->
先在公开启动路径建立缺参静默默认的失败回归。实现未决/部分偏好、候选类型与边界校验；同步消除独立审批入口的默认策略，测试非法输入及来源保留。

<!-- comet-task-ref:2b7a50f4-1883-401e-a4a7-1923062a0f3e -->
在 Design Work 校验候选，从原已接受 submission 创建策略并在原 Design gate 提交候选与请求。批准时重验并同时接受规划与策略；Configure 读取已批准值。阶段审查检查 Work 归属、无结果纠正和审批 receipt/CAS 中断。

## 第二段：入口和方法说明

<!-- comet-task-ref:6c5c49ef-7a54-4189-af15-ad85e9394d5d -->
更新真实 Action Skill、入口与生成模板，让两轴建议与当前 Work 的结果格式一致；保留 Matt/OpenSpec、固定 Review、逐 Work 能力和真实消费要求。用安装模板与 Skill contract 检查验证。

<!-- comet-task-ref:a701ac8f-c99a-40cf-99aa-e6d6477fe3e2 -->
对齐 CLI 帮助、用户文档和本地教程，验证文档命令及生成内容，不描述隐式批准或新增常规配置审批。

## 第三段：恢复和执行约束

<!-- comet-task-ref:e50b95cd-d8e9-4d5e-aee7-b898aa205a16 -->
补齐 run revise-strategy 意图入口及安全状态约束，测试原请求重放、Provider receipt 已写但 Run CAS 未写的恢复，显式改选与等价输入的不同失效范围。

<!-- comet-task-ref:67524809-8c40-40c4-b28e-3e05e578cba3 -->
验证四种合法组合、缺能力阻断、TDD RED/GREEN/回归及受管委派回执；无自动降级、无执行中直接切换。独立审查此段与第一段的恢复交叉点。

## 第四段：实包和完整检查

<!-- comet-task-ref:2171ed0c-5507-4d1e-a071-7e0414535fd8 -->
构建并安装实际候选 tgz，在独立多仓实验执行行为修改、可分工任务和文档场景。至少一次真实宿主原生 Design 答复，验证决定和首包后的同 Run 冷恢复、真实归档及发布去重。原始证据和包置于仓外，记录实际包摘要。

<!-- comet-task-ref:d55b0d76-6d49-481c-be64-881c115c4ff7 -->
完成最终独立审查、规范化包身份验证报告和完整 npm verify。原始失败、修复及未覆盖项如实记录，所有阻断问题修复后才提交 Build 完成，不提前归档或发布。
