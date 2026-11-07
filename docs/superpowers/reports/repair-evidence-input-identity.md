# Evidence 输入身份验证记录

本文件是当前 Comet Change 的实际验证记录；完整集成与安装包验收完成前不作交付声明。

## 生产失败基线

2026-11-07，实施前提交 `5a92ebc` 加入真实生产组合回归，运行：

```powershell
node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'
```

103.48 秒后，在 `test/managed-change-execution.e2e.test.ts:2162` 失败。断言要求 Verify 已通过后仅提交 Runtime 任务完成复选框仍处于 Archive，实际返回 Verify。原测试存在自动再跑 Verify 的 fallback，遮盖了该问题。本次保留原业务、任务完成收据和生产 Provider，以实际 Archive prepare 结果断言。

原实验项目第一次 Attempt 指纹为 `6261a7ee9faa0ebb9af845505cbfbffbe21a5ab84bbe8666cc17f0638b18809b`，第二次为 `b147d9ceff741eb8faac0ec54c2be418047170a885bda1d95f6969e8a38ed745`。第一次已读到完成状态的 dirty 文件；提交后有效字节不变，但 HEAD/tree/dirty 表示变化。根因与未接线的依赖模型已记录在同一 Change 的 design.md。

只读复核原 Store：两个 Bundle 各有六个 `command/local`、fresh Receipt，合计执行十二次命令。第二次重复的六项为 front-release-label、backend-release-channel、backend-verify、web-front-build、web-design-build、web-plugin-build。该复核未修改原验收现场。

## 分段 TDD

- `command.inputs` 初始两个正向测试因 unknown fields: inputs 失败，其余十个非法声明测试通过；实现后十二项通过。
- 内容采集覆盖 dirty→index→commit 同字节身份、真实内容变化、显式 ignored 输入和集合读取竞态，三项通过。
- 第一段独立审查发现跨次 Tasks 投影、glob 交叠样本漏判、symlink 目标遗漏、默认 ignored 输入遗漏。修正并补充交叠与默认输入测试后，三个相关测试文件 22 项通过；一项 symlink 测试因当前 Windows 缺少创建链接权限明确跳过。
- 首次生产接线后，同一两仓场景通过原 Archive 保留 Gate/Bundle 的回归断言并完成发布，最后因原测试仍期待额外一次 `evidence.verify` 调用而失败。后续移除旧 fallback 及对应重复调用预期，不把该次运行记为全项通过。

## 分段审查与实施约束

### 实施约束：副作用使用冻结 OID

独立审查确认 Run 事务锁只能序列化 Run 写入，不能锁住外部 Git。Archive 每个 effect 前在领域 owner 的 guarded operation 中核对 Work、epoch、input、blocker 和完整 Binding；新 Closure 复核规划、证据及 publication checkpoint。SpecificationClosurePlan 固定 sourceOid，checkout 直接从该 literal OID 创建；Business push 同样使用冻结 OID，不能再次读取可前移的分支作为实际发布来源。已开始 Journal 始终恢复原计划。该约束是现有“冻结发布坐标”验收的具体实现，不增设审批或生命周期。

缓存资格还必须读取原 Bundle 的逐节点 superseded 结论；不可因源码恢复原值复活已失效 Receipt。声明输出逐 pattern 缺失时不缓存；程序 launcher 可以是符号链接，但身份绑定入口与真实目标，并在稳定读取中验证解析不变。

## 已执行的补充回归

- 新增实际 Git junction 范围回归最初失败，修正后与内容采集、冻结发布测试一起 7 项通过，1 项因 Windows 缺少文件 symlink 权限跳过。
- Store/DAG 集成实际命令计数：初次 A/B/C 共3次；新进程等价输入仍3次；A内容变化只执行A/C成为5次；删除A产物后A重采、同字节C复用成为6次。
- 生产 observer 验证显式 env 只改变声明节点；同字节Git提交仅使git:all节点变化。持久Receipt缺失规范依赖时拒绝读取。
- 恢复原源码不能复活原Bundle判为superseded的A，独立B仍可复用。声明产物始终不存在时没有成功Gate，也不缓存producer。当前Windows中Unix symlink launcher用例明确跳过，留给Linux CI。上述六项集成测试通过，一项平台跳过。
- manifest提交前中断保持unknown；manifest/Receipt之后、completion之前中断保持unknown；completion已提交后中断保留A的成功Receipt，pending消费者不被静默执行。最后两个新增断点测试均通过。
- 实际OpenSpec Provider产物和实际文件字节证明：默认只规范化官方Tasks复选框，include仍绑定其原始字节；普通Markdown复选框仍使默认输入失效。
- 新Closure直接使用冻结sourceOid创建checkout；真实Git empty commit前移主工作树HEAD后，候选base仍是冻结OID。与隔离Closure、Specification发布及Archive协议共25项通过。

## 当前集成状态

候选产品提交c13237c已构建并推送。首轮加入三次独立冷CLI恢复的完整用例触及240秒测试预算，该次记为超时，不作通过；后续以360秒预算重新执行。完整suite包含五个真实多仓生命周期矩阵，Comet检查预算按这一测量调整到1800秒；产品超时、重试和输入校验未放宽。最终全量与独立安装包结果尚待补录。

实施细节曾追加到已批准Design，Comet只读next正确报告证据漂移；恢复批准正文后同一Action13/revision19恢复healthy。没有修改Runtime Store或重建Run。该次新增文字均属于已有冻结坐标约束的实施记录，移入本报告。

## 首轮全量检查及修正

完整 npm.cmd run verify 的测试段运行860.41秒：200个测试文件中186通过、13失败、1跳过；1062项测试中1043通过、14失败、5跳过。完整生产组合六项均通过。该次整体返回1，不声明门禁通过。

14项失败分别来自：当前Windows独立依赖安装没有Electron二进制；旧Definition/VerificationInput/Contributor版本及composition golden；Telemetry小型组合漏装真实RepositoryInputPolicy Contributor；新来源引用只更新了脚本checker，Runtime checker仍拒绝它们；仓库自用Profile未声明源范围而扫描到依赖目录联接。已补锁定Electron binary、更新明确版本golden、给真实组合安装Contributor、对齐两checker的固定引用，以及在repoctopus.yaml为每个命令声明实际源码范围和Git消费。没有通过忽略未知文件或允许目录链接放宽产品边界。

这些失败项已逐项定向转绿，类型、lint、生成物、品牌、架构、来源、Dashboard ledger与19项严格规格检查通过。当时产品候选为7475063，正式Comet Build/Verify Guard全量收据仍待执行。

## 独立安装包真实五仓验收

原固定产品包c13237c独立安装后，从项目接入开始完成真实Open、Design、两包Build、BuildCheck和Verify。两项任务各有真实RED=1/GREEN=0/regression=0、commit/push及Runtime接受。有效Verify后仅提交官方完成状态，四个fresh CLI按两种resume/next顺序恢复，完整VerificationInput、Gate、Bundle、BuildProtocol、Binding、Plan和completion不变；两条实际Node检查各执行一次，共2次。随后Workspace同内容empty commit只推进发布OID，两个入口均提示publication-checkpoint-stale，公开reprepare仅将Archive epoch14更新为15，原有效证据保留。已公开的未授权分支阻断两次，切回恢复两次。最终停在未claim的Specification Close，未执行外部Closure/publication。

中间产品包7475063安装在另一个独立prefix，规范内容摘要与仓库复算一致。当前Run兼容检查为compatible/changedPluginIds[]，四次正常恢复、两次未授权分支阻断、两次切回恢复全部通过；Archive input、Work、epoch15及原execution保持不变，实际检查数仍为2。原Store分别140/31/44个文件及旧报告保持哈希不变。原始报告与最终补充报告均保存在仓外独立验收目录，精确哈希见包验收报告。

验收脚本两处错误均保留：Review后的run next已自动完成Verify，脚本多发一次run verify被正确拒绝（无active Verify Work），没有重复检查；archive-prepare返回嵌套RuntimeResult，脚本只修正已保存响应的读取层次，未重复Runtime调用。

## 已知的独立发行诊断问题

7475063候选包doctor实际exit1：来源诊断按源码布局读取package-lock.json，但npm发行包不含该文件；同一诊断还依赖scripts/prepare-desktop.mjs这类未发行维护资源。基线代码已有这些源码布局依赖，本次未放宽校验或向安装目录补写缺失文件。该问题不阻断本Change要求的真实工作流、Evidence与冷恢复验收，单独记录为后续发行诊断修复项；本报告不宣称doctor或完整发行诊断通过。

## 最终身份复核补充

独立复现确认旧 Bundle parser 没有重算 Bundle ID：将 freshness 改为 reused，或把 superseded 改为 fresh，并保留原 ID/dependencies，仍被接受，可能影响缓存候选。新增契约回归实际 RED 后，Bundle 创建改为统一计算最终事实及依赖集合摘要，Store parser 重建同一 canonical 对象；业务调用方不再自行提供 Bundle ID。正常采集与中断恢复共用该工厂，不支持旧身份算法的执行 fallback。新增实际 Store 篡改回归同时检查 status 与下一轮缓存选取必须拒绝，旧候选包验收作为历史保留，最终身份算法将另做固定包验收。

当前a71442d候选的非完整managed矩阵回归：198个测试文件、1052项测试通过，另1文件及5项按平台/既有条件跳过，运行300.54秒。完整五阶段矩阵将在正式Verify门禁执行；新Bundle算法的全新独立安装包多仓验收仍在运行，不沿用历史候选成功结论。
