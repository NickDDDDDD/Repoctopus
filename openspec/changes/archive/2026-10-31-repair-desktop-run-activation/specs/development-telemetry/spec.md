# Spec Delta

## ADDED Requirements

### Requirement: 桌面激活结果形成有界观测事实

Repoctopus MUST 在 Change Run 权威事实持久化后记录版本化 Desktop activation 事件，并只输出 Workspace、change、Run、目标类别、`started | activated | unavailable | unsupported` 结果、固定 reason 和时间；不得记录 executable、命令行、安装路径、协议 payload、环境变量值或自由文本错误正文。

#### Scenario: 桌面激活请求被接受

- **WHEN** 操作系统接受首次启动或单实例转交请求
- **THEN** Trajectory 与本地/远端 OTLP 使用相同事件身份和结果类别，重复导出不产生第二个逻辑激活事实

#### Scenario: 桌面激活不可用

- **WHEN** Launcher 无法解析目标或启动请求失败
- **THEN** 遥测记录固定 unavailable reason 且远端目的地继续独立投递，不把本地观测损失解释为 Change Run 失败
