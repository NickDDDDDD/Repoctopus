## Why

v0.1.4 的 Release Prepare 在 Windows 短路径安装候选包后，首次领取 Open Work 时拒绝内置 Skill 资源目录。使用本机 NTFS 短路径运行同一份安装包验收，可以复现同样的错误。

## What Changes

- 在 CLI 入口用系统提供的真实路径解析可信安装根。挂载内置 Skill 时使用实际目录名。
- 使用短路径安装候选包并运行 Windows 多仓验收，覆盖首次 Skill 领取、冷恢复和实际归档。

## Capabilities

沿用现有 Skill 资源校验和发布验收要求。

## Impact

改动限于 CLI 入口的安装根解析及其验证证据。候选包沿用 Release Prepare 的验收入口。
