import { createInterface } from 'node:readline/promises';
import { WORKSPACE_GUIDE_FILES } from '../../domains/project-configuration/workspace-guides.js';

import type {
  ProjectConfigurationDecision,
  ProjectConfigurationDecisionRequest,
} from '../../domains/project-configuration/onboarding.js';

export async function reviewProjectConfigurationDecision(options: {
  request: ProjectConfigurationDecisionRequest;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): Promise<{ decision: ProjectConfigurationDecision; comment?: string }> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    options.output.write(
      `\nProject configuration approval\nDraft: ${options.request.draftId}\nSnapshot: ${options.request.snapshotDigest}\nCandidate: ${options.request.candidateConfigDigest}\nUnresolved findings: ${options.request.unresolved.length}\nReconcile changed: ${options.request.reconcile?.changed ?? false}\nWorkspace guides: ${WORKSPACE_GUIDE_FILES.join(', ')}\nOnly Repoctopus managed blocks are installed or updated; team content is preserved.\n\n1) Approve\n2) Request changes\n3) Reject\n`,
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
