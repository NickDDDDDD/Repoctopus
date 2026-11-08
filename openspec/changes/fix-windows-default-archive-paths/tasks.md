# Windows 规格归档路径修复任务

## 1. 真实 checkout 垂直切片

- [ ] 1.1 增加真实 Git 长路径 RED 回归：默认持久配置下重现受管 checkout 创建失败，记录实际目录及文件长度；验证失败来自目标路径操作，夹具清理不影响原验收现场。
- [ ] 1.2 实现局部受管 Archive Git 适配并接入 checkout 创建、观察和清理；以 1.1 回归转 GREEN、Windows 命令级参数及非 Windows 原始 argv 测试证明行为，断言配置和父进程环境不变。
- [ ] 1.3 补齐 checkout 授权及隔离回归，验证非法 checkout identity、根目录越界、冻结 OID 漂移仍被拒绝，成功与失败均不改调用者 HEAD、branch 和 index；将边界记录在当前 design.md。

## 2. 规格提交与发布恢复

- [ ] 2.1 先增加归档文件超过默认完整路径边界的真实索引 RED 回归，再收拢 publication 内全部 Git 调用；验证实际 diff、add、commit、push 和清理转 GREEN，覆盖 NUL 分隔与带空格路径，并确认持久配置不变。
- [ ] 2.2 运行并补齐 `test/specification-publication.test.ts` 的 commit、push、MR 中断恢复和 completed 重放场景；断言精确 OID、允许路径检查、Journal 身份及副作用次数，拒绝漂移且不重复创建结果。

## 3. 公开 CLI 与整体集成验收

- [ ] 3.1 构建并验证候选安装包，在实验工具目录旁独立安装；记录源提交、包摘要及实际入口，旧包和原失败证据保持可读取，不改验收仓配置或系统设置。
- [ ] 3.2 用候选包的公开 CLI 恢复原失败多仓 Run，验证原完成工作包和 Verify 证据保留、真实规格关闭、全部发布项、唯一 MR 集合及终态新进程恢复；记录各作用域 Git 配置、系统长路径设置、实际路径长度和副作用次数，失败时保留原状态并报告。
- [ ] 3.3 按 Comet check policy 的精确命令完成全量验证及独立 thorough 审查，修复阻断项；提交正式验证报告，关联真实 Git/CLI 证据及既有 Run/Work 遥测身份，确认未新增路径或凭据泄露、未留下临时测试目录。

## Workflow follow-up

- Verify 通过后经真实授权归档并交付本 Change，提交后立即 push，CI 通过后按用户授权创建及合入 PR。
- 原实验发布项是否合入由实验交付授权决定；产品 Archive 不增加等待业务 MR 合入的机制。
