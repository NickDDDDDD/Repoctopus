# Spec Delta

## MODIFIED Requirements

### Requirement: Windows 开发 Run 自动激活单实例桌面应用

Repoctopus MUST 在受支持的 Windows 环境创建或恢复开发 Change Run 并取得权威 Workspace、change 与 Run 身份后，由 Runtime 的生产用例启动或激活一个桌面应用实例并交付该上下文；源码自举和已安装产品的正常路径不得要求用户手工配置可执行文件，同一用户会话不得因并发 Run 启动重复 Electron Shell、有效 Desktop Host 或接收器。桌面激活失败不得改变 Change Run 的权威结果，但 MUST 返回明确诊断并形成有界观测事实。

#### Scenario: 首个开发 Run 启动

- **WHEN** 受支持的 Windows 用户会话中没有运行桌面应用且开发 Change Run 开始
- **THEN** Runtime 通过当前安装或源码 Product Root 的受控入口启动桌面应用，显示该 Run 所属 change，并返回 started 诊断

#### Scenario: 第二个 change 开始运行

- **WHEN** 桌面应用已经运行且另一个开发 Change Run 开始
- **THEN** 既有 Shell 把新的 Workspace、change 与 Run 上下文交给当前 Desktop Host 并聚焦该 change，且不创建第二个有效 Host 或接收器

#### Scenario: 源码自举启动

- **WHEN** 维护者已用标准构建命令生成当前 Product Root 的 CLI 与 Desktop artifact 后启动 Repoctopus 自身 Change Run
- **THEN** Launcher 自动解析固定 Electron 与桌面入口，无需 `REPOCTOPUS_DESKTOP_EXECUTABLE` 或本机绝对路径配置

#### Scenario: Windows 桌面入口不可用

- **WHEN** 安装协议、显式覆盖和源码启动目标均不可用或操作系统拒绝启动请求
- **THEN** Change Run 仍成功创建或恢复，调用方收到不含路径和命令正文的 unavailable warning，远端 OTLP 投递继续运行

#### Scenario: 未正式支持的平台启动 Run

- **WHEN** 用户在未正式支持的平台开始开发 Change Run
- **THEN** Runtime 保持可用并返回明确的 unsupported warning，不尝试启动桌面进程且不把该平台报告为受支持
