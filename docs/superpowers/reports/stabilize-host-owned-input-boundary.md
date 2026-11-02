# Host-owned Input Boundary 验证交接

## 结论

`stabilize-host-owned-input-boundary` 的产品/控制面输入分区、Evidence 与 Verification Input 绑定、发布包边界和完整产品门禁均已通过。独立差异审查没有发现未解决的阻断项。

## 权威证据

- Repoctopus 正式验证报告：`verification/stabilize-host-owned-input-boundary/verification-report.md`
- 产品与报告检查器边界：`097a8bb3a3ddc099c585597778848280a47e757d`
- 正式报告提交：`85041fb`
- 控制器：`@rpamis/comet@0.5.1`

本文件是 Comet Classic Verify 所需的报告入口，只把生命周期收据绑定到正式 Evidence；它不建立第二套规格、任务、实现笔记或产品验证权威。`docs/superpowers/**` 已从发布包排除。

## 当前 Build Checkpoint 证据

- Build Check 命令：`npm run verify`
- 结果：退出码 0，执行期间工作区无变化，输入前后摘要一致
- 输入摘要：`4aec91122e0173563b0240c223d3948f73f486a290730dc31dfbbb16fecf8931`
- 内容摘要：`ecb510b437a4f15280a79e038a7f4c6071d8f0a275f8e589fdca4c2c88cfe855`
- 收据：`.comet/runtime/classic-sdk-checks/a6e3398d1ebb371c4eab1bb5352c7d1e87ad0ffa7172a65c761a5e67014d5812/a7514e24-dcdd-4047-ab05-b94b9ae40f4d.log`

完整验证覆盖 TypeScript、Desktop TypeScript、ESLint、CLI/Desktop 生产构建、171 个测试文件、762 个通过测试与 2 个跳过测试、generated/brand/architecture/provenance/Dashboard salvage、18 项严格 OpenSpec 校验，以及规范化 npm 包内容身份复现。

## 独立审查范围与结论

- Repository Input Policy 默认拒绝；Git tracked 路径优先保持产品输入或触发 external-exclusive ownership conflict。
- 显式枚举覆盖被本地 Git ignore 隐藏的 Host 文件；未知文件仍进入 product dirty set。
- 控制面采集拒绝越界、symlink、junction、共享 hardlink、不安全类型、数量/大小超限以及 selection/content race。
- 多仓分别产生控制面 manifest；Evidence fingerprint v2 与 Verification Input v3 同时绑定 policy 和 control-plane digest。
- 发布包不包含 `.codex`、`.agents`、`AGENTS.md` 或 `skills-lock.json`；架构门禁检查 Git 产品面而非本地 Host 安装的物理存在。
- 包验证使用路径排序后的类型、权限、长度与内容摘要；不同 gzip/tar 元数据不改变产品身份，任意包内语义变化都会改变身份。

## 已知边界

- 本文件只服务 Comet Verify，并被发布包显式排除。
- Archive 前仍须由 Comet Verify Guard 生成 Verify 作用域的真实检查收据；Build 收据和正式报告不能替代该收据。
- OpenSpec Change 文档与 `tasks.md` 仍是规格和计划权威。
