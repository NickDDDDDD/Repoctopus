---
comet_change: fix-packaged-doctor-provenance
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-09-fix-packaged-doctor-provenance
status: final
---

# Design

## Context

问题与边界见 proposal。现有运行时 `platform/provenance/check.ts` 与开发脚本 `scripts/check-provenance.mjs` 同时检查开发 lockfile 和准备脚本；运行时经 maintenance Contributor 在 `doctor` 中执行。npm 不分发根 package-lock，CLI 生产安装也不提供 Electron 开发资源。已有来源单元 fixture 主动复制开发文件，包 E2E 未调用 doctor，形成覆盖缺口。

## Goals / Non-Goals

**Goals:** 使用同一份已分发第三方来源清单完成安装后审计；保留源代码 CI 的完整约束；通过公共 CLI 证明健康成功、实际损坏失败以及诊断只读。

**Non-Goals:** 不引入新 manifest/schema、诊断模式开关、Comet SDK、依赖升级或持久 Run migration；不为用户安装开发依赖，不把诊断改成自动修复。

## Decisions

1. 保留现有 `checkProvenance` 运行时接口和 Cordis Contributor 装配。其受保护源码、Cordis/Matt 快照摘要、许可证及上游固定身份检查继续有效；将 DSH 开发锁检查改为产品声明与实际可解析的生产包 package.json 身份检查，缺失/解析失败/版本不符返回诊断。生产依赖解析从产品 package.json 建立 Node resolver，适配 npm 嵌套安装与当前 vendored workspace。禁止依赖声明继续校验；完整传递锁图的禁止依赖审计由开发 CI 保持。
2. 开发脚本继续拥有 lockfile/integrity、开发依赖和准备脚本检查。运行时不探测 lockfile 是否存在后切换模式：同一诊断在源码及安装环境使用同一语义，不因偶然文件改变检查强度。
3. 不分发锁文件副本或开发准备脚本。既有已发布来源清单足够承载预期身份；不引入第二份可漂移的来源权威。备选“只把读取错误忽略”会漏掉真损坏，拒绝；“改名复制整份 lockfile”增加开发依赖负担并仍不能证明实际安装事实，拒绝。
4. 单元测试使用真实来源资源与生产依赖 manifest 的最小消费 fixture，不为运行时补开发文件；先观察无开发资源失败，再修复。开发脚本另做版本/integrity/准备脚本缺失反例，证明职责分离没有减少 CI 约束。
5. 扩展现有实际 package E2E：只安装生产依赖，以安装后的 bin 对真实 Run 调用 doctor；断言开发资源缺席、健康成功、损坏必需资源失败、恢复资源后成功。比较诊断前后 Run/Checkpoint/Trajectory 原始字节。负例只修改临时消费者，finally 恢复，不动产品快照。
6. 参考固定 Comet 0.5.1 的 `domains/skill/platform-install.ts` manifest 资源检查及 `scripts/release/package-e2e.mjs` 安装后 doctor 验收，仅借鉴职责与消费式验证，保持本项目 Engine、Service 与平台适配器边界。工作流阶段、长任务恢复、Evidence 与 OpenTelemetry 行为不变，通过来源/CLI/真实包回归核对。

## Risks / Trade-offs

- 安装环境依赖布局不同 → 使用 Node 的产品根解析，不假定消费者 cwd 或全局安装目录。
- 错误被降级成健康 → 资源损坏与依赖缺失/漂移都做失败反例；不得返回虚构成功。
- 开发审计弱化 → 保留原 CI 脚本及反例，标准 verify 仍执行完整来源审计。
- 来源 fixture 与真实 npm 包不一致 → 同时执行现有 tarball 生产安装 E2E，不只测试手工 fixture。
- 规格、来源权威冲突 → 停止并报告，不改第三方受保护快照来迎合新结果。

## Migration Plan

无状态迁移。重新构建 CLI 后由正常 tarball 分发替换实现；回退使用旧版本包，不重写已有 Run 或来源清单。
