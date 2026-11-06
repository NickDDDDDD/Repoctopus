# 任务

## 1. 复现并修复规格读取

- [ ] 1.1 在实际 CLI 路径增加 OpenSpec Store 回归，先观察目录别名在修复前触发错误。
  **Acceptance:** Windows junction 或平台等价目录别名与登记根解析为同一目录。修复前，通过实际路径执行 `spec inspect` 成功，通过别名执行相同命令得到 checkout 冲突。
- [ ] 1.2 让规格读取使用实际 checkout 身份核对，并保留 Store ID 约束。
  **Acceptance:** 通过目录别名执行 `spec inspect` 与 `spec validate` 成功。将相同 Store ID 指到另一个真实 checkout 或失效根时拒绝访问且不回退。

## 2. 接入路径与发布验收

- [ ] 2.1 让项目探测和 Store 登记核验沿用同一实际目录身份。
  **Acceptance:** 从别名探测能识别 Workspace，已登记 Store 被识别为精确匹配并复用。不同 checkout 或无法确认的登记仍阻止接入，未批准的配置和 pointer 保持不变。
- [ ] 2.2 从精确修复提交重新打包，执行 Windows CLI 安装与隔离 `npx` 验收。
  **Acceptance:** `test:package-e2e` 对预构建的 tarball 通过。`test:release-npx` 验证帮助和 JSON 协议。覆盖已有接入、登记冲突和规格测试，验证报告可复算包内容摘要。
- [ ] 2.3 按实际改动完成集成审查和发布交接。
  **Acceptance:** 验证报告可关联到修复提交，审查确认没有扩大 Store 权限。交付说明明确合入后使用新的 `main` SHA 重跑 Prepare 和 Publish，外部结果保存在 Actions 记录。
