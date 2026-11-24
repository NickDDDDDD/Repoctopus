# 桌面工作流引导验证

Tested implementation commit: `4ec76f09a1137bee2a131978f423c263029f2d5a`

Package content SHA-256: `535b2d5f9285d358a4cb53001e8d47aae7594b6d93bdbbe344af47cb263f18bb`

Package files: `490`

Package content bytes: `6677230`

## Runtime 与桌面状态

五仓 Run `change-workspace-verify-autonomous-direct-66c551c981ffb470` 的实际轨迹在序列 68 接受 Design 等待，69 记录等待开始，71 接受进入 Build，73 记录等待结束。Electron 通过本地 OTLP 重放，序列 71 已撤下审批入口，序列 73 没有恢复旧入口。序列 239 接受 Archive 终态后才显示归档完成。两张 Design 截图分别使用原尺寸和实际 Electron 200% 页面缩放。

投影、Renderer、观测构造器、journal 恢复和远端遥测契约的 42 项聚焦回归通过。独立审查复现了乱序清除缺口、升级后旧快照误报终态、退役旧 checkpoint 误报阻塞和同阶段清理完成后仍受阻。修复后的回归覆盖这些边界，包括通过实际观测构造器保留 Runtime 接受的同阶段恢复状态。乱序缓冲按 Run 生效，journal 压缩与重启后仍能补齐迟到的事实。真实 Desktop 截图的检查还发现 Design 校验曾出现在 Build Check，已按阶段限制并补回归。

## 包与验证方式

最终 CLI 包 SHA-256 为 `8d834b3ef3892ee8d6f3d5e141a2278879e20d9144ef115d4eedd859cf441b5b`。返工实验使用候选 `646ccdbc019b4c28e33064a1bc96342731058694d32b9d3de3730e26fe2505cd`。随后刷新了 Comet 派生清单中的本地 Runtime 文件摘要，限制 Desktop Build 子动作的投影来源，补齐遥测字段类型与生成的文档。Comet 固定版本及上游来源身份沿用原值。

本地隔离实验使用三个 Git 仓、真实 CLI、托管 API 夹具及确定性 Host，桌面通过实际接收器消费轨迹重放。远端选择策略由现有遥测契约回归覆盖。

## Windows 实包结果

[多仓收据](verify-repair-receipt.json)覆盖初始化至归档、首包后换进程恢复、原规格 PR 创建响应丢失后的恢复，以及终态重复读取。通过后端集成检查引入一次实际失败，Runtime 以 `revise-implementation` 返回 Build，保留前端包。前端执行及机器验证各一次，后端各两次。随后通过 Verify、Archive 和发布去重检查。

[安装态回放收据](installed-guidance-evidence.json)记录同一轨迹的七个检查点。序列 64 待审，67 进入 Build 并撤下审批指引，127 显示 1/2 工作包，174 进入 Verify，196 回到 Build 并显示返工与 1/2，216 恢复进行中，325 显示归档完成。进度来自实际提交的 Runtime 事实。

实包验收还覆盖 Windows 安装、单实例激活、托盘隐藏和恢复、直接退出、卸载与实验前注册表恢复。CDP 验证了键盘可见焦点和 620 CSS 像素的高 DPI 窄窗口。复制测试使用替换的剪贴板接收端保存现有用户剪贴板，核对真实按钮产生的 Run、审批请求和交回 Agent 的文字。Renderer 在轨迹回放中发送的 HTTP 请求为零。省略了对生产 SigNoz 实例和操作系统剪贴板写入的验证。

首轮全量检查发现忽略安装脚本导致工作区缺少 Electron 二进制，以及 Runtime 摘要和生成的遥测参考需要跟随变更更新。补装了锁定 Electron 版本，刷新本地派生摘要及遥测参考，对应安装启动、provenance、生产安装和遥测文档回归均通过。原预检日志保留。
