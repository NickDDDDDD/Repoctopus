# 已完成 Run 恢复验证

- Tested implementation commit: `f22e29ff0261a376d9c8e2dc36c0235a5c901781`
- Package files: `467`
- Package content bytes: `5951541`
- Package content SHA-256: `13fad2c836df214f2baaac6c08c2ecaeb2a31455ef83f53f9e67e0f2ec5655a2`
- Tarball SHA-256: `c957d744113f2980f6a6a62f1bb6b22a11d8aabfb0ef7f99f5437fc6019bc866`

最终集成审查发现的两处边界缺陷已修复并由同一 reviewer 复核；当前 C3 单一包的全新五仓完整验收也已通过。Comet 仍在正式 verify-fail 后的 Build，等待当前输入的 Build/Verify Guard；不以旧包结果或 CI 代替正式门禁。

## 根因与采用方案

原多仓 Run 已接受 PublicationReceipt 并进入 completed，后续通用 resume 却将当前 checkout 与启动快照比较并持久化全局 reconciliation。完整 status 和 CLI envelope 又让历史诊断覆盖终态。前两次修复覆盖的是活动 Build 工作区恢复和 Evidence 输入身份，没有覆盖 completed 的完整入口链。

采用 Comet 0.5.1 固定提交 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的终态先于调度原则：`domains/engine/runtime-service.ts` 和 `domains/comet-classic/classic-current-change.ts`。本次观察的上游 master 为 `a61a2e5b4766e1ad62377dec598e402560a259b6`，这两份来源与固定版一致。来源哈希已登记并通过 provenance 检查，没有引入 Comet SDK 或修改固定依赖。

Cordis Service 在活动恢复前调用 coordinator 的可信终态读取；coordinator 核对 Run、Checkpoint、原始持久项目快照和 Trajectory，然后共享既有终态投影。历史 reconciliation 标志不清除、不迁移；它不再要求完成 Run 恢复旧 checkout。原 Journal 仍可完成原事务，原待上报遥测仍可补发，不产生新的开发工作。

## 已执行的回归与独立审查

- 初始完整状态与恢复回归实际 RED：原实现的 9 项失败、1 项通过。不是仅验证纯分类器。
- 完整性审查发现原快照丢失和反向 Run/Checkpoint 状态冲突，新增回归实际 4 项失败；修复后 9 项完整性回归通过，独立 reviewer 复跑同样通过。
- 完整 Archive publication 文件实际 34 项通过，包括两处原 Journal 中断边界、仅一次原遥测补发、真实 Git 两仓、两种 Service/CLI 新进程恢复顺序和历史诊断保留。
- 原有另外六组活动 Build/Evidence、Runtime 和未知执行恢复回归共 80 项通过。
- CLI 变异验证只在生成产物中关闭 completed 分派，使原通用路径重新执行，4 项生产 CLI 用例全部因状态变化失败；随后恢复原始产物字节，`build --check` 通过。没有回退源码制造 TDD 证据。
- 类型检查、相关 ESLint、Prettier、来源检查通过。首次完整 verify 在测试 fixture 的 JSON 类型标注处被 ESLint 阻止，该问题已修复；后续完整检查的最终结论待补。
- 新增来源同时受脚本和运行时两份登记校验；补齐运行时登记后，两组来源测试共 16 项通过。项目 composition 的固定摘要随本次 workflow/maintenance 源码身份更新，相关组装和实际 OTLP tracer 两项回归通过。
- 新 worktree 依赖最初跳过安装脚本，缺少锁定版 Electron 二进制；补齐本地测试依赖后，两项真实桌面启动回归通过，没有修改桌面产品源码。
- 早期全量尝试中 Evidence DAG 用例在并发负载下超过原 60 秒限制；停止已不覆盖最终输入的旧尝试后，同一用例重跑通过（约 40 秒），没有修改 timeout 或缓存规则。旧全量尝试不作为通过证据，正式最终完整检查仍待执行。
- 后续并发尝试中 prepared Evidence context 与接入用例超过原 30 秒限制；各自单独重跑通过（约 14 秒与 22 秒）。正式全量检查将使用 Vitest 已支持的 `VITEST_MAX_WORKERS=2`；该环境变量已加入原 Comet command policy 的环境输入，不改检查 argv、不减少用例、不放宽测试断言或时限。
- 仓库级 `format:check` 报告 172 个未改动文件的既有格式问题；与本次基线 diff 取交集为零。本次改动文件的 Prettier 检查通过，不重新格式化已封存归档。
- 独立 Build reviewer 逐任务审查 1.1–1.4、2.1，首轮复查关闭 R1/R2，无未解决 IMPORTANT。审查与实际 RED/GREEN 原始输出保存在独立审计证据目录。

## 验收要求映射

| 要求                                        | 当前证据                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| completed + 历史 reconciliation 仍返回 done | 完整 status 与 CLI 历史标志矩阵，原字段保留                                         |
| 两种恢复顺序保留完成事实                    | Service/coordinator/CLI 比较完整 Run、Checkpoint、轨迹长度及 execution/next actions |
| 持久终态不能绕过完整性                      | 最终 11 项异常场景逐一调用 status、next、resume；原项目快照及 Workflow 正文重算摘要 |
| 原中断事务可恢复，副作用不重复              | 两处 Journal 写入中断；仅补发原遥测，重复恢复不再次导出                             |
| 活动未授权与未知执行仍阻断                  | 既有 Build workspace、Evidence recovery、Work execution recovery 回归               |
| 实际 Close、发布和终态冷恢复                | 最终 C3 新五仓实际 Close、三个唯一 MR、12 次终态恢复；最终包恢复旧失败副本 4 次通过 |

## 首轮真实多仓候选 C1 / C2（历史成功）

首轮 Run 的接入、Open、Design 和初始 Plan 使用 `7e95c86d023b00ce494ed477bfb122b5e9b65cc5` 包（内容摘要 `a61bf3df4487f228a5da85ea0100504b5d29254188670e51c994cb5c51b07187`）。完整检查发现遗漏运行时来源登记后，第二候选 `d8c99f8` 只补齐两条诊断来源数据，没有修改恢复、Plan 或 Binding 代码。

第二候选安装到独立新 prefix，通过公开 resume 接续首轮 Run，保留原 Binding、Plan、check epoch 8 和同一待决定提案；没有编辑产品 Store 或重新创建 Run。首轮两个 README 工作包及后继验证使用第二候选执行。两个候选的原始包和角色分别保留，不混称为从头到尾同一个 tarball。

首轮完成包源码为 `d8c99f8690b2edb501f5b65ace66c1fc43b40fc8`，内容摘要为 `0621d6bbeb13767f70aa4e415b8a550e5e8a194675d4d8f737c729618bc43e0f`；当时验证提交 `eb019d2` 只增加测试固定摘要和报告。该首轮成功独立保留，不将它冒充当前 C3 的完整流程。

## 首轮实际终态与历史现场验证

新 Run 完成全流程后，8 个新进程分别在合法 source 和完成后的其他 checkout 上执行两种恢复顺序；每次额外读取 status，均为 completed、done/terminal、空 next actions。完整 Run、Checkpoint、Trajectory 的字节与完成事实不变，stateVersion 244、check epoch 17、10 个 Host Work、2 个验证命令均不增加。

旧 F1 的实际持久记录复制后逐文件验 SHA256，再经独立 registry 的公开 register 绑定副本。4 次 resume/next 同样完成，原 `reconciliationRequired=true` 保留，副本 Run、Checkpoint、Trajectory 摘要不变。未在原路径执行写入口，未调用副本的 Evidence、Close 或 Publish。

7 个旧 Store 的 425 文件及 10 份旧报告哈希全部不变；新五仓干净且与 upstream 同步。远端 backend #5、web-front #9、Workspace #3 均唯一、OPEN、面向 `acceptance/terminal-20261108`，head/base/OID 与实际 Receipt 完全一致；本轮没有合入实验 MR。

原始独立报告 `lab-terminal-1108/verification-report.md` 的 SHA256 为 `982071711871f05249cb9bf7b1ed00562e913eb4e340485360e8b95a0825d167`，父任务已独立复核。完整命令、实际两轴审查、归档布局、远端核对、终态矩阵与历史哈希清单均保留在同目录 evidence；不将协调器 fixture 当作这项远端证明。

## 最终审查修复与 C3 验证

同一最终 reviewer 发现 CLI 在 Service 判断终态前强制观察业务目录，以及持久 Workflow 正文未重算摘要。通过正式 verify-fail 返回 Build Plan，保留已批准配置与唯一 Change；计划仍映射原任务，不修改 Design 或规格。

新增实际 RED 4 项失败；修复后 9 个相关测试文件、141 项通过，含完整 Archive publication 的 38 项、活动恢复和 runtime 回归。reviewer 在独立临时 fixture 中复跑 2/2 通过，无未解决 Critical/Important；最终审查记录 SHA256 为 `96f366f9af12320342afcbc23f0c36891c963b45498a4554d58b3ce40e5fc0d8`。

CLI 只提交 Run 身份，由 Service 在终态之后才进行活动项目观察。未观察时省略可选 reconciliation，调用者提供的真实 snapshot 仍保留其差异；活动恢复缺失当前 snapshot 或不可读 checkout 仍拒绝。Workflow 正文使用既有 hashWorkflowDefinition 重新验证。没有新增持久 schema、迁移或恢复 Work。

当前 C3 在独立新目录从公开接入重新完成全流程，不升级首轮活动 Run。最终包的实际内容身份列于页首；旧现场和首轮成功报告继续按哈希保护。[当前 C3 CI](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42404778291) 已成功，HEAD `3866f67a4bbac90a335e5d59737482b08603a066`：199 文件、1090 项测试通过，1 文件/4 项跳过，严格规格 19 项通过，并重新构建核对相同的 13fad2c8 包内容身份。此前 `2298096` CI 仍单独作为旧候选记录；本机正式 Verify 仍待最终门禁。

### C3 实际全流程与完成事实

唯一新 Run 为 `change-agent-lab-v010-workspace-verify-terminal-final-20261108-cef0230ab48d018b`，单一最终包从接入、Open、Design、Configure、Plan、两包真实 TDD、独立两轴审查到 managed Verify、Provider Close、原生发布完整通过。新三 MR 均唯一且 OPEN：backend #6、web-front #10、Workspace #4，base 均为 `acceptance/terminal-final-20261108`。实际 Receipt 为 `sha256:b7776f946657ea539184dc8b27538cb6082a2350b4f1f9858d333d5fbf7d5c8f`。

终态 12 次新进程分别覆盖正常 source、完成后分支变化、完成后业务目录退役；每次再 status，都 done/terminal、空 nextActions、没有虚构 reconciliation。stateVersion 242、epoch 17、完整 Run/Checkpoint/Trajectory、10 个 Host Work 与 2 个实际验证命令均不变。目录经校验后暂时 rename，并在 finally 恢复，不删除业务内容。

活动 Run 的同一目录不可读负例仍在两个入口拒绝，stderr 返回正式错误 JSON，持久三元组哈希不变；恢复目录后能继续原 Plan、Binding 和首包 completion。操作者一度误从 stdout 解析预期错误，修正解析并保存 raw exit/stdout/stderr/PID，未修改产品或把解析失败记作产品成功。

最终包再次对 F1 的验证副本完成 4 次恢复，raw 历史标志 true 保留；9 个旧 Store、545 文件和 14 份报告/摘要哈希全不变，含 C2 成功现场与报告，新五仓干净且已 push。最终原始报告 `lab-terminal-final-1108/verification-report.md` SHA256 为 `57fdc6463739536b344d717b1b3428e070e725170b852bd5742cf6e9fe35c6a3`，父任务已独立读取与复核；详细远端 OID、归档布局与全过程账本另见该报告。

## 范围边界

本次只修复 completed Change Run，不扩大 failed/cancelled 的重试语义，不添加 schema、迁移、后台进程或新的恢复 Work。后续 MR 审查与远端变动继续由独立一致性审查处理。Windows Git 长路径、独立安装包 doctor 资源布局、桌面启动以及 PR Skill 正文交接不在本次功能修复范围；验证遇到失败会保留并明确报告，不把未执行或失败计为通过。
