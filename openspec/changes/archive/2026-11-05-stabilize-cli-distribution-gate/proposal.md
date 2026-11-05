# Proposal

## Why

Repoctopus 的源码 checkout 会把 `dist/` 作为本地构建产物忽略，但当前仓库没有在 pull request 与 `main` push 上执行完整验证；开发者也可能在更新源码后误用历史 `dist`，让验收实际运行旧 Runtime。现在需要把“干净环境验证当前源码”和“源码运行前显式构建”变成可审计的产品分发契约，而不是依赖操作者记忆。

## What Changes

- 建立 `product-distribution` 能力，明确源码 checkout、生成产物和安装包之间的权威边界。
- 增加面向 pull request、`main` push 和人工触发的 GitHub CI，在干净 checkout 中使用受支持的 Node 版本安装固定依赖并运行仓库完整验证。
- 让 CI 直接复用仓库已有的 `npm run verify`，保持本地与托管验证只有一套命令权威，并通过失败状态阻止把未验证源码描述为可交付。
- 固化源码自举与多仓验收的执行来源：多仓验收默认从当前源码构建 tarball 并在隔离消费者环境安装后运行；只有明确需要源码入口时，才先从当前 checkout 重新构建并通过 freshness preflight，再启动源码 CLI。历史或缺失的本地 `dist` 不构成当前源码的验证证据。
- 增加对 CI 工作流、package-first 验收和源码构建边界的自动化回归检查，并更新自举文档中的验收顺序。
- 不提交 `dist/`，不让 launcher 隐式重编译源码，不改变 npm 安装包的公共 CLI 参数或 Runtime 协议。

## Capabilities

### New Capabilities

- `product-distribution`: 定义干净 checkout 的持续验证、源码构建产物的权威边界以及安装包/源码验收的可复现要求。

### Modified Capabilities

无。

## Impact

- 影响 `.github/workflows/`、构建/仓库契约测试、自举与开发验证文档。
- 复用现有 npm lockfile、构建脚本、测试和 OpenSpec 校验，不增加生产依赖，不改变 Runtime 架构。
- 参考 Comet 0.5.1 的“忽略 `dist`、源码显式构建、PR/main CI 强制验证”做法；不复制 Comet 源码，因此不新增第三方许可证义务。
- 本次垂直切片只建立 GitHub 上的仓库验证门禁与源码验收契约；服务端 required-check 配置、其他代码托管平台流水线和自动发布版本留给后续独立 change。
