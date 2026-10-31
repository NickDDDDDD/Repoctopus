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

#### Scenario: 安装产品使用标准应用定位

- **WHEN** Launcher 选择已安装产品目标
- **THEN** 它只通过绝对 `SystemRoot\System32\reg.exe` 读取当前安装 scope 的 `App Paths\Repoctopus.exe`，校验绝对路径、basename、文件可访问性和协议 handler 后，以独立 URI 参数直接启动产品；拒绝裸 executable、当前目录、PATH、Explorer、handler 命令解析和 shell wrapper

#### Scenario: 安装验收覆盖冷启动和第二实例

- **WHEN** Windows 安装 E2E 通过 Launcher 的安装态发现交付两个不同的 `repoctopus://` Change Run 上下文
- **THEN** 安装器真实登记的 `App Paths` executable 先通过冷启动 `argv` 接收首个上下文，再通过 Electron `second-instance` 把第二个上下文交给既有 Shell；协议 handler 与 App Paths 均被检查，且只存在一个有效 Host/Receiver

#### Scenario: 公共 CLI 在无 handler 时继续

- **WHEN** 进程级 public CLI 在没有源码 Desktop artifact、显式覆盖、已安装 `App Paths` 或协议 handler 的隔离环境创建 Change Run
- **THEN** CLI 返回 `desktop.activation.unavailable`，权威 Run 仍被持久化且远端 OTLP 继续接收同一 Run 的观测事实

#### Scenario: 未正式支持的平台启动 Run

- **WHEN** 用户在未正式支持的平台开始开发 Change Run
- **THEN** Runtime 保持可用并返回明确的 unsupported warning，不尝试启动桌面进程且不把该平台报告为受支持
