# Comet Design Handoff

- Change: fix-windows-cli-package-junctions
- Phase: design
- Mode: compact
- Context hash: bfa3c10ad615dc3431b104df87a16ff386e11a8b0ed626f0e2d81ed02eebc236

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-windows-cli-package-junctions/proposal.md

- Source: openspec/changes/fix-windows-cli-package-junctions/proposal.md
- Lines: 1-21
- SHA256: 16552d235630720277c22a76a2247bacf4b888d1e192cd69f9f4e857ab2905ca

```md
# Proposal

## Why

CodeBuddy CN IDE 在 Windows 上执行直接安装的 Repoctopus 发布包时，无法访问 npm 为本地 Cordis 依赖创建的目录链接，CLI 在接入流程之前即启动失败。普通终端能启动同一安装，现有验证因此漏掉了这个故障。

## What Changes

- 使用已核对的官方 npm 精确版本安装 Cordis Core 和 Loader。
- 在实际安装包测试中检查 CLI 使用的两个依赖都是普通目录。
- 将发布 npx 烟测的 Git 仓置于扫描根之下，覆盖实际 `project detect` 入口。

## Capabilities

### Modified Capabilities

- `product-distribution` 明确发布包的 Cordis 依赖安装约束和 Windows 消费验收。

## Impact

涉及 npm 包声明、锁文件、发布烟测及安装包回归。Cordis 固定版本和来源快照继续用于来源校验。

```

## openspec/changes/fix-windows-cli-package-junctions/design.md

- Source: openspec/changes/fix-windows-cli-package-junctions/design.md
- Lines: 1-16
- SHA256: 5e5b83d51bfd1a646a4610e2fd66e5408fbb4ced291dbaddfa41bf30d7f91b38

```md
# Design

## Context

同一 CodeBuddy CN IDE 4.12.4 的 A/B 实验中，原候选由 npm 创建两个 Cordis junction，`project detect` 退出 1。仅调整 npm 包声明的候选在同一终端返回 `ok: true`。两个 CLI bundle 的 SHA-256 相同。PowerShell 对原目录报告 `untrusted mount point`。

## Decisions

- 沿用 Comet 0.5.1 将外部依赖声明为 npm 版本的做法。将 Cordis Core 和 Loader 分别固定为 `4.0.5`、`1.0.6`，撤销这两个目录的 npm workspace 注册，刷新锁文件中的链接项。
- 核对锁文件中的版本和 npm 完整性与现有 Cordis 来源清单一致。上游官方包中记录的 60 个文件已与仓库快照逐一核对。
- 安装包验收从真实安装位置解析两个依赖的包清单，检查依赖目录类型和固定版本。另用 CodeBuddy CN IDE 的 Agent 终端执行同一份候选的公共 CLI。
- 发布烟测为临时扫描根创建一个子目录 Git 仓，再从该仓调用 `project detect`。这样用例能验证实际的多仓扫描契约。

## Verification

从干净工作区安装锁定依赖并构建，打出候选包。对候选执行生产依赖安装、全局安装、npx 及真实 CodeBuddy IDE 验证。CI 可通过包安装目录断言复现本问题。

```

## openspec/changes/fix-windows-cli-package-junctions/tasks.md

- Source: openspec/changes/fix-windows-cli-package-junctions/tasks.md
- Lines: 1-7
- SHA256: 26aa08e18255a6c09b8434eb89b8dca9b10d40e15ca701d2601bda6bc5174c88

```md
# Tasks

## 1. 修复并验证发布包

- [ ] 1.1 更新 Cordis 依赖和锁文件，并核对固定版本与来源完整性。 <!-- comet-task:6b07d7c0-b801-4050-9576-6aaa793b079c -->
- [ ] 1.2 为现有安装包回归添加依赖目录断言，修正 npx 发布烟测的扫描根。 <!-- comet-task:acfc141d-b3e8-440b-8ac8-1bb76babeff8 -->
- [ ] 1.3 打包并验证普通消费者、全局安装、npx 和真实 CodeBuddy IDE 的公共 CLI。 <!-- comet-task:543fc98b-d27e-4372-ba5a-e1f72b7f9845 -->

```

## openspec/changes/fix-windows-cli-package-junctions/.openspec.yaml

- Source: openspec/changes/fix-windows-cli-package-junctions/.openspec.yaml
- Lines: 1-2
- SHA256: 3ea192d12c1ad3d96d8e6cfd6fddb23c8be77d85611385996b685b4736c117c0

```md
schema: spec-driven
created: 2026-11-13

```

## openspec/changes/fix-windows-cli-package-junctions/specs/product-distribution/spec.md

- Source: openspec/changes/fix-windows-cli-package-junctions/specs/product-distribution/spec.md
- Lines: 1-15
- SHA256: 9e63cca0141b38a4bd9456850385916c72c231b065a4ce5a512f40ace3d54a0c

```md
## ADDED Requirements

### Requirement: 发布包安装 Cordis 到普通目录

Repoctopus 发布包 MUST 用固定的官方 npm 版本安装 Cordis Core 和 Loader。两个包的版本与完整性 MUST 与仓库的上游来源清单一致。

#### Scenario: 在 Windows 安装候选包并从受限宿主启动

- **WHEN** Windows 用户直接使用 npm 安装发布候选 `.tgz` 并在 CodeBuddy IDE 中调用 CLI
- **THEN** npm 把两个 Cordis 依赖安装为普通目录，CLI 能返回有效的公共 JSON 响应

#### Scenario: npx 在独立消费者目录运行候选包

- **WHEN** 发布检查用 npx 执行候选包的项目探测
- **THEN** 检查以包含实验 Git 仓的父目录作为扫描根，核对 CLI 成功响应

```
