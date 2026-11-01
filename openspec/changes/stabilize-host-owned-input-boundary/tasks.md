# Tasks

## 1. 建立输入所有权 red baseline

- [ ] 1.1 为当前 Git fingerprint 增加失败测试：登记 Host 文件、未知未跟踪文件、tracked 双用途文件和 external-exclusive 冲突必须得到不同结果；运行 `npx vitest run test/evidence-fingerprint.test.ts` 证明当前实现无法区分。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面, implementation-evidence#控制面输入分类必须fail-closed）
- [ ] 1.2 为 `check:architecture` 增加进程级失败测试，证明未跟踪 `.codex` 当前被误拒绝，而 tracked/packaged `.codex` 必须继续失败；运行 `npx vitest run test/architecture-governance.test.ts`。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离）
- [ ] 1.3 为 Evidence→Verification Input→Archive 重验增加纵向失败测试：Host 文件保持不变可复用，内容或策略变化必须失效；运行 `npx vitest run test/evidence-gate.test.ts test/change-lifecycle-archive.test.ts`。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate）

## 2. 实现版本化 Repository Input Policy

- [ ] 2.1 定义纯领域值对象和 schema，包含 policy/provider identity、精确规则、owner、允许类型和稳定摘要；用表驱动测试覆盖规范路径、重叠、`..`、绝对路径、大小写与枚举顺序。（Requirements: implementation-evidence#控制面输入分类必须fail-closed）
- [ ] 2.2 实现默认拒绝的 policy compiler，使具体 Host 路径由 integration Contributor 提供而 Git Adapter 不依赖品牌；运行 policy 单元测试验证未知路径始终回落为 product。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份）
- [ ] 2.3 将 policy Contributor 的稳定 id、version、代码和配置摘要纳入 composition identity；运行 composition 恢复测试验证策略漂移使用现有 migration/阻断语义。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份）

## 3. 分区并内容寻址仓库输入

- [ ] 3.1 重构 Git selection，一次稳定采集 HEAD、tree、tracked changes、unknown untracked 与 registered control-plane candidates；运行 `npx vitest run test/evidence-fingerprint.test.ts` 验证 tracked 双用途输入保持 product、external-exclusive 冲突 fail-closed。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面）
- [ ] 3.2 复用 race-safe file identity、root containment 和 symlink 校验生成规范 control-plane manifest；测试读取期间新增、删除、改型和仓库外链接全部 fail-closed。（Requirements: implementation-evidence#控制面输入分类必须fail-closed）
- [ ] 3.3 把 policy digest 与 control-plane manifest digest 加入 Repository/Evidence fingerprint schema，并在首次与最终 selection 中共同复核；验证枚举顺序不影响摘要。（Requirements: implementation-evidence#Evidence绑定完整输入指纹）
- [ ] 3.4 保持 unknown untracked、tracked modifications 和 deletions 的既有产品 dirty 语义，增加回归测试证明点目录或 Host 品牌不能自动绕过。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面）
- [ ] 3.5 为文件数量、单文件大小和 manifest 总量设置明确上限与无敏感正文诊断，运行安全边界测试验证超限时 fail-closed。（Requirements: implementation-evidence#控制面输入分类必须fail-closed）

## 4. 贯通 Evidence 与 Verification Input

- [ ] 4.1 让 EvidenceCoordinator 从当前 composition 取得已编译 policy，并对 Profile 的每个登记仓库生成 product/control-plane 联合 fingerprint；运行单仓和多仓测试。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate）
- [ ] 4.2 将新增摘要贯通 create/compare Evidence fingerprint、Receipt 复用、Bundle、Gate 与 Verification Input，运行 `npx vitest run test/evidence-gate.test.ts test/verification-input.test.ts`。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate, implementation-evidence#Evidence绑定完整输入指纹）
- [ ] 4.3 更新 Archive 冻结输入重验，验证 Host 文件不变时不会因物理存在重复要求 Verify，Host 内容变化时会走现有 stale/repair 路径。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate）
- [ ] 4.4 删除任何仅为 Host 路径搬移、临时忽略或 fingerprint 绕过而存在的实现/测试假设；确认没有第二套 lifecycle state 或特殊 Archive 分支。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate）

## 5. 修正架构治理与发布边界

- [ ] 5.1 把 legacy path 治理从物理 `lstat` 改为共享 ownership policy 下的 tracked/product/package 检查；运行架构测试验证未跟踪已登记 Host 路径可存在。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离, runtime-foundation#能力来源和旧工作流隔离可机器检查）
- [ ] 5.2 保留生产源码 marker 扫描和能力账本校验，并增加 external-exclusive tracked/staged、生产引用、package files、不安全类型及双用途 tracked 正常路径测试。（Requirements: runtime-foundation#能力来源和旧工作流隔离可机器检查）
- [ ] 5.3 登记首版最小 Host 输入规则，逐项证明 owner、执行影响和文件类型；AGENTS/Skill/Hook/lock 内容进入 manifest，未知 `.codex/**` 不自动接纳。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离）
- [ ] 5.4 运行 `npm run check:architecture` 与 `npm run test:package-e2e`，验证 Host 安装文件不进入 npm 包且产品源码不依赖 Host 路径。（Requirements: runtime-foundation#能力来源和旧工作流隔离可机器检查）

## 6. 多仓、安全与可观测诊断

- [ ] 6.1 增加多仓 E2E，验证每仓独立 policy/manifest 摘要、规范聚合顺序、repository override 和 sibling worktree 边界。（Requirements: implementation-evidence#控制面输入分类必须fail-closed）
- [ ] 6.2 增加 Windows 大小写、目录 junction/symlink、同一文件对象跨 root 和采集竞态测试，验证不读取仓库外内容。（Requirements: implementation-evidence#控制面输入分类必须fail-closed）
- [ ] 6.3 为分类冲突、策略漂移和 control-plane 漂移提供有界诊断/遥测，只上报类别与计数，不把路径、owner 自由值或内容放入 Metric label。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份）

## 7. 文档与真实自举验收

- [ ] 7.1 更新自举与 Host 集成文档，解释 product、control-plane、runtime-state、unknown 四类边界和失效规则，并移除移动 `.codex` 的 workaround。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离）
- [ ] 7.2 在真实 worktree 保持 Host Hook、Skill、Agent instructions 和 lock 原位运行 Verify→Archive 输入重验，保存 Evidence 证明没有目录搬移或临时 ignore。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate）
- [ ] 7.3 在同一验收中修改一个控制面文件并新增未知文件，确认旧 Bundle 分别因 control-plane digest 和 product dirty digest 失效；把修复后结果记录到正式验证报告。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面）
- [ ] 7.4 执行 `npm run verify`、`npm run test:package-e2e` 和完整 OpenSpec 严格校验，确认类型、Lint、构建、测试、架构、来源、包边界与规格全部通过。（Requirements: implementation-evidence#Evidence绑定完整输入指纹, runtime-foundation#能力来源和旧工作流隔离可机器检查）

## Workflow follow-up

- 在 Open 与 Design 分别取得人工审批后进入 Build。
- 验证完成并合入后归档 Change，确认主规格已包含产品/控制面输入边界。
