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
