## Decision

CLI 根据自身模块位置找到安装根，再用 Node 的原生 realpath 解析它。Windows 上普通的同步 realpath 可能保留 NTFS 8.3 名称，异步原生 realpath 则会展开。安装根在交给内置插件前采用同一套原生解析，资源读取仍逐级核对目录与文件。

## Verification

使用同一条 Windows 多仓安装包命令和真实 NTFS 短路径复现失败、验证修复。为新包重建发布证据。完成 PR 和 main CI 后，用 Release Prepare 重走正式验收。
