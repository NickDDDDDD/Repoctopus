# Archive 发布恢复验证报告

## 可复现对象

- Change：`stabilize-archive-publication-recovery`
- 已测试实现提交：`c39fbe01d10bb0b290ef8a645ca6f847b12f9085`
- npm 包：`repoctopus@0.1.0`
- 包内容 SHA-256：`842f47f170ca63c30f3be3f941b4f3f0670ad62bb9de93d31cfbc4e0ed7de347`
- 包含文件：`451`
- 内容字节数：`5421479`
- 流程控制器：`@rpamis/comet@0.5.1`
- 平台：Windows x64
- Node.js：`24.21.0`

已测试实现提交同时是打包产品和冻结验收 fixture 的边界。它之后的提交只包含
OpenSpec、Comet 状态或验证证据。`check:managed-execution-report` 会独立重建 npm
归档，并拒绝该边界之后的产品代码变化或语义包漂移。

## 已证明的 Runtime 不变量

1. GitHub 创建请求收到明确 HTTP 4xx 时分类为 `not-applied`。HTTP 5xx、传输失败、
   成功响应但 JSON 无效，以及创建后的状态核验失败，仍分类为 `unknown`。
2. `not-applied` 会结束当前 pull，并把同一 Business 或 Specification Journal 操作原子地
   回到 `pushed`；intent、operation identity、published OID、attempt 和历史均保留。
3. 下一次显式 pull 必须先观察，之后最多创建一次。`unknown` 操作只能观察，重复恢复绝不
   增加 create 次数。
4. 仓库、head、base 与 head OID 唯一精确匹配时，操作以 `recovered` 完成；零匹配、歧义
   和 OID 不匹配均保持 fail-closed。
5. 只有 `PublicationResultUnknownError` 会把 Work execution 标为外部副作用未知。
   `PublicationNotAppliedError` 保留同一个已验证 Archive Work，使其可重试，并记录有界
   reconciliation fact。
6. 已完成 Run 始终投影为 `done/terminal`，Work 和 attempt 为空，check epoch 为当前值，
   且没有 next action；历史 null-Work selection 不能覆盖终态权威。
7. 非终态 continuation replay 必须精确匹配 Run、state version、Work、attempt 和
   check epoch。
8. 发布遥测只暴露有界的 stage、certainty 和 result 维度；repository、branch、path、
   response body 和自由文本错误不会进入 Metric labels。
9. `delivery-file` composition identity 覆盖完整的发布恢复实现、持久化 adapter 和 GitHub
   platform adapter。

## 历史与全新验收证据

可移植 fixture `test/fixtures/archive-publication-round5-terminal.json` 冻结第五轮生产形态：
一个完成的 Archive checkpoint 后面跟着更旧的 null-Work `continuation.selected` 事实。
公共 projector 重放后只能得到 terminal，且不会产生 next action。

失败注入矩阵使用 fake platform adapter 与本地 Git 仓库，证明以下路径：一次
`not-applied` 后经修正的显式 pull、未知创建不重放、随后精确采用、Specification 发布
语义一致、operation identity 稳定，以及创建后核验失败保持 fail-closed。测试不访问
GitHub，也不会创建真实 MR。

打包 CLI 端到端测试使用生产构建和临时本地 Workspace，证明修复后的 composition 与生成
产物在发布包入口中仍可运行。

## 命令与结果

以下命令在 Windows、Node.js `24.21.0` 上执行：

```text
npx vitest run test/change-continuation.test.ts test/github-merge-request.test.ts \\
  test/resumable-publication.test.ts test/stable-publication.test.ts \\
  test/specification-publication.test.ts test/telemetry-mapping.test.ts
  结果：6 个文件通过，51 个测试通过

npm run test:package-e2e
  结果：打包 CLI 端到端测试通过，1 个文件、1 个测试

npm run verify
  结果：TypeScript、Desktop TypeScript、ESLint、CLI/Desktop 生产构建通过
  结果：完整 Vitest 矩阵 182 个文件通过，861 个测试通过，2 个测试明确跳过
  结果：generated、brand、architecture、provenance、Dashboard salvage 检查通过
  结果：strict OpenSpec 18 项通过，0 项失败
  结果：managed execution report 成功重现包 identity
```

第一次完整验证发现新增恢复代码引起确定性的 composition digest 快照变化。审查进一步确认，
原 source manifest 也遗漏了发布恢复依赖。因此先补全 manifest，再更新 fixture；随后定向的
composition、architecture、provenance 与 generated-artifact 检查全部通过。这里没有用更新
快照掩盖遗漏依赖。

## 恢复诊断与遥测

`not-applied` 诊断要求操作者修正有界的平台拒绝，然后重新 pull 同一个 Archive Work。
`unknown` 诊断要求精确观察或采用；如果无法观察，则以权威的“未执行”证据进入人工
reconciliation。两条路径都不建议创建新 Run、编辑 Store 或盲目重放 create。

Trace events 保留既有 Run、Work、attempt 和 check-epoch 关联。Metrics 只新增
`push|merge-request`、`not-applied|unknown` 与 `retryable|reconcile`；隐私测试会拒绝
repository、branch、path 和 error-body labels。

## 清理

- 用于语义摘要的临时 npm package archive 已删除。
- 本地 Git 与打包 CLI fixture 目录由已验证的测试 hooks 删除。
- 本隔离 worktree 临时使用的 `node_modules` junction 会在全部验证命令完成后删除。
- 未引入 debug log、scratch JSON、真实 MR、Runtime Store 手工修改、兼容 reader、daemon、
  webhook、merge wait 或 auto-merge 路径。

## 结论

打包实现恢复了 Archive 发布恢复与终态投影的确定性，同时保持 pull-based Runtime 权威。
它遵循 Comet 的外部效果原则：未知结果永不重放；只有确定未执行后，重试才合法。正式 Verify
应重现本报告的检查结果并绑定 Guard receipt，随后才能进入 OpenSpec Archive。
