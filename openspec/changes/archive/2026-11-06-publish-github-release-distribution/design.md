---
comet_change: publish-github-release-distribution
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-06-publish-github-release-distribution
status: final
---

# Design

## Context

现有 CI 从干净 checkout 运行 `npm run verify`。CLI 打包与隔离消费验收、Windows NSIS 打包与安装验收均有现成入口。工作区外的 Windows 空 npm 缓存已用本地 `.tgz` 验证 `npx` 能启动 CLI。发布后的固定 URL 需要用实际资产复验。

## Goals / Non-Goals

- 复用现有 CI、打包和验收入口，使提交、候选资产和公开 Release 可以相互核对。
- 将发布留在 GitHub Actions 及代码托管交付层。CLI、Cordis composition、Change 生命周期、多仓状态和 OTLP 沿用已有契约。
- 首版提供 GitHub Releases 渠道。Registry、签名和自动更新留给后续切片。

## Decisions

1. **来源门禁。** 手动派发官方仓库 `main` 上的单个 Release workflow。Prepare 接受完整 commit SHA 和 Tag，确认目标在远端 `main` 历史上，并核对 `ci.yml` 的 `main` push Run、同一 `head_sha` 和成功的 `verify`。以被打包提交的 `package.json` 版本推导 Tag 与资产名。遇到不匹配或平台查询错误即停止。
2. **候选构建。** Windows x64 只读作业从该 SHA 干净检出。复用当前构建与桌面包校验，消除 Windows 检查脚本里的 `0.1.0` 硬编码。只生成一份 CLI tarball，让现有包协议验收可接收它，在外部临时目录验证本地路径的空缓存 `npx`。桌面用实际候选 EXE 做安装、激活、卸载验证，并核对安装验收回执里的摘要。
3. **工件传递。** 发布目录固定为 CLI 包、桌面包和 `SHA256SUMS`。内部候选记录另外保留目标 SHA、Tag、CI Run、候选 Run 和文件摘要。写权限作业从同一次候选 Run 下载工件并重新复算，后续重试按 Run 与工件 ID 取回已验证字节。候选过期或缺失则停止。NSIS 重建可能产生不同字节，不能替代已上传候选。
4. **Prepare 草稿。** 写权限只给草稿和公开操作。读取现有 Tag 与同名 Release，确认 Tag 解引用到精确目标，或未建 Tag 的草稿保留精确目标 SHA。核对现有资产集合及摘要后，只有匹配的草稿允许续传缺少的文件。上传后再次读取远端状态，确认三份资产已完整。出现冲突、额外资产或上传状态未知时保留原件并停止。公开版完全匹配时只返回已有结果。
5. **Publish 独立操作。** 维护者提供目标 SHA、Tag 和成功 Prepare 的候选 Run/工件身份，显式派发同一 workflow 的 Publish 操作。该操作确认 Prepare 来源、草稿目标和三个远端资产的精确字节，再公开为预发布并核对 Tag。发布准备和公开串行处理，同一版本的重试不覆盖已有 Tag 或资产。
6. **公开下载复验。** 使用固定 Tag 的匿名下载 URL 核对发布资产摘要，并在隔离目录用空缓存 `npx` 执行帮助及稳定 CLI JSON 命令。README 提供该版本的 URL 和可选看板下载，安装指南保留本地包方式，并说明首版未公开或公网下载不可达时的操作。

## Risks / Trade-offs

- 手工在本机打包并上传缺少统一的候选来源和持续验证。每次 merge 自动发布会把正常集成和版本晋升合在一起。采用一个手动 workflow 的 Prepare 和 Publish 操作，复用 GitHub 的草稿与工件。
- Draft 在公开前允许修改。公开入口按原 Prepare 工件重新核对平台的三个资产，包括校验文件本身。发布后的异常通过复查和版本记录处理，后续修正使用新 Tag。
- Windows 完整桌面验收依赖实际的运行环境。候选作业必须拿到真实安装回执，失败时保留证据并禁止公开。
- 涉及源文件的改动仍沿用现有完整 CI 与包摘要门禁。实施和验收由 OpenSpec 的九项任务跟踪。

## Migration Plan

1. 合入发布能力和指南，等待目标 `main` 提交的完整 CI 成功。
2. 从该 SHA 生成 `v0.1.0` 候选，验证资产并生成草稿。
3. 从成功 Prepare 的工件运行 Publish，公开预发布并执行下载复验。
4. 候选阶段失败时保留独立目录安装路径和原有公开资产。公开后需要更正时使用新 Tag。

## 参考

- [GitHub Actions workflow run API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)
- [GitHub Release asset API](https://docs.github.com/en/rest/releases/assets)
- [GitHub CLI Release 命令](https://cli.github.com/manual/gh_release_create)
