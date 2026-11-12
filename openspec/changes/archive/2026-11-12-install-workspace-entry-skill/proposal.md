# 安装 Workspace 工作流入口 Skill

## Why

项目接入会生成本地引导，但新会话仍要自行从说明里找工作流命令；现有的手动 Skill 投影也不能把一个用户入口和 Runtime 按 Action 交付的执行 Skill 区分开。初始化后应能在宿主直接调用 Repoctopus，并在同一 Run 里由宿主装填 Runtime 返回的当前 Action Skill。

## What Changes

- 获批接入时，在 Workspace 内为支持的宿主安装一个名为 `repoctopus` 的入口 Skill。首次接入和已接入团队补齐沿用现有项目接入路径，保留团队文件和可恢复的写入边界。
- 用户在宿主调用入口后，可以按明确意图启动 Change 或恢复已有 Run。Runtime 决定下一步；宿主在可执行响应中加载当前 Action 的真实 Skill 正文、所需资源和固定组合，沿用当前 claim 的消费与 Outcome 校验。
- 首个可交付切片从实际 CLI 安装包和全新的 Workspace 开始，贯通宿主发现、显式调用、Open 当前 Skill 装填、人工等待及冷恢复后的 Design 装填。覆盖独立多仓 Workspace 与单仓接入。
- 本次沿用现有宿主适配边界。更多宿主、全局安装、自动接管普通对话、独立 Skill 发布和替换阶段 Action 不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`：在获批接入中预检、安装和验证 Workspace 入口 Skill，并沿用原请求恢复。
- `skill-integration`：定义宿主显式入口及从 Runtime continuation 到当前 Action 实际装填的行为，复用现有受管执行包。

## Impact

影响 CLI 包资产、接入候选与完成校验、Workspace 引导、宿主入口和公开 continuation 的消费方式。参考 Comet Classic 0.5.1 的项目级安装与按 Action 加载思路，沿用 Repoctopus 的实现和许可证；不复制上游源码、Skill 正文或增加运行依赖。
