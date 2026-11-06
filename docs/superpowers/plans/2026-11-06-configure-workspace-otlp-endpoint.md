---
change: configure-workspace-otlp-endpoint
design-doc: openspec/changes/configure-workspace-otlp-endpoint/design.md
base-ref: 1d76ba588271d7e46db0c5d7c2ca40d9f289508d
---

# 工作区 OTLP 地址实施计划

<!-- comet-task-authority: openspec/changes/configure-workspace-otlp-endpoint/tasks.md -->

实施采用 autonomous、TDD 和 thorough 独立审查。工作区只提供远端基地址，Transport 继续采用已有环境变量和 outbox。

## 配置与投递

<!-- comet-task-ref:83fb171b-6e7b-43bd-bd07-80a42888bf93 -->

先在 `test/e2e/evidence-telemetry.e2e.test.ts` 加入写入真实 YAML 且没有远端环境变量的 CLI 场景。预期旧版报不认识 `telemetry`。用 `test/project-configuration.test.ts` 锁定合法 HTTP(S) 和不回显非法 URL，检查空值、协议、凭据、查询及片段。

<!-- comet-task-ref:cecc80c7-c2be-49ac-870a-0b93b230526e -->

在共享配置类型和解析器接受可选端点。由 Project Composition 将值注入共享 Observation Delivery，既有 Adapter 共用同一解析入口。覆盖优先级为按信号环境变量、公共环境变量、工作区地址。用 `test/observation-telemetry.test.ts` 验证覆盖；CLI 接收器核对三类信号的路径前缀。

## 文档与验收

<!-- comet-task-ref:26be8091-66d2-40cf-be04-b64728cbd3df -->

更新 `docs/telemetry.md` 和工作区示例，认证继续由环境变量设置。示例地址使用注释，避免直接复制示例时无意开启上报。

<!-- comet-task-ref:09edf430-8df9-4439-a0c5-72f56a6c7135 -->

运行独立审查、定向用例和完整 `npm.cmd run verify`。验收报告绑定实现提交和 npm 包内容摘要，Verify 前用 Git blob 对比工作区报告字节。
