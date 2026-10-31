# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 人工等待只展示当前有效语义决定

桌面应用 MUST 从标准 OTLP 投影当前有效 Human Decision，并展示 phase、decision kind、有界 reason、创建时间和其绑定的 Strategy/composition/Plan revision；相同 semantic digest 的重试、恢复或返工不得产生重复待处理卡片。界面 MUST 区分真正需要用户选择、Runtime 正在自动重验 ExecutionBinding，以及历史已复用/失效决定。

#### Scenario: Build Configure 重验 checkout

- **WHEN** 当前 Strategy 已批准而 Runtime 正在验证新的 ExecutionBinding
- **THEN** Dashboard 显示自动验证状态和受影响 Work，不显示“请再次批准 Build Configuration”

#### Scenario: 相同摘要重复投递

- **WHEN** receiver 因 OTLP 重试收到同一 decision created/reused 事实
- **THEN** 投影收敛为一张当前卡片并保留历史事件，不增加待处理数量
