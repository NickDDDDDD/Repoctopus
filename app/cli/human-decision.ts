import { createInterface } from 'node:readline/promises';

import type {
  HumanDecision,
  HumanDecisionRequest,
  HumanDecisionRequestV3,
} from '../../domains/delivery/types.js';

export async function reviewHumanDecision(options: {
  request: HumanDecisionRequest | HumanDecisionRequestV3;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): Promise<{ decision: HumanDecision; comment?: string }> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    const deliveryCount =
      'businessDeliveries' in options.request
        ? options.request.businessDeliveries.length
        : options.request.repositories.length;
    options.output.write(
      `\nDelivery approval: ${options.request.changeId}\nSnapshot: ${options.request.snapshotDigest}\nBusiness deliveries: ${deliveryCount}\nActions: ${options.request.actions.length}\n\n1) Approve\n2) Request changes\n3) Reject\n`,
    );
    const answer = (await terminal.question('Decision [1-3]: ')).trim();
    const decision: HumanDecision =
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
