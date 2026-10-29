# Spec Delta

## MODIFIED Requirements

### Requirement: Windows 开发 Run 自动激活单实例桌面应用

Repoctopus MUST 在受支持的 Windows 环境创建或恢复开发 Change Run 并取得权威 Workspace、change 与 Run 身份后，由 Runtime 的生产用例启动或激活一个桌面应用实例并交付该上下文；源码自举和已安装产品的正常路径不得要求用户手工配置可执行文件，同一用户会话不得因并发 Run 启动重复 Electron Shell、有效 Desktop Host 或接收器。桌面激活失败不得改变 Change Run 的权威结果，但 MUST 返回明确诊断并形成有界观测事实。

#### Scenario: 首个开发 Run 启动

- **WHEN** 受支持的 Windows 用户会话中没有运行桌面应用且开发 Change Run 开始
- **THEN** Runtime 通过当前安装或源码 Product Root 的受控入口启动桌面应用，显示该 Run 所属 change，并返回 started 诊断

#### Scenario: 第二个 change 开始运行

- **WHEN** 桌面应用已经运行、receiver discovery 通过同用户与进程身份校验，且另一个开发 Change Run 开始
- **THEN** 操作系统接受单实例转交请求并返回 activated 诊断，既有 Shell 把新的 Workspace、change 与 Run 上下文交给当前 Desktop Host 并聚焦该 change，且不创建第二个有效 Host 或接收器

#### Scenario: 启动结果不冒充界面就绪

- **WHEN** Launcher 返回 started 或 activated
- **THEN** 该结果只证明请求前的安全 discovery 分类和操作系统已接受请求，不得被解释为 Renderer 已绘制、窗口已聚焦或 Desktop Host 已 ready

#### Scenario: 源码自举启动

- **WHEN** 维护者已用标准构建命令生成当前 Product Root 的 CLI 与 Desktop artifact 后启动 Repoctopus 自身 Change Run
- **THEN** Launcher 自动解析固定 Electron 与桌面入口，无需 `REPOCTOPUS_DESKTOP_EXECUTABLE` 或本机绝对路径配置

#### Scenario: Windows 桌面入口不可用

- **WHEN** 安装协议、显式覆盖和源码启动目标均不可用或操作系统拒绝启动请求
- **THEN** Change Run 仍成功创建或恢复，调用方收到不含路径和命令正文的 unavailable warning，远端 OTLP 投递继续运行

#### Scenario: 安装协议使用受控系统入口

- **WHEN** Launcher 选择已安装协议目标
- **THEN** 它只用经过校验的绝对 SystemRoot Explorer 路径和独立 URL 参数调用 Windows，拒绝裸 executable、当前目录、PATH 搜索、shell 字符串或缺失的受控系统文件

#### Scenario: 安装验收穿过真实协议 handler

- **WHEN** Windows 安装 E2E 向已登记的 `repoctopus://` URL 交付第二个 Change Run 上下文
- **THEN** 请求经 Explorer、当前用户 registry handler、产品 executable 和 single-instance owner 到达既有 Shell；直接把 URL 参数传给产品 executable 不得计为该场景通过

#### Scenario: 公共 CLI 在无 handler 时继续

- **WHEN** 进程级 public CLI 在没有源码 Desktop artifact、显式覆盖和已安装协议 handler 的隔离环境创建 Change Run
- **THEN** CLI 返回 `desktop.activation.unavailable`，权威 Run 仍被持久化且远端 OTLP 继续接收同一 Run 的观测事实

#### Scenario: 未正式支持的平台启动 Run

- **WHEN** 用户在未正式支持的平台开始开发 Change Run
- **THEN** Runtime 保持可用并返回明确的 unsupported warning，不尝试启动桌面进程且不把该平台报告为受支持
