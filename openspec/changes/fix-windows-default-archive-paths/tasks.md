# Windows 归档路径与跨实现恢复任务

## 1. 统一 Archive 恢复与执行权威

- [ ] 1.1 先建立跨实现 Archive RED 回归：生产 Cordis 组合中冻结来源 A，合法采纳 B 后调用真实规划与发布校验，确认当前失败来自历史组合等值检查；不 mock validateArchiveIntent、组合判定、Planning approval 或核心 publishArchive。 <!-- comet-task:eaf35d6b-14b6-499e-825d-cedcf8df9b4a -->
- [ ] 1.2 区分原冻结来源与本次执行上下文，在既有受保护入口内核对最新 Run/Work/epoch/Archive input 和当前组合，再交给 Delivery；让 1.1 转 GREEN，断言原输入、审批、Verify 与 Journal 身份不变，过期或跨 Run 上下文无副作用。 <!-- comet-task:dadbb228-3ace-4f5f-a456-e1770063eb63 -->
- [ ] 1.3 补齐 Archive 真实 Provider 依赖及竞争回归：specification.close 与 delivery.publish 均覆盖受保护 Delivery；验证不兼容、错误/多个前驱、配置/authority/schema 漂移及入口前再次漂移被拒绝，未知执行仍先协调，不增加重复审批。 <!-- comet-task:a709c446-2677-4d2a-8117-5a528b58bae3 -->
- [ ] 1.4 对实际变更实现登记新源文件和唯一精确直接前驱，以源基线、旧包和原 Run 的生产代码/descriptor 摘要核对；运行 composition compatibility 正负回归，不扩大其他插件兼容范围或固定伪造当前摘要，最终实现完成后复核。 <!-- comet-task:c3d049cc-18b6-4291-9e24-e89fffbe965e -->
- [ ] 1.5 更新现有 Runtime/插件文档及当前 design.md 的身份职责、公开恢复步骤、commit/push 与组合变化的区别；回读并核对示例不要求手改 Store、重复审批或延迟 push，文档不包含具体宿主或绝对路径。 <!-- comet-task:c69cbbf0-19fe-4c16-9a88-c7ae21f47d9d -->

## 2. Windows 长路径归档链路

- [ ] 2.1 增加真实 Git checkout 长路径 RED，再实现局部 Windows 命令级适配转 GREEN；覆盖创建、观察、清理、非 Windows argv 和原始 NUL 输出，并验证成功/失败后持久配置与父进程环境不变。 <!-- comet-task:21d48cd8-e38d-4dc6-9d80-d1174d52889b -->
- [ ] 2.2 增加归档文件超过默认完整路径边界的真实索引 RED，收拢 publication 全部 Git 调用转 GREEN；断言实际 diff、add、commit、push、清理、索引内容和远端 OID，覆盖空格路径与配置不变。 <!-- comet-task:a6ec55d6-082b-4b4d-80c7-d4daaf04d5ff -->
- [ ] 2.3 运行并补齐 checkout 授权、冻结 OID、受管根、调用者 HEAD/branch/index 隔离，以及规格提交/push/MR 各中断点和 completed 重放回归；越权或漂移仍拒绝，恢复不重复已确认副作用，边界记录在 design.md。 <!-- comet-task:1dc12635-41cc-46b3-9fbe-12b272a62fbd -->

## 3. 原 Run 与完整集成验收

- [ ] 3.1 从最终修复提交构建并独立安装候选包，记录实际源提交、包摘要和 CLI 入口；保留原已验证旧包、失败日志、registry 和实验现场，不改变验收仓 Git 配置或系统设置。 <!-- comet-task:62e65c6f-2762-4a91-bf7b-feda48bc36c0 -->
- [ ] 3.2 使用候选包公开 CLI 接续原失败多仓 Run，验证精确组合采纳、原工作包/审批/Verify Input/Gate/Bundle/Archive input 保留，以及真实规格关闭和完整既定 MR 集合；记录实际默认设置、路径长度及命令/副作用次数，不以新 Run 替代。 <!-- comet-task:8dd9ab1c-ebc2-4294-98c3-6bcfb80257ac -->
- [ ] 3.3 在成功关闭、部分发布和完成边界验证新进程恢复与 resume/next 顺序，核对原 Journal、精确 OID/MR、调用次数及终态不重复执行；关联既有 Run/Work/组合采纳遥测，缺失证据如实列为未验证。 <!-- comet-task:84ba5edb-a748-4af4-8e10-d40850f724ed -->
- [ ] 3.4 按 Comet check policy 精确命令完成全量验证和独立 thorough 审查，修复阻断项；提交正式验证报告，区分自动化契约夹具与真实旧包到新包的结果，确认临时测试目录清理且原失败证据保留。 <!-- comet-task:7594fa72-e6c3-4ec2-b7ec-abd6e0d629f2 -->

## Workflow follow-up

- Verify 通过后经真实授权归档并交付本 Change，每次 commit 后立即 push；CI 通过后按用户授权创建及合入 PR。
- 原实验 MR 的合入仍按实验交付授权决定；产品 Archive 不等待业务 MR 合入。
