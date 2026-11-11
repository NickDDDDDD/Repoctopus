# 实施任务

## 1. 贯通 Workspace 入口

- [ ] 1.1 随 CLI 包交付 `repoctopus` 入口资产，将宿主目标纳入接入候选与审批；以新装包检查候选可见、批准前无写入、批准后 Codex 能发现入口。 <!-- comet-task:b0a5fbc8-83f7-4b67-8664-4b10e7b33c90 -->
- [ ] 1.2 让入口经公开 CLI 按明确意图启动 Change 或恢复原 Run；在真实宿主调用，核对 Run 身份，并验证缺少必要输入时先停下澄清。 <!-- comet-task:f6a52240-5e08-4210-9042-5c03495c571f -->
- [ ] 1.3 接通可执行 continuation、当前 Work claim、真实正文和资源装填以及现有回执；测试资源校验失败不启动 Host，动态诊断资源绑定当前包，且同名 Skill、旧包和仅有名称均不能替代当前内容。 <!-- comet-task:6949290a-69fe-4a87-9172-f412699dcc1f -->
- [ ] 1.4 接通人工决定、等待、核对与完成的处理，更新 Workspace 引导；验证 Open 等待时无 Design 装填，冷恢复后沿同一 Run 装填当前 Design。 <!-- comet-task:1f872953-a072-4f23-9046-8f14fdef0ef8 -->

## 2. 扩展安装覆盖与保护

- [ ] 2.1 补齐 OpenCode 宿主路径和单仓、多仓的接入覆盖；实测 OpenCode 发现并加载入口，验证入口只安装在指定 Workspace，不改业务仓宿主配置、用户目录或其他 Skill。 <!-- comet-task:157d89ad-92a9-40e6-9a86-eb97cd048e53 -->
- [ ] 2.2 复用所有权和写前重验，测试同名团队文件、本地修改、并发变化及不安全路径的拒绝与原样保留。 <!-- comet-task:85014b1f-3791-4a2c-85e2-3eee98caf56b -->
- [ ] 2.3 验证中断后续接、已确认请求幂等重放与既有 Workspace 获批补齐；比对 Store、业务仓指向和已有 Run 的身份，并更新补齐说明。 <!-- comet-task:ddc2b0f8-b3a2-4644-b5ab-9a0b43164b30 -->

## 3. 整体验收

- [ ] 3.1 用实际安装包和隔离的多仓 Workspace 完成真实宿主验收，记录入口调用、正文装填、审批停留、同一 Run 的跨进程恢复及 Build Configure 后领取，以及实际消费回执和遥测的对应关系；汇总结果到 Evidence 与正式 Verify 报告。 <!-- comet-task:83b0006c-5d17-44e7-b319-ffd16d69fdae -->
