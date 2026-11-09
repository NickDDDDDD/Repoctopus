# v0.1.1 设计核对

## 已确认目标与授权

- 用户已确认独立准备并发布 v0.1.1，并明确选择独立 worktree。
- Open 产物、5 项任务、autonomous + TDD + thorough 及范围内后续审批代理执行一并展示后，用户回复“批准”；当前 Agent 已在用户可见进度中按推荐方案回显该执行方式。范围外能力、降低验证要求或资产冲突仍需停止核对。
- 正式 Design 选择仍由当前 Runtime proposal/hash 保存；下述内容为已批准范围内的代理设计评估，不冒充用户逐字指定的实现。

## 已核对代码事实

- release.yml 已提供 Prepare/Publish/public-smoke，要求 main 精确提交的 push CI 成功。
- CLI_VERSION、ObservationTelemetry Resource 和 Desktop OTLP Scope 有散落的产品版本常量；插件 Catalog 与 Desktop composition 的 VERSION 是独立描述符版本。
- tsconfig 已支持 JSON module，CLI 与 Desktop Host 经 esbuild 构建；使用静态包元数据导入能在打包时内联，避免读取消费者当前目录。
- 三个旧提案与已有实验保留；这次 branch 已即时 push。个人记忆不更新。

## 候选与取舍

1. 同步多份常量：改动容易，但每次发布仍可能遗漏，不选。
2. 运行时根据 cwd 或猜测路径读取版本：会读取业务项目元数据或增加隐含 I/O，不选。
3. 平台侧共享产品版本值，静态导入本产品 package.json：改动有限、可打包、来源唯一，推荐并由当前 Agent 在授权范围内选择。

## 设计约束

- 新模块归入既有架构能力所有权；不新增 Service、协议、状态机或依赖。
- CLI/OTLP 的最终输出是版本回归边界，不能只比较两个常量；先记录旧实现失败再修复。
- 版本维护先交付 main，再运行既有 Release；Publish 完成不作为合入前 Build 复选框。
- 保留旧 Release。候选身份变化、未知副作用或冲突先查事实，禁止重建替换已经绑定的资产。
- 原 Desktop 激活偶发失败仍保留根因未明的限制；若本次再现，先保留激活事实，不凭推测打补丁。

## 本轮需要的新用户决定

当前无。设计与已批准范围一致，没有 Spec Patch；正式提案按已有代理授权通过 Runtime 保存。

## 独立审查后的范围内澄清

首次 Build 独立审查未发现 Critical/Important 代码缺陷，指出规格需区分产品默认 service.version 与现有显式 OTEL 资源覆盖。当前实现保留原覆盖顺序是正确行为；原始规格措辞将默认值写得过于绝对。此为候选方案之后发现的 Spec Patch，按已有范围内代理审批授权处理，不冒充用户逐字提出的要求。

当前 Agent 通过 revision-bound revise-design 返回正式 Design 入口，再明确“默认版本来自包、显式部署覆盖保留”。默认验收仍严格执行，补充覆盖优先级回归，不改变 Scope 的产品版本、不降低发布验证、不增加能力。Runtime 保留当前执行配置与已有实现；用新的 proposal/hash 保存修订确认后重新核对计划，不重复实施已完成代码。
