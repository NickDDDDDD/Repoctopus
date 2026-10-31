# add-auditable-team-skill-composition 验证报告

## 验证对象

- Change：`add-auditable-team-skill-composition`
- 分支：`codex/add-auditable-team-skill-composition`
- 实现提交：`a3a49b953908538e4850ed55120a02157487b89a`
- 远端分支 OID：`a3a49b953908538e4850ed55120a02157487b89a`
- npm 包：`repoctopus@0.1.0`，`986855` bytes
- npm 包 SHA-256：`0770df489e06c88efb0d3a56e000e3ff7ccc77c8b3d2a1b7aba2d45d7321a7f7`
- Lifecycle definition：`repoctopus-change@4.5.0`
- Lifecycle definition digest：`sha256:ce969dbd7c17972b3cd438c585c7f0aebbeca046327ce2808659fdd8351a54f3`
- 项目配置文件 SHA-256：`sha256:da8ac5c84896909a2130a0b54716ca87c857b1826b5df178a45b0152fe239a9b`
- 生产 project composition fixture digest：`sha256:e79d55b33bb04bc6e43a80585ea69fe9022b69ad2ab60ff6b2762abc33a6e109`
- team binding 纵切 fixture 的 EffectiveSkillComposition digest：`sha256:cd5d7312f661a3fbc7a5f9b2c82bd8710f4b65a8aace894ab4e7aebe7dbacb7b`
- 五阶段黑盒 Run identity：`change-managed-blackbox-managed-blackbox-a56af5c947f984ce`
- 平台：Windows `10.0.26300` x64；Node.js `24.21.0`

Composition digest 是配置和 Provider 内容的函数，不是包级常量。上面两个摘要分别由 production composition 测试和带 guidance/replacement 的固定 Provider fixture 锁定；真实团队更换共享 binding 或活动 Provider 内容必须得到新摘要。

## 结论

团队可以通过受版本控制的 `repoctopus.yaml/lifecycle.skillBindings` 为指定 Work 追加只读 guidance，或替换 lifecycle definition 明确公开的 augmentation slot。Action、capability、write scope、产物协议、Validator 和 transition 仍由 Runtime 控制。

Runtime 在首个 Work 前解析项目 Provider 的真实 Skill 内容和资源摘要，编译并冻结 `EffectiveSkillComposition`，把 work-level composition 放入不可变 Work packet，并把所有活动层绑定到同一 Run。恢复时共享配置、Provider 内容、个人来源或合同漂移会 fail closed；不会静默采用新方法。

Host 成功 Outcome 必须精确回报当前 packet 的全部 action/augmentation layer digest。缺层、未知层或旧层均被拒绝。`skill.consumed` 只表示该回执通过摘要校验，不证明 Agent 遵循了方法内容。

## 验证命令

```text
npm run verify
  TypeScript、Desktop TypeScript、ESLint、生产构建通过
  150 test files passed
  649 tests passed；2 skipped
  generated、brand、architecture、provenance、dashboard salvage 通过
  OpenSpec strict validation：19 passed，0 failed
  第一次执行最终只由旧正式报告的新鲜度门禁拒绝；报告前移后重新闭合

npm run test:package-e2e
  1 test file，1 test passed

npm run test:tracer-e2e
  1 test file，1 test passed

npm run package:desktop
  Windows x64 NSIS 构建成功

npm run check:desktop-package
  6 package entries，14 resources，116497593 bytes

npm run test:desktop-package-e2e
  install-candidate、run-activation、otlp-receiver、single-instance、
  tray-hide-and-restore、direct-exit、uninstall-candidate、
  restore-registry-state 全部通过
```

## 需求证据

| 边界                                                  | 证据                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| 无 binding 保持核心组合；Action 不可替换              | `test/skill-composition.test.ts`、definition architecture tests             |
| 个人同名 Skill 不得进入团队 Run                       | compiler/service user-source negative tests                                 |
| guidance/replacement 配置、Schema 与本机隔离          | `test/project-configuration.test.ts`、`test/project-composition.test.ts`    |
| target/slot、重复、Provider/能力/产物冲突 fail closed | `test/skill-composition.test.ts`                                            |
| Open、Design、Build 真实内容与冻结顺序                | `test/team-skill-composition-service.test.ts`、`test/work-context.test.ts`  |
| 多目录身份稳定、Provider 内容漂移改变摘要             | team composition service recovery tests                                     |
| 未知、旧或缺失 layer 不能补推成功                     | `test/managed-work-executor.test.ts`                                        |
| composition reject/drift 与消费失败均先持久化         | `test/skill-composition-observability.test.ts`                              |
| Trace/Event 保留角色与 binding；Metric 无高基数泄漏   | `test/observation-envelope.test.ts`、`test/telemetry-mapping.test.ts`       |
| Desktop 显示 Action、内置、guidance、replacement 状态 | `test/desktop-projection.test.ts`、生产 renderer build、Windows package E2E |
| 同一 OTLP receiver 重放收敛                           | Desktop projection/receiver/host E2E                                        |
| 完整 Open → Design → Build → Verify → Archive         | `test/managed-change-execution.e2e.test.ts` 四条真实多进程路径              |

## 验证中发现并修复的问题

1. `ChangeLifecycleSnapshot` 已包含 composition digest，但 Run 创建转换最初没有复制该字段；审计事件因此正确 fail closed。修复后，snapshot → Run State 的唯一边界保留摘要，并由 Desktop activation 与完整 lifecycle E2E 覆盖。
2. lifecycle definition 加入 replaceable slot 后，版本从 4.4 提升到 4.5，并移除 4.3/4.4 的伪兼容声明；旧预发布 Run 明确进入迁移诊断。
3. Comet adoption target `domains/runtime/workflow-runs.ts` 变化后，provenance 与 tracer 的 doctor 正确拒绝旧 target digest。只更新本地派生摘要，上游 source commit/digest 未移动。
4. 全量验证发现并清理两个多余类型断言、两个旧 import 和两个不符合 lint 合同的内联类型 import；没有放宽静态检查。
5. 首次把 team guidance 放入真实 Build Execute 后，旧的 Work factory 把全部 augmentation 与仅内置 TDD 列表比较，错误拒绝合法团队层；现在只对内置策略层执行 TDD/Review 校验，冻结 team guidance 仍必须通过完整 Work composition 与 Host 消费门禁。
6. 最终规格复核发现已有事件类型没有形成完整事实：恢复漂移未持久化、错误消费摘要直接抛错、replacement 未展示被替换默认项且投影按角色而非冻结顺序排序。Runtime 现在在拒绝 Outcome 前提交有界失败事件，活动 Run 的解析拒绝和恢复漂移均进入 Trajectory/OTLP；projection 以冻结 position 排序并显示 slot、binding、replacement identity 与失败类别。

## 已知边界

- 本 Change 不执行团队 required check；该能力位于独立 change `add-managed-team-required-checks`。
- `consumed` 不是方法遵循证明；Open/TDD Method Receipt 分别位于 `verify-open-intake-method` 与 `verify-tdd-method`。
- 动态 Build TDD/Review 仍由批准后的 Build configuration 决定；本 Change 不改变执行策略协议。
- 旧 4.4 自举 Run 不原地迁移。本工作树曾观察到旧 Store 注册和 lifecycle migration-required，这属于已记录的后续自举迁移限制，没有通过删除 `.repoctopus` 或修改 Store 绕过。

## 清理

- npm pack 使用的临时目录与 tarball 已删除。
- Windows package E2E 已恢复注册表、停止 Electron/Host/Receiver，并删除临时安装目录。
- 没有保留临时日志、payload、receiver 或测试 Workspace。
- `dist/desktop-release` 是被 Git 忽略的正式本地打包输出，不进入提交；最终交付前工作树只允许 OpenSpec task/report Evidence 变化。
