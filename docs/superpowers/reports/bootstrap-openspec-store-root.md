# OpenSpec Store Root Bootstrap 验证交接

## 结论

`bootstrap-openspec-store-root` 的缺失 Root 重现、官方初始化、Store 注册、多仓 pointer、未知结果恢复、真实 CLI 验收和完整 Build 门禁均已通过。复核没有发现未解决的产品阻断项。

## 权威证据

- Repoctopus 正式验证报告：`verification/bootstrap-openspec-store-root/verification-report.md`
- 打包产品实现边界：`25e2fadaaa860522cbbecb8bb23975b86f940be0`
- 控制器：`@rpamis/comet@0.5.1`
- OpenSpec Provider：`@fission-ai/openspec@1.14.3`
- 验证复核：Root disposition、Provider/Workspace/Store identity、固定 argv、Intent/Receipt、配置最后发布、真实 registry 隔离和恢复边界均通过，阻断项为 0。

本文件是 Comet Classic Verify 所需的报告入口，只负责把生命周期证据绑定到正式报告；它不建立第二套规格、任务或产品验证权威。正式 package-content 摘要只记录在包外的验证报告中，避免报告入口产生摘要自引用。

## 当前 Build Checkpoint 证据

- Build Check 命令：`C:\nvm4w\nodejs\npm.cmd run verify`
- 结果：退出码 0，执行期间工作区无变化，输入前后摘要一致
- 输入摘要：`ec311dea5c80346db5824edfbd02a4e08ef2bea9518fd9502ca929c01c5a5353`
- 内容摘要：`c52c61b96dfb26e724304bc8292cfd1a4623fc0a96a475f5ce368755dae8ce34`
- 收据：`.comet/runtime/classic-sdk-checks/5cb8ad487fbc4fe67891e0cfed323dd6fca5693b4b2d316858f3f6473aaeceaf/6de3ec59-616f-48bd-b0c4-09654b179045.log`

完整验证覆盖 TypeScript、Desktop TypeScript、Lint、CLI/Desktop 生产构建、179 个测试文件、834 个通过测试与 2 个跳过测试、generated/brand/architecture/provenance/Dashboard salvage、19 项严格 OpenSpec 校验，以及正式验证包复现。

## 审查范围与结论

- 首次接入的非空 Workspace 缺少 `openspec/` 时，先走官方 `init`，不再把不健康 Root 直接传给 `store register`。
- 初始化固定使用已安装 Provider entry 和获批 argv，不通过 shell、不手写 Provider 私有文件。
- 事务顺序固定为 `prepare-root -> register-store -> business pointers -> repoctopus.yaml`，任何前置失败都不会提前发布后继配置。
- 同 request 的 Intent/Receipt 支持结果未知后的重观察；只有精确官方 footprint 可恢复，用户文件、符号链接、部分 Root、identity 漂移和 Store 冲突全部 fail closed。
- Store 注册后显式复验 context；父目录 Root、同 id 异 checkout、metadata 不一致和非法 JSON 不会被当作成功。
- 真实 CLI 测试把 XDG registry/config 隔离到临时目录，并证明用户 registry 内容与时间戳不变。
- 方案只采用 Comet 的事务不变量，未复制 Comet 源码，也未引入其单仓状态或第二套 generation/checkpoint。

## 已知边界

- OpenSpec Store registry 是机器本地状态；新的 Runner 仍须通过同一接入事务注册 Store，但不会复制规格权威。
- 部分或不健康的既有 `openspec/` 不会被自动修复或删除，需要人工确认其来源后再处理。
- Archive 前仍须由 Comet Verify Guard 生成 Verify 作用域的真实检查收据；Build 收据不能代替 Verify 收据。
- OpenSpec 的 Proposal、Design、delta Specs 和 Tasks 仍是规格与计划权威；本文件仅是生命周期验收入口。
