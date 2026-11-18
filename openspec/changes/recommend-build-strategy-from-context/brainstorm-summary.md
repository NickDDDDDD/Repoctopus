# Design 探索摘要

## 已确认

- 用户已批准 Open 范围，沿用独立 worktree 与同一 Comet Classic Run。
- 保留两种 execution、两种 TDD、固定 Review，以及 Open/Design 两次正常审批；不引入新 profile 或评分器。
- 上游参考依据、目标与验收范围见同目录 `proposal.md` 和 delta specs。

## 当前候选，待 Design 决定

- 缺省配置保留为未指定；当前 Design Work 通过类型化 Outcome 提交两轴建议及依据。
- Runtime 将当前有效候选保存到原 Run，在现有 Design 决定展示并绑定策略；Build Configure 继续只验证实际 Binding。
- 明确区分不可变启动偏好、当前候选、已批准 Strategy 与机器事实，完整设计以 `design.md` 为唯一权威。
- 原审批 Store 先记录 receipt，Run CAS 重验后原子接受规划、策略和后继；中断恢复采用原 receipt，不要求跨 Store 事务。
- 建议本 Change 实施采用 autonomous + TDD + thorough，保持现有 worktree；这是建议，尚未得到本次配置批准。

## 可实施性检查

独立 builder check 已完成，未留下会改变范围或实施方案的重要未决问题。复核提出的两处缺口已补回唯一 `design.md`：

- 已批准策略改选增加明确的 `run revise-strategy` 意图入口，由 Runtime 检查在途执行后选择受管 Design 修订，不直接改 phase 或已批准策略。
- `spec approval prepare` 绑定当前 Run 的完整候选与隔离意图，消除另一条隐式默认与硬编码 current 的路径；与无 MR 仍可规划审批的主规格要求一致。

另补齐首次 Design 未给配置轴的取值规则，以及稳定 Strategy 与机器配置的术语分界。候选保存复用原 Design gate transition，不新增一次无必要的 epoch。以上均是已批准 Open 范围内的工程深化，未修改 delta specs，最终方案仍等待当前 Design 决定。
