# Evidence

Evidence 是 Repoctopus 对“实现已经获得正确反馈”的可审计证明。Agent 的文字说明不能替代 Receipt 或 Bundle。

## 核心对象

- **Attempt**：一次显式 Profile 执行，保留成功、失败、中断和恢复历史。
- **Receipt**：一个节点的一次 Adapter 结果，绑定输入指纹、可信等级、新鲜度、Artifact 与 finding。
- **Artifact**：按 SHA-256 内容寻址的输出引用。相同内容只保存一次。
- **Bundle**：一个 Attempt 的有序检查集合，结果为 `passed`、`failed`、`incomplete` 或 `passed_with_warnings`。
- **Gate Projection**：Runtime 提供给 Engine 的最小门禁事实，不包含日志或文件正文。

## 可信等级与新鲜度

`verified` 表示 Runtime 可以核对执行身份和输入；`observed` 表示反馈可用于开发诊断，但身份不足以满足正式门禁。`fresh` 来自当前采集，`reused` 只用于完全相同且仍在有效期内的确定性命令 Receipt，`superseded` 表示采集期间输入发生变化。

## 零测试

命令节点可以设置：

```yaml
zeroTests: warning # ignore | warning | blocking
```

Repoctopus 识别 npm 测试生态、Maven Surefire 和 Gradle 的常见结构化摘要。退出码为零但执行数为零时生成 `no-tests-detected`；`warning` 产生 `passed_with_warnings`，`blocking` 产生 `incomplete`。没有可识别摘要时不会猜测测试数。

## CLI

```powershell
node bin/repoctopus.js evidence plan --workspace . --profile verify --json
node bin/repoctopus.js evidence run --workspace . --profile verify --json
node bin/repoctopus.js evidence status --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence inspect --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence resume --workspace . --attempt <attempt-id> --json
node bin/repoctopus.js evidence clean --workspace . --max-age-days 30 --max-bytes 1073741824 --json
```

若 Evidence 属于现有工作流 Run，`evidence run` 可增加 `--workflow-run <run-id>`，遥测会用该稳定 ID 关联 Run 与 Attempt。

`clean` 使用标记清扫：运行中 Attempt、失败 Bundle 和配置要求保留的近期成功 Bundle 构成保护根。它不会根据单个文件年龄删除仍被这些事实引用的 Artifact。
