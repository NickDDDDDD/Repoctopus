---
comet_change: resolve-duplicate-repository-checkouts
role: technical-design
canonical_spec: openspec
---

# Design

## Context

多仓接入的 Git 探测会排除所有重复身份。接入层只从剩余仓库生成逻辑 ID，因此无法用参数恢复被排除的 checkout。Windows 公共 CLI 已复现该路径。

## Goals / Non-Goals

- 保留首次接入的轻量流程，在生成正式候选前解释并解决同远端 checkout 歧义。
- 将选中的 Git 根和当前远端事实绑定到现有审批。沿用 OpenSpec Store、Verify Profile 配置与 Runtime 仓库身份。

## Decisions

### 单独报告冲突路径

Git 适配器规范化并校验扫描范围内的 Git 根，按已有仓库身份分组。普通快照维持唯一身份，只有接入探测需要额外候选事实。同一真实路径的别名去重。无远端仓库继续按已有规则标识。

Comet Classic 0.5.1 的 workspace prepare / resolve 分别核对 Git 登记、分支和路径。Repoctopus 沿用这种分别观察的原则，增加接入场景需要的同远端候选组。

### 让用户选中实际目录

接入 Service 在草稿中返回规范化 checkout 路径和可执行的解决方式。保留 `--repositories` 的逻辑 ID 筛选，新增可重复 `--checkout <path>`。路径支持绝对路径或相对于 Workspace 的路径，必须匹配当次扫描中通过校验的 Git 根。CLI 需正确处理引号包裹的路径。Init Skill 通过同一诊断收集真实选择，先解决歧义，再走现有接入审批。

已有 Workspace 中仍有效的登记路径保留原仓库 ID。当次扫描无法核对登记时报告实际路径和恢复动作。首次接入中，属于所选范围的冲突必须解决。显式限定仓库范围可排除其他组。候选和 `project prepare` 使用相同边界，避免通过直接编辑草稿或候选跳过选择。

自动按目录名或 HEAD 决定写入对象会受到扫描及版本偶然性影响。每份克隆独立登记会使交付与恢复身份产生歧义。只在需要时收集路径，常见单仓与无冲突多仓继续使用原接入命令。

### 冻结后再复核

审批摘要绑定规范化 Git 根和已选仓库远端事实。沿用 `assertDetectedRepositoryScope` 的 Git 观测，在准备、批准和恢复时核对同一目标。对未批准或已变化的路径不执行配置。Store 仍由现有逐仓事务和回执负责，Cordis Service 维持公开接口，Engine 消费最终已批准的 Workspace 配置。

## Risks / Trade-offs

- 目录可能在审批期间被移动或替换。校验请求内路径与远端身份，无法证明原目标时引导重新探测。保持中断恢复与已完成回执的语义。
- 采用同一组诊断和选择解析覆盖 CLI 与 Init Skill，Windows 实包验证包括路径含空格、排除冲突组、非选中仓无写入、登记复用和身份漂移拦截。
- 遥测不增加报送路径或远端凭据的字段。实际测试与回归结果进入 Verify 报告。遇到权威资料冲突时停在当前阶段，经过现有决议渠道处理。
