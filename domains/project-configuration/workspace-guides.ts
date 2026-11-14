import { WORKSPACE_ENTRY_DIRECTORIES, WORKSPACE_ENTRY_HOSTS } from './entry-skills.js';
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

export function renderWorkspaceGuides(
  config: SharedProjectConfig,
  versions: { product: string; openSpec: string },
): WorkspaceGuide[] {
  const single = config.repositories.length === 1;
  const openSpec =
    (config.specificationProvider?.id ?? 'specification-openspec') === 'specification-openspec';
  const store = openSpec ? config.specificationProvider?.store : undefined;
  const storeFlag = store ? ` --store '${store.id.replaceAll("'", "''")}'` : '';
  const storeArgument = store ? `'${store.id.replaceAll("'", "''")}'` : '';
  const openspec = `npx.cmd --yes --package=@fission-ai/openspec@${versions.openSpec} openspec`;
  const releaseTree = `https://github.com/NickDDDDDD/Repoctopus/blob/v${versions.product}`;
  const hosts = WORKSPACE_ENTRY_HOSTS.map((host) => {
    const { label, workspace, personal } = WORKSPACE_ENTRY_DIRECTORIES[host];
    return `| ${label} | ${code(host)} | ${code(`${workspace}/skills/`)} | ${code(`~/${personal}/skills/`)} |`;
  });
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
      : '这里是团队多仓开发的入口。团队在此维护共享配置和规格，实现提交到各自的登记仓库。',
    '',
    '| 仓库 ID | 共享相对路径 | 用途 |',
    '| --- | --- | --- |',
    ...repositories,
    '',
    '用团队指定的 CLI 版本，在宿主中打开此 Workspace，调用 `repoctopus` Skill。新 Change 提供需求、Change ID 和目标分支，继续已有工作则提供原 Run ID。',
    '安装 CLI、加入团队、配置 Verify 或 SigNoz，请阅读 [Workspace 使用指南](docs/repoctopus/workspace-guide.md)。Agent 的约定见 [AGENTS.md](AGENTS.md)。',
    '',
    '本区块由 Repoctopus 维护；团队自己的项目介绍和规则请写在区块外。',
  ].join('\n');
  const agents = [
    '## Repoctopus 工作流入口',
    '',
    '先阅读 [本地指南](docs/repoctopus/workspace-guide.md) 和 `repoctopus.yaml`，核对参与仓库及已有的 Verify Profile。',
    '使用已安装的团队指定版本 CLI；PowerShell 用 `repoctopus.cmd`，其他终端用 `repoctopus`。临时 npx 用户沿用团队提供的固定版本前缀。',
    '',
    '- 已有 runId：先执行 `repoctopus.cmd run status --workspace . --run <runId> --json`；恢复使用同一身份的 `run resume`，再按返回的 continuation 处理。',
    '- 新任务：先确认新建还是恢复、Change ID 和团队目标分支，再按本地指南启动；身份不明时询问，不解析私有 Store 猜阶段，也不虚构 `run list` 或自动恢复探针。',
    `- 在 Workspace 的新会话调用已安装的 Repoctopus Skill。宿主包括 ${WORKSPACE_ENTRY_HOSTS.map((host) => WORKSPACE_ENTRY_DIRECTORIES[host].label).join('、')}。`,
    '- 用 `run next` 请求当前 Action，按返回的参数领取 Work，取得执行权后再读取执行包的 Skill 正文和资源。引用层优先用当前 claim 参数调用 `run work-content`，或由宿主核对实际加载路径和 SHA-256。按原 invocation、packet 和实际读取的层提交 Outcome。',
    '- Human Decision：先用 `repoctopus.cmd run decision --workspace . --run <runId> --json` 读取材料与响应模板，优先使用宿主原生提问工具；没有原生工具则展示对话选项并等待真实答复，再用 `run decide --response-file <response.json>` 回传。没有答复不提交，明确委托必须仍覆盖当前提案。缺少真实用户上下文时才回退交互终端。',
    '- 决定结果未知时按原 requestId/proposalHash 查询，接受后按返回的下一步 argv 继续。未知副作用或 reconciliation 保留现场，不通过改状态文件、伪造成功或重放已确认副作用继续。',
    '- 缺少 Verify Profile 时，在当前 Workspace 调用 `repoctopus-configure-verify`，提供待续跑的 Run ID（`project configure-verify --run`）。配置获批并提交后恢复原 Run。',
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
    '## 准备 CLI',
    '',
    '准备 Git，以及 Node.js 22.16 或更新的 22.x，或 Node.js 24 及以上。安装团队指定版本的 CLI `.tgz`；可从 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 下载，或使用团队分发的同版本包。',
    '在下载包所在目录运行 `npm.cmd install --global --ignore-scripts --legacy-peer-deps ./repoctopus-<版本>.tgz`，把文件名替换为实际下载文件名，然后运行 `repoctopus.cmd --help`。全局安装后无需把包放在 Workspace。',
    `以下以 PowerShell 为例。其他终端使用 \`repoctopus\` 和对应的变量语法。使用固定 .tgz URL 或临时 npx 的方法见 [CLI 安装指南](${releaseTree}/docs/install.md)。`,
    '',
    '## 认识当前 Workspace',
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
    '共享配置在 `repoctopus.yaml`。Proposal、Specs、Design、Tasks 由团队的 Specification Provider 管理。',
    ...(openSpec ? ['OpenSpec 将规格保存在 `openspec/`。'] : []),
    '',
    '## 首次接入',
    '',
    '在终端为维护者使用的宿主安装个人 Init Skill。下面以 Codex 为例，其他宿主的选项见下一节。',
    '',
    fence + 'powershell',
    'repoctopus.cmd skill install-init --entry-hosts codex',
    fence,
    '',
    '单仓在宿主打开业务仓 Git 根。多仓打开独立 Workspace Git 根，把参与项目的业务仓检出到同一个父目录。各仓至少要有一个提交。',
    '在新会话调用 `repoctopus-init`，说明布局和业务仓，核对配置信息后批准。使用终端时，按布局在 Workspace 根选一条命令，再审查该请求。多仓示例选择 `web` 和 `backend`。需要查询实际仓库 ID 时，先运行 `repoctopus.cmd project detect --layout multi --scan-root .. --json`。',
    '',
    fence + 'powershell',
    '# 单仓',
    '$prepared = repoctopus.cmd project init --layout single --entry-hosts codex --json | ConvertFrom-Json',
    '# 多仓',
    '$prepared = repoctopus.cmd project init --layout multi --scan-root .. --repositories web,backend --entry-hosts codex --json | ConvertFrom-Json',
    'repoctopus.cmd project review --request $prepared.result.file',
    fence,
    '',
    '批准前核对仓库、Store、可选业务仓指向和 Skill 安装范围。初始化写入可启动工作流的最小配置，Verify 在开发中按需单独配置。',
    '',
    '## 加入已有团队',
    '',
    '检出已接入的 Workspace 和所需的业务仓，使用团队指定的 CLI。本机目录与共享布局不同时，在 `.repoctopus/local.yaml` 的 `repositoryPaths` 中按仓库 ID 指定实际路径。',
    ...(store
      ? [
          '在 Workspace 根登记本机 OpenSpec Store。以下命令适用于已提交完整规格与 Store metadata、且本机未登记的 Workspace。若登记已存在，先用 context 核对路径。',
          '',
          fence + 'powershell',
          `${openspec} store register . --id ${storeArgument} --json`,
          `${openspec} context --store ${storeArgument} --json`,
          fence,
          '',
          '确认 context 返回当前 Workspace 的路径和团队 Store ID。登记只写本机 registry。出现冲突时请团队核对 ID 和 checkout。',
        ]
      : ['按照团队 Specification Provider 的要求准备本机访问。沿用团队共享配置。']),
    '',
    '团队已提交目标宿主的 Skill 时，在此 Workspace 开新会话使用。缺少宿主相关文件时，按下一节补装。',
    '',
    '## 安装宿主 Skill',
    '',
    '| 宿主 | Host ID | Workspace Skill 目录 | 个人 Init 默认目录 |',
    '| --- | --- | --- | --- |',
    ...hosts,
    '',
    '个人目录安装 `repoctopus-init`。CLI 会检查 Codex 的 `CODEX_HOME`、OpenCode 的 `XDG_CONFIG_HOME` 下的 `opencode/` 和 CodeBuddy Code 的 `CODEBUDDY_CONFIG_DIR`，使用用户目录内的对应位置。',
    `获批的 Workspace 初始化或补装会安装 \`repoctopus\`、\`repoctopus-configure-verify\`、阶段 Action 和 Matt Skills。${openSpec ? '这个 Workspace 也会安装只读的 `openspec-explore`。' : ''}`,
    '已有 Workspace 可只补装所选宿主的 Skill。以下以 CodeArts 码道为例。检查预览后批准，再在宿主中打开新的 Workspace 会话。',
    '',
    fence + 'powershell',
    '$prepared = repoctopus.cmd project install-entry-skills --entry-hosts codearts --json | ConvertFrom-Json',
    'repoctopus.cmd project review --request $prepared.result.file',
    fence,
    '',
    '提交所选宿主新增或更新的 `skills/` 文件（含资源），以及与 `skills/` 同级的 `.repoctopus-workflow-skills/` 管理记录。团队可复用已提交的文件。',
    `更多安装和发现方法见 [Skills 接入](${releaseTree}/docs/skills.md#在宿主中调用-repoctopus)。`,
    '',
    '## 刷新已有 Workspace 的引导',
    '',
    '升级 CLI 后，从 Workspace 根创建新的接入审批。使用现有的 `repoctopus.yaml` 作候选，并从上表选择本次纳入的 Host ID，可用逗号分隔。',
    ...(single
      ? []
      : [
          '多仓刷新要求 Workspace 和各登记仓都是扫描根的直接子目录。使用符合该布局的 checkout，再核对探测结果。',
        ]),
    '',
    fence + 'powershell',
    "$entryHosts = Read-Host '本次接入使用的 Host ID'",
    `$detected = repoctopus.cmd project detect --layout ${single ? 'single --scan-root .' : 'multi --scan-root ..'} --entry-hosts $entryHosts${storeFlag} --json | ConvertFrom-Json`,
    '$prepared = repoctopus.cmd project prepare --draft $detected.result.file --candidate repoctopus.yaml --json | ConvertFrom-Json',
    'repoctopus.cmd project review --request $prepared.result.file',
    fence,
    '',
    '批准前核对配置、登记、可选业务仓指向、所选宿主与引导文件的范围。引导更新限于三个 Workspace 文件中的 Repoctopus 受管区块。团队正文保留在区块外。已完成请求可以查询原结果，刷新引导需要新审批。',
    '',
    '## 启动和恢复 Change',
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
    fence,
    '',
    '在宿主的新 Workspace 会话调用 `repoctopus` Skill，提供需求、Change ID 和目标分支。保存返回的 Run ID。换进程或会话时，调用同一个 Skill 并给出原 Run ID。',
    'Runtime 按 Open → Design → Build → Verify → Archive 派发当前 Action。Open 与 Design 分别审查。宿主优先通过原生选项取得真实答复，用当前请求的响应模板回传。需要自行操作时，在交互终端运行 `repoctopus.cmd run decide --run <run-id>`。',
    '',
    '也可在终端显式启动。启动后把需求与 Run ID 交给 Agent，通过 Workspace Skill 继续。',
    '',
    fence + 'powershell',
    '$started = repoctopus.cmd run start --workspace . --change $changeId --target $target --json | ConvertFrom-Json',
    '$started.runId',
    fence,
    '',
    '需要终端恢复时，在 Workspace 根使用原 Run ID。',
    '',
    fence + 'powershell',
    "$runId = Read-Host '需要恢复的原 runId'",
    'repoctopus.cmd run status --workspace . --run $runId --json',
    'repoctopus.cmd run resume --workspace . --run $runId --json',
    fence,
    '',
    '按返回的 continuation 恢复当前 Work、Skill 或审批。遇到未知结果时，先根据诊断核对已发生的动作并保留原 Run。',
    '',
    '## 配置 Verify 与交付',
    '',
    '缺少 Verify Profile 时，Run 可先通过 Build Check，再等待配置。在 Workspace 调用 `repoctopus-configure-verify`，提供原 Run ID。审查候选中的实际构建、测试命令、所属仓库和覆盖的验收标准。',
    '在终端操作时，从共享配置示例的 `profiles` 提取一个 Profile 对象另存为本机候选文件。文件顶层是 `id` 和 `nodes`。沿用当前 Run 等待的 Profile ID，按实际验收范围填写必需节点的 `covers`。',
    '',
    fence + 'powershell',
    "$runId = Read-Host '等待 Verify 配置的原 Run ID'",
    "$profileFile = Read-Host '本机 Profile 候选文件路径'",
    '$prepared = repoctopus.cmd project configure-verify --candidate $profileFile --run $runId --json | ConvertFrom-Json',
    'repoctopus.cmd project review --request $prepared.result.file',
    fence,
    '',
    '按团队流程提交获批配置后恢复原 Run，由 Runtime 执行正式 Verify。已有 Profile 时，可用 `repoctopus.cmd evidence plan --workspace . --profile verify --json` 预览命令和覆盖。',
    `配置字段与候选见 [共享配置 Schema](${releaseTree}/docs/schemas/project-config.schema.json)、[项目配置示例](${releaseTree}/docs/examples/repoctopus.yaml)和 [Evidence 指南](${releaseTree}/docs/evidence.md)。`,
    `Verify 成功后，按 Runtime 派发的 Archive 步骤审查并交付。各仓实现和对应的 MR 落在所属仓库，规格归档通过 Workspace 交付。按团队约定在托管平台审查与合入。[交付指南](${releaseTree}/docs/delivery.md)`,
    '',
    '## 接入团队 SigNoz',
    '',
    '在 Workspace 的 `repoctopus.yaml` 中设置 `telemetry.endpoint`，填写团队的 OTLP/HTTP Collector 基础地址。保留网关需要的路径前缀，省略 `/v1/logs` 等信号后缀。',
    '',
    fence + 'yaml',
    'telemetry:',
    '  endpoint: https://collector.example.internal/otlp',
    fence,
    '',
    '默认远端上报工作流健康事件和必要的诊断 Logs。在启动 CLI 或宿主的进程环境设置 `REPOCTOPUS_OTLP_DIAGNOSTICS=full`，可同时排查 Logs、Traces 和 Metrics。认证 Header 由进程环境提供。OTEL 端点环境变量优先于共享 YAML。',
    '跑一次真实 Change 后，在 SigNoz Logs Explorer 按服务名（默认 `repoctopus-runtime`）和 `repoctopus.run.id` 核对收到的事件。',
    `在 SigNoz v0.135.0 或更新版本通过 **Dashboards → New dashboard → Import JSON** 导入 \`deploy/signoz/workflow-health.json\`。可从 CLI 安装包提取，或从 [对应 Git Tag 的 JSON](${releaseTree}/deploy/signoz/workflow-health.json) 下载。全局 npm 安装时，PowerShell 可用以下命令定位文件。`,
    '',
    fence + 'powershell',
    "Join-Path (npm.cmd root --global) 'repoctopus/deploy/signoz/workflow-health.json'",
    fence,
    '',
    '从团队分发的包提取时，在包所在目录执行下列命令，文件名使用实际版本。导入提取后的 `package/deploy/signoz/workflow-health.json`。',
    '',
    fence + 'powershell',
    `tar -xzf ./repoctopus-${versions.product}.tgz package/deploy/signoz/workflow-health.json`,
    fence,
    '',
    '看板按唯一 Run 汇总启动量和 Build 配置分布，统计终态失败率、未到终态占比及所在阶段，并按回退路径展示已完成 Run 的平均回退次数。',
    `字段、信号优先级和指标公式见 [SigNoz 接入](${releaseTree}/docs/telemetry.md)和 [遥测字段参考](${releaseTree}/docs/telemetry-reference.md)。`,
    `从同一 Release 安装可选的 Windows x64 Desktop Dashboard，可在本地查看当前 Change 的实时阶段和进度。团队在 SigNoz 查看历史和趋势。 [Desktop 安装和激活](${releaseTree}/docs/desktop-activation.md)`,
    '',
    '## 哪些文件需要共享',
    '',
    '- Workspace 提交 `repoctopus.yaml`、`.gitignore`、README、AGENTS、本地教程及获批的宿主 Skill、资源和管理记录。',
    ...(openSpec
      ? [
          '- OpenSpec 的 `openspec/` 和 `.openspec-store/` 在 Workspace 提交。获批生成的 `openspec/config.yaml` 指向文件在其所属业务仓提交。',
        ]
      : []),
    '- `.repoctopus/` 中的草稿、本机配置、Run、私有执行包和 Evidence 留在本机。发布凭据和 Collector Header 由进程环境提供。',
    '',
    '## 文件冲突或接入中断',
    '',
    '引导只维护 Repoctopus 标记区块，团队内容保留在区块外。重复/残缺标记、符号链接、目录占位或并发修改会明确阻断，不会直接覆盖。先根据诊断处理冲突，再重试原未完成请求；部分引导已写入时会复用，不要删除 Store 或修改 journal 伪造成功。',
  ].join('\n');
  return [
    { file: WORKSPACE_GUIDE_FILES[0], tag: 'repoctopus-workspace', content: readme },
    { file: WORKSPACE_GUIDE_FILES[1], tag: 'repoctopus-workflow', content: agents },
    { file: WORKSPACE_GUIDE_FILES[2], tag: 'repoctopus-guide', content: guide },
  ];
}
