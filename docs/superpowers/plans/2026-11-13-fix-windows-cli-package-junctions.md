---
change: fix-windows-cli-package-junctions
design-doc: openspec/changes/fix-windows-cli-package-junctions/design.md
base-ref: 3d756bea681a4ed9b63de0ef7846080ebf0f2153
---

# 修复 Windows 安装包中的 Cordis 链接

<!-- comet-task-authority: openspec/changes/fix-windows-cli-package-junctions/tasks.md -->

- 1.1 复现旧锁文件的目录链接，固定官方版本，校验锁文件完整性并从干净目录安装。 <!-- comet-task-ref:6b07d7c0-b801-4050-9576-6aaa793b079c -->
- 1.2 在真实 npm 消费者安装后核对 Cordis 目录类型。将 npx 烟测 Git 仓放在扫描根的子目录。 <!-- comet-task-ref:acfc141d-b3e8-440b-8ac8-1bb76babeff8 -->
- 1.3 从当前实现打包，运行安装包测试、全局安装、npx 和 CodeBuddy CN IDE，记录包摘要及原生调用结果。 <!-- comet-task-ref:543fc98b-d27e-4372-ba5a-e1f72b7f9845 -->
