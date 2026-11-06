---
change: publish-github-release-distribution
design-doc: openspec/changes/publish-github-release-distribution/design.md
base-ref: fa12a31c39e4eb3db592d746a790525be0780591
---

# GitHub Releases 实施计划

<!-- comet-task-authority: openspec/changes/publish-github-release-distribution/tasks.md -->

先跑失败用例，再补实现与相关文档。准备、公开和真实 URL 复验共享同一候选身份。发行入口保持 GitHub Actions，不引入 Runtime Provider。

## 候选构建与验收

1. **入口与只读门禁。** <!-- comet-task-ref:8c2969a5-bd33-4300-a327-8514a214105a -->
   添加 main-only 手动 Release workflow 与可独立测试的来源检查。核对完整 SHA、远端 main ancestry、版本、精确 CI push Run 与 verify job。测试失败输入及无写权限构建。
2. **一次生成候选。** <!-- comet-task-ref:b336b12d-356e-46ce-9c78-3a77b81b8bee -->
   Windows x64 作业检出目标 SHA，使用锁定依赖、现有 CLI 和 NSIS 命令。用实际目标包版本计算文件名，检查产物存在且来源一致。
3. **消费候选 CLI。** <!-- comet-task-ref:b42691b9-d66c-4799-8df6-f58027688bf2 -->
   让现有 package E2E 可接受实际 tarball，再在外部目录使用空缓存 npx 测试该 tarball。默认 CI 的自打包验收继续运行。
4. **消费候选桌面。** <!-- comet-task-ref:9aaa1d43-bb64-4e6b-aeec-5319b5443520 -->
   让已有两个 Windows 检查入口读取实际版本。安装、激活、卸载检查须使用将发布的 EXE 并产出可核对的 SHA-256。

## 发布与恢复

5. **工件身份与摘要。** <!-- comet-task-ref:3cd3ddc3-da07-4f27-911c-b7ce67f09126 -->
   制作三份公开资产及独立候选记录。按真实文件计算摘要，测试工件丢失、篡改或来源身份不符时拒绝。
6. **草稿与公开门禁。** <!-- comet-task-ref:ff5d5c96-3243-46f1-94ea-be983104d8ba -->
   写权限限发布作业。首次生成或恢复草稿均核对远端 Tag、来源和资产。另一次显式 Publish 绑定成功的 Prepare 工件并重新核对。测试部分上传、同内容重试、冲突、缺失和已发布状态。禁止覆盖已有资产。

## 文档和集成

7. **面向使用者的命令。** <!-- comet-task-ref:adb1e577-0ff1-45dc-bae4-918afedde3dd -->
   README 和安装指南以固定版本 Release URL 的 npx 为主，保留本地包路径及可选 Dashboard。执行文档相关测试与源码外消费检查。
8. **发布说明。** <!-- comet-task-ref:9c6f36f3-ef8e-47dc-a92f-ffc63111d03c -->
   文档记录 Prepare、候选复核、Publish、公开下载复验和失败恢复。用无发布权限的演练验证输入与输出关联。
9. **集成检查。** <!-- comet-task-ref:e396e92b-436d-4299-a052-4a31b1f66ff8 -->
   核对 workflow 的授权边界、完整 CI、候选资产证据与实际运行结果。独立审查后记录验收。合入后的首次真实发布按 tasks.md 的 follow-up 执行。
