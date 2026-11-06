# Comet Design Handoff

- Change: fix-openspec-checkout-path-identity
- Phase: design
- Mode: compact
- Context hash: 9d1cdb27cac5ac5b73e7634eacc892cf83f88b3792dad210382eb11f354c524f

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-openspec-checkout-path-identity/proposal.md

- Source: openspec/changes/fix-openspec-checkout-path-identity/proposal.md
- Lines: 1-23
- SHA256: 4769824d6772119b4bb181953c493e27e6cb9204ed6768aa0a8d61c2dc276451

```md
# 修复 OpenSpec Store checkout 路径身份

## Why

首版 Release 的 Windows 验收从短路径访问 Workspace，OpenSpec 返回实际目录路径，Repoctopus 却把两种写法识别成不同 checkout。相同错误已用真实 OpenSpec Store 和 Windows 目录别名复现，会阻塞已登记项目的规格访问。

## What Changes

- 让项目探测、Store 登记核验和规格读取按实际 checkout 判断路径身份。Windows 短路径和其他能解析到同一目录的别名得到一致结果。
- 保留显式 Store ID、健康根和登记冲突门禁。另一个 checkout、失效路径和身份不一致仍按现有失败路径处理。
- 用真实 CLI 回归覆盖同一目录别名与不同 checkout。用新的 `main` 提交重跑首版发布的现有 Windows 验收和公开下载验证。

## Capabilities

### New Capabilities

### Modified Capabilities

- `specification-authority`：明确 Store 和 Workspace 的 checkout 一致性以实际目录为准，路径写法本身不构成身份冲突。

## Impact

影响 Repoctopus 的 OpenSpec 平台适配、接入探测和相关测试。保持现有 CLI 参数、配置 Schema、Store 注册表格式、运行流程和 Release 门禁。参考 OpenSpec 与 Comet 的路径解析做法，使用本仓已有 Node.js 文件系统接口，无第三方源码复制或许可证变更。本次交付包含修复和 `v0.1.0` 发布验证，无单独的后续切片。

```

## openspec/changes/fix-openspec-checkout-path-identity/design.md

- Source: openspec/changes/fix-openspec-checkout-path-identity/design.md
- Lines: 1-33
- SHA256: edb4ac088c4406f74178df4ecd585bc115bd06ca835d052d8d8a2fcd9b7e703c

```md
# 设计

## Context

OpenSpec 在返回健康 Store 根前解析实际目录。Repoctopus 的规格读取使用 `path.resolve` 比较字符串，接入登记使用另一套字符串比较，项目探测则将真实 Git 路径与输入的 Workspace 路径匹配。Windows 短路径可使同一个 checkout 在这些边界得到不同结论。

首轮发布在 `spec inspect` 处误报 `registered to a different checkout`。本地用真实 Store 证明，实际路径访问成功，指向同一目录的 Windows junction 重现相同诊断。

## Goals / Non-Goals

**目标**

- 在项目接入与规格读取中使用一致的实际目录身份。
- 证明 Windows 包能通过现有发布验收，同时保留另一个 checkout 和失效登记的拒绝行为。

**非目标**

- 不修改配置、注册表或持久 Run 的格式，不扩大 Store 权限。
- 不调整工作流阶段、交付策略、遥测契约或 Release 的验证门禁。

## Decisions

在平台适配层复用 Node.js 的真实路径解析。OpenSpec 自身在根解析与登记冲突检查中区分路径字符串和实际目录。Comet Classic 用真实路径检查命令调用边界，Workspace 身份在 Windows 上使用原生真实路径解析。本次采用该行为原则，保持 Repoctopus 的多仓和显式 Store 契约。

项目探测的 Workspace 匹配、Store 登记的身份核验、Specification Provider 的 Store 根检查使用同一种实际目录判断。Engine、Cordis Service 和领域规则仍通过现有接口工作。保留 Store ID、健康根、metadata 和已批准接入流程的核对。对失效登记保留诊断所需原路径，不能把无法解析的路径当作同一 checkout 的证明。

备选做法是只修改 CI 临时路径。它能规避该测试目录的路径差异，但用户通过 Windows 短路径或目录别名访问时仍会遇到同样的问题。单纯折叠 Windows 大小写也无法处理这两种别名。

## Risks / Trade-offs

- 仅在已有 checkout 的身份判断使用实际路径。不同目录仍是冲突。涉及权限的路径无法核验时停止，沿用现有错误和恢复流程。
- 核对项目接入的批准快照和已有登记在 alias 与实际路径交替调用时的表现。遇到规格、接口契约或其他权威资料冲突时先停止并报告。
- 测试以真实 CLI 和真实 OpenSpec registry 覆盖别名、另一份 checkout、无法解析路径及正常接入路径。以新的精确 `main` 提交执行 Windows Prepare，公开后验证固定 URL 和 `npx`。记录在正式验证报告和 Actions Evidence 中。

```

## openspec/changes/fix-openspec-checkout-path-identity/tasks.md

- Source: openspec/changes/fix-openspec-checkout-path-identity/tasks.md
- Lines: 1-17
- SHA256: 916ca2430e824cdcc4b59f82b6bccb24f0da0608c84b7edb84ac81b34f785429

```md
# 任务

## 1. 复现并修复规格读取

- [ ] 1.1 在实际 CLI 路径增加 OpenSpec Store 回归，先观察目录别名在修复前触发错误。 <!-- comet-task:211c6a9e-feca-48fc-976f-1b9ee1905cf0 -->
  **Acceptance:** Windows junction 或平台等价目录别名与登记根解析为同一目录。修复前，通过实际路径执行 `spec inspect` 成功，通过别名执行相同命令得到 checkout 冲突。
- [ ] 1.2 让规格读取使用实际 checkout 身份核对，并保留 Store ID 约束。 <!-- comet-task:7a3864a1-f325-456d-8e2f-e0eef46967c1 -->
  **Acceptance:** 通过目录别名执行 `spec inspect` 与 `spec validate` 成功。将相同 Store ID 指到另一个真实 checkout 或失效根时拒绝访问且不回退。

## 2. 接入路径与发布验收

- [ ] 2.1 让项目探测和 Store 登记核验沿用同一实际目录身份。 <!-- comet-task:d6ac1532-bd6f-4a8f-9ef4-b447d542cb45 -->
  **Acceptance:** 从别名探测能识别 Workspace，已登记 Store 被识别为精确匹配并复用。不同 checkout 或无法确认的登记仍阻止接入，未批准的配置和 pointer 保持不变。
- [ ] 2.2 从精确修复提交重新打包，执行 Windows CLI 安装与隔离 `npx` 验收。 <!-- comet-task:c0fc5d42-4da7-4145-98d2-c14c0547a515 -->
  **Acceptance:** `test:package-e2e` 对预构建的 tarball 通过。`test:release-npx` 验证帮助和 JSON 协议。覆盖已有接入、登记冲突和规格测试，验证报告可复算包内容摘要。
- [ ] 2.3 按实际改动完成集成审查和发布交接。 <!-- comet-task:e71e0bf8-0229-4905-8fae-6d39efbdc777 -->
  **Acceptance:** 验证报告可关联到修复提交，审查确认没有扩大 Store 权限。交付说明明确合入后使用新的 `main` SHA 重跑 Prepare 和 Publish，外部结果保存在 Actions 记录。

```

## openspec/changes/fix-openspec-checkout-path-identity/.openspec.yaml

- Source: openspec/changes/fix-openspec-checkout-path-identity/.openspec.yaml
- Lines: 1-2
- SHA256: 9b4b840064a33a6866a0ebc375b496fbdc2387a324f6c8fb4f21b270218c0d37

```md
schema: spec-driven
created: 2026-11-06

```

## openspec/changes/fix-openspec-checkout-path-identity/specs/specification-authority/spec.md

- Source: openspec/changes/fix-openspec-checkout-path-identity/specs/specification-authority/spec.md
- Lines: 1-32
- SHA256: 75a25572430fdd8096856ade737197f20aa0586d0e022ef4c64a9b1051b61e8f

```md
# 规格权威增量

## MODIFIED Requirements

### Requirement: Workspace Store 是规划根的稳定权威

Repoctopus MUST 将当前 Workspace Repository 登记为 OpenSpec Store，并以稳定的 `storeId` 和 `workspaceRepositoryId` 标识 Specification Root。Runtime MUST 显式选择该 Store 并校验当前 Runner 的 registry、Store metadata 与 Workspace checkout 一致。接入探测、登记核验和规格读取 MUST 以可解析的实际目录校验 checkout 一致性，并对无法验证的身份拒绝继续。Runtime MUST NOT 依赖绝对路径、nearest root、default Store、Workset 或业务仓 pointer 推断权威根。单仓场景 MAY 让 Workspace、Store 与实现仓物理合一。多仓场景 MUST NOT 因此新增独立规格仓。

#### Scenario: 单仓自举使用同一个物理仓

- **WHEN** Workspace Repository 同时承载 Repoctopus 实现与 OpenSpec Store
- **THEN** Runtime 以不同 repository role 表达相同物理仓，并从显式 Store 读取唯一四类规划产物

#### Scenario: Runner 尚未登记 Store

- **WHEN** 当前 Runner 的 OpenSpec registry 没有该 `storeId` 或指向另一个 checkout
- **THEN** Runtime 阻塞受保护转换并返回可恢复的登记诊断，不回退到默认或最近的规格根

#### Scenario: 业务仓存在本地规格根

- **WHEN** 业务仓已有本地 `specs` 或 `changes`，其解析优先级会遮蔽 Store pointer
- **THEN** Runtime 将其报告为 authority conflict 并要求显式迁移，不覆盖、合并猜测或把两个根都视为权威

#### Scenario: 同一 checkout 使用不同路径写法

- **WHEN** Workspace 输入与 OpenSpec 返回路径写法不同，但两者解析到同一实际 checkout，且登记的 Store ID 与 metadata 一致
- **THEN** 项目探测识别该 Workspace，登记核验复用现有登记，规格读取和验证继续使用该显式 Store

#### Scenario: checkout 路径无法核验

- **WHEN** 受保护操作无法解析 Workspace 或已登记的 Store checkout 路径
- **THEN** Runtime 停止读取或写入该 Store，保留诊断且不覆盖现有登记或选择其他规格根

```
