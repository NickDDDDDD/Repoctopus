# Workspace 入口与受管 Action 装填设计

## Context

接入事务已有候选、预检、审批、物化和完成校验。CLI 包已有固定阶段 Skill 与方法资产。Runtime 已能在 claim 后返回冻结执行包并检查 Outcome 中的消费回执。手动 `skill project` 的目标是导出有效目录；该目录与当前 Action 的授权范围不同。

## Goals / Non-Goals

入口的安装和发现属于宿主适配；Change 的阶段、可执行 Work、写入授权、人工门禁和证据接受沿用 Runtime。保持一套 Skill 组合、一份执行包和同一 Run；不扩展工作流定义或引入常驻进程。

## Decisions

### 入口是 CLI 包随附的 Workspace 资产

参考 [Comet 0.5.1 的项目级安装](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/skill/platform-install.ts)。将入口文件与生命周期 Skill 资产分别发布在同一个 CLI 包。入口使用现有 Codex、OpenCode 项目目录约定；产品以受管安装目标为单位处理接入。目录约定与所有权校验可复用；直接调用完整目录投影会把无需预装的阶段资产暴露给宿主，也会混淆接入与手动投影的所有权，因此不作为接入实现。项目配置领域保留候选与批准边界，平台适配器负责具体路径、内容及安全写入；Cordis 继续组装这些能力，Engine 不依赖宿主目录。

### 调用入口后依照 Runtime 返回的当前 Action 装填

参考 [Comet Classic 的 continuation 消费方式](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/assets/skills/comet-classic/SKILL.md)。宿主入口通过现有公开 start/resume/next 获取当前 Run 及 continuation；可执行状态下用原 Work 的 claim 取得冻结包，再加载包内当前 Action 的 Skill 正文和所需资源。现有 Cordis Runtime Service 管理 Work 和校验，Skill Provider 解析固定组合；宿主按返回结果装填，真实读取之后才提交已有的消费回执。仅返回 Skill 名称并让宿主从本机目录查找会引入重名和版本偏差。接入不需要预装整个 Action 目录；不另建宿主专有阶段表或第二套 Runtime 证据协议。

### 验收从真实宿主发起

用实际 CLI 安装包在产品源码外进行获批接入。从真实宿主新会话发现并显式调用入口，观察同一 Run 的 Open 装填、人工等待、冷恢复后 Design 装填。覆盖单仓、多仓、同名冲突和接入中断。核对 Runtime 的 claim、包摘要、消费回执与现有 `skill.consumed` 遥测；实际宿主记录用于确认正文读取，遥测回执仅证明有界消费声明，不证明 Agent 完全遵守了方法。验收过程与结果写入 Evidence 和 Verify 报告。

## Risks / Trade-offs

- 宿主可能缓存 Skill 目录或优先解析同名全局 Skill。用新会话检验实际加载位置和正文；若宿主无法加载预期入口，按可定位的兼容性缺口处理。
- 共享 Workspace 中已有同名目录、本地修改或并发写入。沿用显式所有权与写前重验，保留现有文件并在完成前报告。
- 规划产物、现有规格、公开 CLI 契约或宿主实际行为存在实质冲突时停止对应工作，先核对或经批准调整，再实施。

## Migration Plan

新 Workspace 随获批接入安装。已有 Workspace 通过原接入流程获批补齐，无需重建 Store 或 Run。回退时只清理确认仍属 Repoctopus 且未被修改的入口资产，保留接入配置、团队文件和原有 CLI 使用路径。
