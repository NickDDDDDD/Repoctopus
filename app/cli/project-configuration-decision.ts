import { createInterface } from 'node:readline/promises';
import { WORKSPACE_GUIDE_FILES } from '../../domains/project-configuration/workspace-guides.js';

import type {
  ProjectConfigurationDecision,
  ProjectConfigurationDecisionRequest,
  ProjectConfigurationDecisionResponse,
} from '../../domains/project-configuration/onboarding.js';

export function parseProjectConfigurationResponse(
  value: unknown,
): ProjectConfigurationDecisionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a project configuration Human Decision response object');
  }
  const item = value as Record<string, unknown>;
  const allowed = ['apiVersion', 'kind', 'requestId', 'snapshotDigest', 'decision', 'comment'];
  if (
    Object.keys(item).some((key) => !allowed.includes(key)) ||
    item.apiVersion !== 'repoctopus/v1alpha1' ||
    item.kind !== 'HumanDecisionResponse' ||
    typeof item.requestId !== 'string' ||
    !item.requestId ||
    typeof item.snapshotDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(item.snapshotDigest) ||
    !['approve', 'request_changes', 'reject'].includes(String(item.decision)) ||
    (item.comment !== undefined && typeof item.comment !== 'string')
  ) {
    throw new Error('Invalid project configuration Human Decision response');
  }
  return item as unknown as ProjectConfigurationDecisionResponse;
}

export async function reviewProjectConfigurationDecision(options: {
  request: ProjectConfigurationDecisionRequest;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): Promise<{ decision: ProjectConfigurationDecision; comment?: string }> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    const plan = options.request.entryInstall
      ? { workspace: options.request.entryInstall.workspaceRoot, scope: 'Workspace entry Skills' }
      : options.request.profileUpdate
        ? {
            profile: options.request.candidateConfig.profiles.find(
              ({ id }) => id === options.request.profileUpdate?.profileId,
            ),
            workspace: options.request.profileUpdate.workspaceRoot,
          }
        : {
            workspace: options.request.storeBinding?.workspaceRoot,
            repositories: options.request.candidateConfig.repositories,
            store: options.request.storeBinding,
            reconcile: options.request.reconcile,
          };
    options.output.write(`${JSON.stringify(plan, null, 2)}\n`);
    const entrySkills = (options.request.entrySkills ?? []).map(
      ({ host, path, status, diagnostic }) =>
        `  ${host}: ${status} ${path}${diagnostic ? ` — ${diagnostic}` : ''}`,
    );
    const guides = options.request.storeBinding
      ? `Workspace guides: ${WORKSPACE_GUIDE_FILES.join(', ')}\nOnly Repoctopus managed blocks are installed or updated; team content is preserved.\n`
      : '';
    options.output.write(
      `\nProject configuration approval\nDraft: ${options.request.draftId}\nSnapshot: ${options.request.snapshotDigest}\nCandidate: ${options.request.candidateConfigDigest}\nUnresolved findings: ${options.request.unresolved.length}\nReconcile changed: ${options.request.reconcile?.changed ?? false}\n${guides}Workspace Skills:\n${entrySkills.join('\n') || '  (none)'}\n\n1) Approve\n2) Request changes\n3) Reject\n`,
    );
    const answer = (await terminal.question('Decision [1-3]: ')).trim();
    const decision: ProjectConfigurationDecision =
      answer === '1'
        ? 'approve'
        : answer === '2'
          ? 'request_changes'
          : answer === '3'
            ? 'reject'
            : (() => {
                throw new Error('Decision must be 1, 2, or 3');
              })();
    const comment = (await terminal.question('Comment (optional): ')).trim();
    return { decision, ...(comment ? { comment } : {}) };
  } finally {
    terminal.close();
  }
}
