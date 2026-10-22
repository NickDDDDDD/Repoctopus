import { createInterface } from 'node:readline/promises';

import type {
  SpecificationApprovalDecision,
  SpecificationApprovalDecisionRequest,
} from '../../domains/specification/types.js';

export async function reviewSpecificationApproval(options: {
  request: SpecificationApprovalDecisionRequest;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): Promise<{ decision: SpecificationApprovalDecision; comment?: string }> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    options.output.write(
      `\nSpecification approval: ${options.request.changeId}\nSnapshot: ${options.request.snapshotDigest}\nChange branch: ${options.request.changeBranch.sourceBranch}\nArtifacts: ${options.request.artifacts.length}\nCapabilities: ${options.request.affectedCapabilities.length}\n\n1) Approve\n2) Request changes\n3) Reject\n`,
    );
    const answer = (await terminal.question('Decision [1-3]: ')).trim();
    const decision: SpecificationApprovalDecision =
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
