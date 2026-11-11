import type { SharedProjectConfig } from './types.js';

export interface WorkspaceGuide {
  file: string;
  tag: string;
  content: string;
}

export const WORKSPACE_GUIDE_FILES = [
  'README.md',
  'AGENTS.md',
  'docs/repoctopus/workspace-guide.md',
] as const;

function code(value: string): string {
  const text = value.replace(/[\r\n]/gu, ' ').replaceAll('|', '\\|');
  const length = Math.max(0, ...(text.match(/`+/gu) ?? []).map((part) => part.length)) + 1;
  const delimiter = '`'.repeat(length);
  return `${delimiter} ${text} ${delimiter}`;
}

function portableRepositoryPath(value: string): string {
  return /^(?:[A-Za-z]:|[/\\])/u.test(value)
    ? '本机路径见 .repoctopus/local.yaml'
    : value.replaceAll('\\', '/');
}

export function renderWorkspaceGuides(config: SharedProjectConfig): WorkspaceGuide[] {
  const single = config.repositories.length === 1;
  const store = config.specificationProvider?.store;
  const storeFlag = store ? ` --store '${store.id.replaceAll("'", "''")}'` : '';
  const repositories = config.repositories.map(
    (repository) =>
      `| ${code(repository.id)} | ${code(portableRepositoryPath(repository.path))} | ${repository.id === config.workspace.repositoryId ? 'Workspace' : '业务仓'} |`,
  );
  const fence = '```';
  const readme = [
    '## Repoctopus 工作流',
    '',
    `Workspace：${code(config.workspace.id)}。`,
    single
      ? '这个业务仓同时作为 Workspace，规格、团队配置和业务代码在同一仓维护，无需再建一个仓库。'
      : '这里是团队多仓开发的入口，保存共享配置和 OpenSpec 规格；实现提交到各自的登记仓库。',
    '',
    '| 仓库 ID | 共享相对路径 | 用途 |',
    '| --- | --- | --- |',
    ...repositories,
    '',
    '从 [Workspace 使用指南](docs/repoctopus/workspace-guide.md) 开始：安装 CLI、新成员接入、启动和恢复 Change、配置 SigNoz。',
    '使用 Agent 时让它读取 [AGENTS.md](AGENTS.md)，并提供需求与已有 Run 身份。',
    '',
    '本区块由 Repoctopus 维护；团队自己的项目介绍和规则请写在区块外。',
  ].join('\n');
  const agents = [
    '## Repoctopus 工作流入口',
    '',
    '此 Workspace 使用 Repoctopus 管理受管 Change。先阅读 [本地指南](docs/repoctopus/workspace-guide.md) 和 `repoctopus.yaml`，核对参与仓库及验证 Profile。',
    '使用已安装的团队指定版本 CLI；PowerShell 用 `repoctopus.cmd`，其他终端用 `repoctopus`。临时 npx 用户沿用团队提供的固定版本前缀。',
    '',
    '- 已有 runId：先执行 `repoctopus.cmd run status --workspace . --run <runId> --json`；恢复使用同一身份的 `run resume`，再按返回的 continuation 处理。',
    '- 新任务：先确认新建还是恢复、Change ID 和团队目标分支，再按本地指南启动；身份不明时询问，不解析私有 Store 猜阶段，也不虚构 `run list` 或自动恢复探针。',
    '- 用 `run next` 请求当前 Action，按返回的参数领取 Work，读取执行包中的真实 Skill 内容，再完成当前 Work 并提交真实 Outcome。不要只看 Skill 名称或手工选择下一个阶段。',
    '- Human Decision：先用 `repoctopus.cmd run decision --workspace . --run <runId> --json` 读取材料与响应模板，优先使用宿主原生提问工具；没有原生工具则展示对话选项并等待真实答复，再用 `run decide --response-file <response.json>` 回传。没有答复不提交，明确委托必须仍覆盖当前提案。缺少真实用户上下文时才回退交互终端。',
    '- 决定结果未知时按原 requestId/proposalHash 查询，接受后按返回的下一步 argv 继续。未知副作用或 reconciliation 保留现场，不通过改状态文件、伪造成功或重放已确认副作用继续。',
    '- 验证使用 Runtime 派发的精确命令和参数；实现按各仓的 write scope 提交，不用 README 或本文件代替 Runtime 授权、验证结果及 OpenSpec 任务状态。',
    '- 用户明确指定其他工作流或已有团队规则时核对其适用范围，不把本区块当成覆盖用户明确选择的授权。',
    '',
    '项目约定和个人偏好写在本区块外；本区块由 Repoctopus 接入流程维护。',
  ].join('\n');
  const guide = [
    '# Workspace 使用指南',
    '',
    '面向团队成员。这里保存本项目的基本用法，完成初始化后不需要取得 Repoctopus 源码。',
    '返回 [Workspace README](../../README.md)；Agent 入口见 [AGENTS.md](../../AGENTS.md)。',
    '',
    '## 1. 准备 CLI',
    '',
    '准备 Git，以及 Node.js 22.16 或更新的 22.x，或 Node.js 24 及以上。安装团队指定版本的 CLI `.tgz`；可从 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 下载，或使用团队分发的同版本包。',
    '在下载包所在目录运行 `npm.cmd install --global --ignore-scripts --legacy-peer-deps ./repoctopus-<版本>.tgz`，把文件名替换为实际下载文件名，然后运行 `repoctopus.cmd --help`。全局安装后无需把包放在 Workspace。',
    '以下是 PowerShell 示例；其他终端将 `repoctopus.cmd` 换为 `repoctopus` 并采用对应的变量语法。使用 npx 时保留团队固定版本的调用前缀与后续相同参数。',
    '',
    '## 2. 认识当前项目',
    '',
    `Workspace ID：${code(config.workspace.id)}；Workspace 仓库 ID：${code(config.workspace.repositoryId)}。`,
    single
      ? '这是单仓布局，当前业务仓就是 Workspace。'
      : '这是多仓布局，请检出 Workspace 和本任务涉及的业务仓，按共享相对路径放置。',
    '',
    '| 仓库 ID | 共享相对路径 | 用途 |',
    '| --- | --- | --- |',
    ...repositories,
    '',
    store
      ? `团队 OpenSpec Store ID：${code(store.id)}。ID 属于团队配置，不是当前机器的路径。`
      : 'Specification Provider 与 Store 以 `repoctopus.yaml` 为准。',
    '共享配置在 `repoctopus.yaml`，OpenSpec 规格在 `openspec/`；Proposal、Specs、Design、Tasks 由同一 Specification Provider 管理。',
    '',
    '## 3. 新成员接入或补齐引导',
    '',
    '已有团队配置时不要重新拼装一份候选。进入 Workspace 根目录，确认父目录只包含参与项目的仓库；布局不同先在 `.repoctopus/local.yaml` 按逻辑仓库 ID 设置本机路径。执行下面的现有接入流程，以团队共享配置为候选：',
    '',
    fence + 'powershell',
    `$detected = repoctopus.cmd project detect --workspace . --scan-root ..${storeFlag} --json | ConvertFrom-Json`,
    '$prepared = repoctopus.cmd project prepare --workspace . --draft $detected.result.file --candidate repoctopus.yaml --json | ConvertFrom-Json',
    'repoctopus.cmd project review --workspace . --request $prepared.result.file',
    fence,
    '',
    '在真实交互终端核对仓库、Store 登记、pointer 和共享文件变更，再批准。已健康的规格根和精确登记会复用；不要删除已有 `openspec/`、配置或历史 Run。拒绝或请求修改不会安装引导。',
    '升级 CLI 后需要补齐或更新本指南时，也使用这一流程。重新执行已完成的旧请求只返回原结果，不会偷偷更新文档。',
    '',
    '## 4. 启动第一个 Change',
    '',
    '先把获批初始化的共享文件按团队 Git 流程提交并合入目标分支，确保各仓远端可用。以下命令在 Workspace 根目录执行，目标分支由团队确定，Change ID 使用英文 kebab-case：',
    '',
    fence + 'powershell',
    "$target = Read-Host '团队目标分支（例如 main）'",
    "$changeId = Read-Host '新的 Change ID'",
    'git switch $target',
    'git pull --ff-only origin $target',
    'git switch -c "change/$changeId"',
    'git push -u origin HEAD',
    '$started = repoctopus.cmd run start --workspace . --change $changeId --target $target --json | ConvertFrom-Json',
    '$runId = $started.runId',
    'repoctopus.cmd run status --workspace . --run $runId --json',
    fence,
    '',
    '把需求、Change ID、runId 和团队 CLI 调用方式交给 Agent，让它读取根 AGENTS 并按 `run next` 的 continuation 领取 Work。工作流按 Open → Design → Build → Verify → Archive 推进，人工决定与执行参数以 Runtime 当前返回为准。多仓任务的写入、分支和提交分别落在相关业务仓。',
    'Open 与 Design 完成后分别需要人工审查。Agent 应读取 `run decision --run <runId> --json`，展示材料、选择和必需隔离输入，再通过宿主原生提问或对话取得真实答复；随后按返回模板使用 `run decide --response-file` 提交。没有交互上下文时，在真实终端使用 `run decide --run <runId>`。Desktop 仅展示运行状态，不承接审批。',
    '',
    '## 5. 中断后从原进度继续',
    '',
    '使用启动输出中保存的 runId，不为恢复创建第二个 Run。在新终端进入 Workspace：',
    '',
    fence + 'powershell',
    "$runId = Read-Host '需要恢复的原 runId'",
    'repoctopus.cmd run status --workspace . --run $runId --json',
    'repoctopus.cmd run resume --workspace . --run $runId --json',
    fence,
    '',
    '把返回结果交给 Agent。同一 Run 的当前 Work、Skill、检查结果和待决定项由 Runtime 恢复；遇到未知结果或 reconciliation 先按提示核对。不要手改 `.repoctopus/runs/`，也不要因进程退出就重做已确认的操作。',
    '',
    '## 6. 配置与 SigNoz',
    '',
    '- `repoctopus.yaml`：团队共享的仓库、验证 Profile、Skill 和发布策略。',
    '- `.repoctopus/local.yaml`：本机仓库路径、端口等允许的覆盖，不提交到团队仓；不得降低团队必需验证。',
    '- `telemetry.endpoint`：在共享 YAML 指定团队 SigNoz 的 OTLP/HTTP Collector 基础地址。它不是 SigNoz Web 看板地址，不要自己拼 `/v1/traces` 等信号路径。',
    '',
    fence + 'yaml',
    'telemetry:',
    '  endpoint: https://collector.example.internal/otlp',
    fence,
    '',
    '把示例地址替换为团队 Collector 的实际基础 URL。发布凭据和 Collector Header 只通过启动 CLI/Agent 的进程环境提供；通用 OTEL 环境变量可覆盖 YAML，按团队运维约定检查生效值。保持产品既有遥测字段名，在 SigNoz 配置看板，不在这里改名。',
    '可用 `repoctopus.cmd evidence plan --workspace . --profile verify --json` 检查仓库和验证 Profile 是否能够解析。可选 Windows Desktop Dashboard 用于当前 Change 的观测；没有安装 Dashboard 仍可使用 CLI。',
    '',
    '## 7. 哪些文件需要共享',
    '',
    '- Workspace 提交 `repoctopus.yaml`、`openspec/`、`.openspec-store/`、`.gitignore` 和本次的 README、AGENTS、本地教程。',
    '- 获批生成的业务仓 `openspec/config.yaml` 在各自业务仓走 Git 评审；不要把业务实现提交到错误的仓库。',
    '- `.repoctopus/` 中的草稿、本机配置、Run、私有执行包和 Evidence 留在本机；凭据不写入共享文件。',
    '',
    '## 8. 文件冲突或接入中断',
    '',
    '引导只维护 Repoctopus 标记区块，团队内容保留在区块外。重复/残缺标记、符号链接、目录占位或并发修改会明确阻断，不会直接覆盖。先根据诊断处理冲突，再重试原未完成请求；部分引导已写入时会复用，不要删除 Store 或修改 journal 伪造成功。',
  ].join('\n');
  return [
    { file: WORKSPACE_GUIDE_FILES[0], tag: 'repoctopus-workspace', content: readme },
    { file: WORKSPACE_GUIDE_FILES[1], tag: 'repoctopus-workflow', content: agents },
    { file: WORKSPACE_GUIDE_FILES[2], tag: 'repoctopus-guide', content: guide },
  ];
}
