# Desktop Dashboard

Repoctopus Desktop Dashboard 是 Windows x64 上的本地工作流观测界面。它与团队 SigNoZ 消费同一套标准 OTLP envelope，但用途不同：Desktop 聚焦当前 change 的即时状态，SigNoZ 用于团队历史、趋势和流程改进。Desktop 不查询 SigNoZ，也不扫描 Workspace、Git 或 OpenSpec 文件补造状态。

当前 change 的投影除五阶段、Work、Skill、Wait 和 Evidence 外，还直接消费 packet recovery 与 Specification Provider 观测：四类工件分别显示 `ready | skipped | missing`，验证显示最高严重级与 contract-conflict。`skipped` 是 Provider 明确证明的满足状态，不显示为缺失或错误；这些事实与 SigNoZ 来自同一个持久 Trajectory envelope。

## 状态含义

界面只显示 Receiver 已接受的权威事实。缺少事实时显示“尚未上报”，而不是根据阶段顺序或文案猜测。

| 状态                    | 含义                                  | 用户应如何判断                                 |
| ----------------------- | ------------------------------------- | ---------------------------------------------- |
| 实时 `live`             | 已接收连续的最新序列                  | 可以按当前投影观察执行                         |
| 追平 `catching-up`      | 本地目的地正在重放保留期内的 envelope | 等待追平；远端遥测不受影响                     |
| 过期 `stale`            | 最后观测超过新鲜度窗口                | 检查 Run、Desktop Host 或本地目的地            |
| 缺口 `gap`              | 序列中存在明确缺失                    | 不把缺失区间解释为成功；等待重放或查看健康原因 |
| 尚未上报 `not-reported` | 对应事实从未到达                      | 这是未知，不等于未执行或失败                   |

Dashboard 分别展示五阶段、Build 的五个 action、当前 Work、Skill 装填/消费、Evidence、Human Decision 和四类可解释健康。四类健康不合成总分。

## 本地接收与安全边界

Desktop Host 在 `127.0.0.1` 的随机端口接收 OTLP/HTTP，并为每次 Host 启动生成新的高熵 Bearer token。用户级 discovery 记录只在验证以下条件后才可使用：

- 文件由当前 Windows 用户拥有，且 ACL 收紧到该用户；
- 记录处于 freshness 窗口内；
- PID 的进程创建身份仍与发布者一致；
- 回环监听端口仍由该 PID 拥有；若 Windows 网络 compartment 隐藏端口表，Receiver 必须用短期 token 证明同一 PID。

伪造、过期、进程复用、端口劫持或错误凭据都会 fail closed。Renderer 启用 sandbox 与 `contextIsolation`，关闭 Node integration，使用封闭 CSP；Preload 只公开固定的版本化 IPC allowlist。Cordis composition、Receiver 与 Projection 只存在于独立 Desktop Host，不在 Electron Main 或 Renderer 中运行。

## 关闭行为

首次关闭默认询问。用户可以选择本次操作并记住以下偏好：

- `quit`：停止 Receiver 与 Desktop Host 后完全退出；
- `tray`：隐藏窗口，Receiver 继续工作，可由托盘重新打开；
- `ask`：每次询问，不在后台静默驻留。

托盘的“完全退出”和 Windows 会话结束始终走完整关闭路径，不受已保存偏好影响。设置保存在 Electron 的用户级数据目录，不写入 Workspace。

## 恢复、压缩与保留

Host 先将允许列表内的 envelope 追加到本地 journal，再发布新的 snapshot/delta。启动时先验证原子 snapshot 的 checksum，再重放有效 journal 记录；重复 envelope ID 收敛为 no-op。单条损坏记录会产生本地诊断，同时继续恢复其他有效记录，不会把损坏数据投影为成功。

默认在 journal 达到 1,000 条或 4 MiB 时生成原子 snapshot 并压缩 journal。snapshot 与 journal 位于 Electron 用户级数据目录；它们不包含 Prompt、命令输出、Artifact 正文、凭据或 Workspace 绝对路径。卸载或显式清理可以删除这些本地投影数据；普通代码回滚不会隐式删除用户数据。

桌面关闭不会阻塞工作流，也不会推进或重置远端 SigNoZ 的 cursor。本地目的地恢复后从自己的 cursor 追平；超过上游保留上限时显示明确 gap，而不是伪造连续历史。

## 故障检查

1. 确认托盘中是否已有 Repoctopus，避免把隐藏窗口误判为退出。
2. 从界面查看 Receiver、遥测和 sequence gap 的健康原因。
3. 重新启动 Desktop；旧 discovery 会在 Host 退出时删除，新 Host 使用新端口和 token。
4. 若 snapshot 或 journal 损坏，保留诊断后可清理本地投影目录并由仍在保留期内的 envelope 重建。

首个正式支持范围是 Windows 10/11 x64。macOS、Linux 和 Windows ARM64 在本 change 中不承诺安装、托盘或生命周期支持。

源码与安装态启动步骤见[启动或恢复 Desktop Dashboard](desktop-activation.md)。
