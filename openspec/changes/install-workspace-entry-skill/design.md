---
comet_change: install-workspace-entry-skill
role: technical-design
canonical_spec: openspec
---

# Workspace 入口与受管 Action 装填设计

## Context

接入事务已有候选、预检、审批、物化和完成校验。CLI 包已有固定阶段 Skill 与方法资产。Runtime 的公开 claim 响应已经包含受管层正文；当前快照会校验目录资源摘要，但执行包没有把引用文件交给宿主，例如 `codebase-design` 引用的设计参考。手动 `skill project` 的目标是导出有效目录；该目录与当前 Action 的授权范围不同。

## Goals / Non-Goals

入口的安装和发现属于宿主适配；Change 的阶段、可执行 Work、写入授权、人工门禁和证据接受沿用 Runtime。保持一套 Skill 组合和同一 Run。入口遵循用户的明确调用，不接管普通对话，不引入常驻进程。

## Decisions

### 1. Workspace 接入安装入口，安装计划随原审批冻结

参考 [Comet 0.5.1 的项目级安装](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/skill/platform-install.ts)。入口资产和生命周期 Skill 随同一个 CLI 包发布，入口资产独立于生命周期 Provider 的扫描根。接入默认预览 Codex 和 OpenCode 两个现有项目目标，分别位于 `.agents/skills/repoctopus/` 和 `.opencode/skills/repoctopus/`；允许在探测时明确缩小宿主集合，不从机器上的 IDE 安装情况猜测团队需求。两个目标使用同一份入口正文。Codex 使用宿主显式 Skill 调用；OpenCode 允许用户显式要求使用该 Skill，由其原生 `skill` 工具加载；本次无需另外维护斜杠命令包装器。参见 [OpenCode Skill 发现与加载](https://opencode.ai/docs/skills/)。

`project detect` 提供预览，`project prepare` 重新核对目标，`project review` 展示宿主、相对路径及新增、更新或冲突。准备的请求冻结目标、待装内容摘要与各目标前态，并纳入现有 `snapshotDigest`。审批后只应用该计划，包资产与批准摘要不一致时提示重新准备；旧请求不能隐式授权新增安装。宿主选择和安装事实不额外进入业务配置或 Run 的组合身份；安装文件仍按现有 Git 和 Evidence 输入规则分类，入口文件更新不豁免既有证据失效检查。项目配置领域保留候选与批准，平台层处理目标路径、内容与恢复，Cordis 组装服务，Engine 不依赖宿主布局。

### 2. 只管理入口，所有权可随 Workspace 提交

入口目录用可提交的、版本化的 Repoctopus 所有权标记记录相对文件与内容摘要。新的 checkout 可以核对所有权；本机接入日志不作为跨机器所有权依据。只有缺失的目标或经标记证明仍为受管原内容的文件可以安装或更新；不可从文件同名或内容碰巧相同推定所有权。标记只在预定目录中有效，路径、符号链接、非普通文件、意外文件及前态变化在写入前检查。

复用安全写入工具与接入状态。首次写入前先保存原请求进入 applying；续接只接受批准的原前态，或同一请求已写出的目标内容，其他情况报告冲突。全部入口写完并复核后，才允许本次接入发布配置并完成。完成请求的重放不做新写入。已有团队通过重新接入补齐；原 Store、业务仓指向和 Run 保留。手动全目录投影仍是独立功能，不收编或清理接入受管入口；仅复用宿主路径映射与适用的文件工具。回退只处理确认未修改且属本次安装的入口文件。

### 3. 公开 claim 响应驱动当前 Action 装填

参考 [Comet Classic 的 continuation 消费方式](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/assets/skills/comet-classic/SKILL.md)。宿主从 Workspace 进入，通过现有 `run start` 或 `run resume` 取得同一 Run，再按公开 continuation 处理。收到 `execute` 才领取对应的当前受管 Work；Runtime 管理的动作仍通过 Runtime 原入口执行。人工等待使用已有的原生宿主提问与决定回传；待核对或待纠正走原 Work 恢复，`done` 停止。入口不把状态标签当作可以执行的 Action，也不代替用户批准。

宿主以当前受信任的 Runner 身份及实际可用能力领取。入口使用稳定、绑定当前 Workspace、Run 和当前调用方的 Runner 标识，经现有 `--runner` 跨 CLI 进程复用，不用临时 PID；Build Configure 已冻结其他身份或能力时，走 Runtime 返回的恢复或重绑定路径，不复制其他执行者的身份来通过校验。只有 `executionAcquired: true` 才授权本次宿主执行；未取得执行权时按返回的恢复事实处理。

宿主用 `run work-claim --json` 取得公开执行包，按 `packet.context.layers` 顺序实际加载正文。对新 claim，Runtime 从同一次精确 Provider 解析中取得正文与目录资源，在持久化 claim、标记交付或启动 Host 前校验并组装。资源按 Skill 层和相对路径编入同一个冻结包，可读文本或明确编码的字节纳入该包身份；校验现有资源集合摘要，动态加入的诊断层也在首次交付时冻结资源身份。拒绝越界、符号链接、缺失和漂移，并限制资源总量；资源内容不作为遥测字段，也不授予执行其中脚本的能力。

既有执行包维持原身份与接受事实；重发使用已冻结的内容。只有旧包已有相应资源快照时才允许按其核验补齐；无法证明旧资源身份时报告缺口并沿原 Action 恢复，不能为旧包追记新内容。Outcome 仍使用现有 packet、invocation、Host 身份和实际装填的 Skill layer digest，不另建消费回执。入口不查全局同名 Skill、不读私有状态路径，也不因交付失败创建第二个 Work。

### 4. 验收从真实宿主发起

用实际 CLI 安装包在产品源码外获批接入，在真实宿主新会话确认入口来自 Workspace 并显式调用。沿同一 Run 观察 Open 的正文、人工等待及冷恢复后的 Design 正文和资源读取；用现有受管回执、轨迹与 `skill.consumed` 遥测对应到各 claim。在 Configure 冻结后再启动进程，验证稳定 Runner 可领取下一 Work，并覆盖 Build 代表性的资源引用与诊断层；对 OpenCode 至少实测原生 Skill 工具发现并加载入口。用契约测试覆盖完整 continuation 分支以及安装中断、冲突、单仓和多仓隔离。实际宿主记录用来核对是否读取了正文和资源，遥测消费声明不证明 Agent 完全遵守了方法。证据进入 Evidence 和正式 Verify 报告。

## Risks / Trade-offs

- 宿主可能缓存 Skill 或优先解析同名项目外定义。验收使用新会话并核对加载来源，文档说明用户可观察的恢复路径。
- 冷恢复时 Provider 资源可能已变化。沿现有冻结身份检查并报告明确差异，不能以新内容替代；旧执行包与消费记录不改写。
- 路径规划后可能发生并发修改。沿用安全写前重验，不对团队文件进行强制覆盖；明确区分中断续写和未经批准的写入。
- 规划产物、现有规格、公开 CLI 契约或宿主实际行为存在实质冲突时停止对应工作，先核对或经批准调整。

## Migration Plan

新 Workspace 随获批接入安装；已有 Workspace 通过原接入流程获批补齐。公开 CLI 仍可独立使用，既有 Run 无需为安装入口重建。为已签发包保留原身份，补齐资源时核对该包已经绑定的 Skill 快照。
