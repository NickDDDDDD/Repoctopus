# Tasks

## 1. 安装后来源诊断

- [x] 1.1 先记录无开发资源的失败回归，再实现生产依赖身份诊断并验证健康、缺失、版本漂移和受保护资源损坏场景。 <!-- comet-task:3f6f2525-3fe5-465d-8673-2767d46439cf -->
  **Acceptance:** 来源单元测试通过；健康 fixture 无 lockfile/准备脚本；缺失或漂移生产依赖及损坏快照均失败。
  **Requirements:** product-distribution#安装后诊断独立于开发资源
- [x] 1.2 保留开发来源脚本，并用锁版本、integrity 和准备脚本缺失反例验证 CI 审计仍然失败。 <!-- comet-task:f07fc2be-5f62-4874-a3a6-6ea2715c208f -->
  **Acceptance:** 开发来源审计健康样本成功，三个反例分别返回非零；完整来源检查仍通过。
  **Requirements:** product-distribution#开发审计与发布包诊断分别验证

## 2. 实际发布包消费验证

- [x] 2.1 扩展 tarball 生产安装 E2E，经公共 CLI 验证 doctor 健康成功、资源损坏失败和恢复成功，核对诊断不改 Run 持久事实。 <!-- comet-task:f9926e98-5bc4-4bba-bbcd-37a178955b3c -->
  **Acceptance:** package E2E 通过；未注入开发文件；诊断前后 Run、Checkpoint、Trajectory 字节一致；真实损坏返回结构化错误。
  **Requirements:** product-distribution#安装后诊断独立于开发资源; product-distribution#开发审计与发布包诊断分别验证
- [x] 2.2 补充诊断说明，完成相关回归、独立审查与正式验证报告，记录 Comet 参考和真实 RED/GREEN。 <!-- comet-task:1a971bb8-f8bd-499b-81ee-6a7b698c9dbf -->
  **Acceptance:** 文档与实现一致，相关检查及完整标准 verify 通过，独立审查无未解决阻塞，报告区分已执行与未执行。
  **Requirements:** product-distribution#开发审计与发布包诊断分别验证

## Workflow follow-up

- 经 Comet 正式归档、创建 PR、CI 通过后合入 main。
- 从 main 构建安装包，复验健康诊断、真实损坏与只读边界；不通过则继续修复。
