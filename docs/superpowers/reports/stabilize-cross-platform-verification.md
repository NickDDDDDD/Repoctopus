---
change: stabilize-cross-platform-verification
status: verified
---

# 跨平台验证稳定性修复交接

## 结论

`stabilize-cross-platform-verification` 的 13 项 OpenSpec 任务已全部完成。Windows 全量门禁、
GitHub Linux 精确报告提交、真实 detached parent/descendant 进程组验收和独立最终审查均已
通过；独立审查结果为 0 CRITICAL、0 IMPORTANT、0 WARNING。

## 权威证据

- Repoctopus 正式验证报告：`verification/stabilize-cli-distribution-gate/verification-report.md`
- 核心产品实现边界：`327731bbb20869e1585460869d47201c04f99daa`
- 包内容 SHA-256：`632cbf85078ed5ac81cfe7c54e4fa555a612e5d4f17839a9a659824c88fe194d`
- 包内容：456 个文件，5,538,528 字节
- GitHub Linux：run `42007557281`，精确提交
  `5eba86870ba11d68773bc171d1cb2698466ca1f1`，成功
- 控制器：`@rpamis/comet@0.5.1`
- OpenSpec：13/13 Tasks，`skip_specs: true`

本文件是 Comet Classic Verify 的阶段报告入口，只把当前生命周期绑定到上述正式报告；它
不建立第二套产品验证权威。Build Check 与 Verify Check 的输入摘要、日志和 receipt 由
`comet-state.yaml` 持有，本文件不预声明未来 receipt，以免证据自引用。

## 修复与验证

- recovered POSIX termination 继续在破坏性信号前核验 leader creation identity。
- 信号后只以 `kill(-pgid, 0)` 返回 `ESRCH` 证明完整 process group 已退出；存活、`EPERM`
  和超时均保持 `unknown`。
- 确定性 fake-timer 测试复现并关闭 leader 已退出但 descendant 仍存活的旧假成功。
- Comet 风格的真实 Linux fixture 启动 detached parent 与同组 descendant，并验证成功结果
  不留下后代进程。
- Windows 全量为 191 个测试文件通过、1 个平台文件跳过；946 个测试通过、3 个跳过。
- GitHub Linux 为 191 个测试文件通过、1 个平台文件跳过；945 个测试通过、4 个跳过，
  真实 POSIX fixture 通过。
- provenance、generated、brand、architecture、Dashboard salvage、19 项 strict OpenSpec 和
  package-content v2 身份复现全部通过。

## 清理

语义摘要临时 tarball 已删除；进程 fixture 在 `finally` 中清理；没有保留 debug 日志、
scratch 文件、临时消费者目录或后台进程。
