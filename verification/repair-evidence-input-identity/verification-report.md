# Evidence 输入身份包验收

- Tested implementation commit: `a71442de82af88b8dd546bb3462a4f92111f6323`
- Package files: `467`
- Package content bytes: `5932579`
- Package content SHA-256: `1bae8671759a8423883398d437771810f8622ef9688d33f36838bc45e0c0d7b0`
- Tarball SHA-256: `f5333f9e7a698f689489d8be347a6f1494a9ac196521794476114145490cb0dc`

当前固定产品包为a71442d，修正Bundle canonical身份的创建与读取。此前c13237c和7475063是中间候选，保留其实际验收结论，不能把旧身份证据转换或冒用为当前包已完成完整验收。规范化摘要从实际独立安装的tarball直接计算；仓库包复现检查将从当前工作区重新打包核对。

生产组合的两业务仓完整五阶段用例已通过，实际运行234.56秒。Verify后提交官方Tasks完成状态，再由三个独立CLI进程按resume/next/resume恢复，保留已接受Bundle和两包completion，随后完成Archive。原额外Verify fallback与对应重复调用预期已删除；当前成功不依赖重跑Verify。

前两个固定tarball的真实五仓/恢复验收结果作为历史保留；当前a71442d候选从全新隔离多仓Run重新验证，原始报告尚待补录。完整检查和实际多仓结果将补录本报告及[Comet验证报告](../../docs/superpowers/reports/repair-evidence-input-identity.md)。全部原始证据保存在仓外独立验收目录，原验收Store未改写。

历史原包报告原字节SHA256：`1e5c957dd1cfe1d626f297f68cb887724a2bd2cb80e09a1b71dd3df91f091351`；追加已知发行诊断范围说明后的SHA256：`97131404018f7504a0eef41d190e80ab26cdc6d47624560f7869acd3c4c0c945`。7475063候选恢复补充报告SHA256：`aee21f7da05304259eefdf9967619bca50ef97729024691abfb13662958aeb7e`。这些报告不冒充新Bundle算法的最终验收。

已知独立发行问题：已安装包doctor因缺package-lock.json退出1，未复制源码或绕过校验。该源码布局依赖作为后续发行诊断修复记录，当前工作流专项不宣称doctor通过。
