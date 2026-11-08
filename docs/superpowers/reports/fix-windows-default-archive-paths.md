# 最终 Verify 结论

Change：fix-windows-default-archive-paths。使用 Comet Classic 控制本次产品修复，Repoctopus 只承担独立多仓验收。

## 完整性、正确性与一致性

| 维度   | 核对结果                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整性 | OpenSpec spec-driven 四类产物齐全；正式 apply context 为 all_done，12/12 完成，remaining=0，没有不可读任务文件。                                        |
| 正确性 | 四项新增要求与十四个场景均映射到实现、自动化及真实原 Run 验收；下表列出边界。                                                                           |
| 一致性 | Proposal、design.md 和 delta spec 相对获批 ef5e47a 没有改动；保留现有兼容采纳、Guard、Journal、审批和 Evidence 权威，没有新持久格式、状态机或全局配置。 |

| 要求                           | 实现与证据                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 受管规格归档支持长路径 | platform/git/archive-git.ts、specification-checkout.ts、specification-publication.ts；真实 checkout/索引 RED-GREEN、NUL 与空格路径测试；原失败 Run 在默认设置完成 276 字符路径归档及三个真实 MR。非 Windows 条件分支保持原 argv，通用 Git 发布测试继续覆盖。 |
| 不修改宿主配置与检查契约       | 适配仅作用于受管 Git 子进程；持久 Git 配置、父环境、冻结 OID/allowlist、调用者 branch/HEAD/index 的正负例与发布中断矩阵通过；实际五仓 local/global/system 均未设置 longpaths，系统设置为 0。                                                                 |
| 路径失败沿原交付身份恢复       | 真实旧包原 Run 经公开 CLI 接续，原 Verify Input、Bundle、Binding/Plan/Check 与两包完成事实、Archive input 保留；完整发布和四个终态冷进程散列核对通过；提交/push/MR 的故障恢复沿原 Journal。                                                                  |
| 执行组合与冻结来源分离         | Coordinator 的实际 Archive 依赖闭包和既有 Guard、WorkflowRuns 进程内上下文、真实 FileDeliveryProvider；代码/config/schema/authority/前驱及过期 callback 拒绝矩阵通过；生产 Runtime→Provider→核心发布→Journal→新 Cordis 实例恢复集成通过。                    |

部分发布后的恢复同时由未改动的 Journal 身份规则、真实持久 Journal 故障测试及兼容采纳/执行入口测试支撑；合约集成的故障和冷恢复发生在 B。没有把它描述为旧 A 二进制已部分发布后升级的实测，细节见 [审查边界](../../../verification/fix-windows-default-archive-paths/review.md)。

## 正式 Build 收据

- 源输入提交：f3d3135，之后没有修改受检源码或索引。
- 精确 argv：`npm.cmd run verify`；cwd 为项目根；`VITEST_MAX_WORKERS=2`；timeout=2700000ms。
- 实际 Build Guard 返回 0，reused=false，Runtime 进入 Verify revision 28。
- inputBefore 与 inputAfter 均为 `07de804c1fb486402322c9d46c16f8a4a4a8b53389d19791b5c5bf4c1ca53dc0`。
- 原始收据日志内容摘要：`f306a5a10c91c9e556e14cfbae5684022341f5f8b31140239b01181930e517cf`。私有原始日志由 Comet 保留，不把宿主身份或 claim 放入公共报告。
- 普通完整复跑的 1109 项通过、5 项跳过、19 项规格通过及其余检查结果见 [完整验证报告](../../../verification/fix-windows-default-archive-paths/verification-report.md) 和对应 validation-history.json；正式收据单独由 Runtime 核验。

本结论提交后仍由正式 Verify Guard 执行或按相同输入、环境、命令、timeout 和原日志复用规则验证，不手写成功收据。

## 独立审查与结论

同一独立 reviewer 对产品实现、新增集成、元数据和 Evidence 增量完成唯一最终集成审查，Critical 0、Important 0；完整审查与实际测试边界见 review.md。没有用实现者自评替代独立审查。

本 Change 没有未解决的需求或设计偏差。已安装包 doctor 缺少 package-lock.json 的既有非阻断诊断问题已如实记录，未纳入本次 Archive 修复，也未宣称通过。远端 SigNoz 查询不属于本次验证；本地轨迹与组合采纳事实已核对。

原 Run 恢复已经完成。产品 PR/CI/合入及 main 后新五仓验收仍是后续步骤，不提前计为完成。用户 2026-11-08 已明确授权代理中间审批并在合入后继续验证、修复直至工作流验收通过。
