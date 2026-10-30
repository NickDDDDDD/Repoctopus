import { createInterface } from 'node:readline/promises';

import type {
  SpecificationApprovalDecision,
  SpecificationApprovalDecisionRequest,
} from '../../domains/specification/types.js';
import type { ExecutionIsolation } from '../../domains/change-lifecycle/build-protocol.js';

export async function reviewSpecificationApproval(options: {
  request: SpecificationApprovalDecisionRequest;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  selectIsolation?: boolean;
}): Promise<{
  decision: SpecificationApprovalDecision;
  comment?: string;
  isolation?: ExecutionIsolation;
}> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    options.output.write(
      `\nSpecification approval: ${options.request.changeId}\nProposal: ${options.request.proposalHash}\nChange branch: ${options.request.changeBranch.sourceBranch}\nArtifacts: ${options.request.artifacts.length}\nCapabilities: ${options.request.affectedCapabilities.length}\n\n1) Approve\n2) Revise\n3) Reject\n`,
    );
    const answer = (await terminal.question('Decision [1-3]: ')).trim();
    const decision: SpecificationApprovalDecision =
      answer === '1'
        ? 'approve'
        : answer === '2'
          ? 'revise'
          : answer === '3'
            ? 'reject'
            : (() => {
                throw new Error('Decision must be 1, 2, or 3');
              })();
    let isolation: ExecutionIsolation | undefined;
    if (options.selectIsolation && decision === 'approve') {
      options.output.write(
        '\nExecution isolation:\n1) Current checkout\n2) Branch checkout\n3) Linked worktree\n',
      );
      const isolationAnswer = (await terminal.question('Isolation [1-3]: ')).trim();
      isolation =
        isolationAnswer === '1'
          ? 'current'
          : isolationAnswer === '2'
            ? 'branch'
            : isolationAnswer === '3'
              ? 'worktree'
              : (() => {
                  throw new Error('Isolation must be 1, 2, or 3');
                })();
    }
    const comment = (await terminal.question('Comment (optional): ')).trim();
    return {
      decision,
      ...(isolation ? { isolation } : {}),
      ...(comment ? { comment } : {}),
    };
  } finally {
    terminal.close();
  }
}

export async function reviewHumanDecision(options: {
  title: string;
  proposalHash: string;
  details: readonly string[];
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  selectIsolation?: boolean;
}): Promise<{
  decision: SpecificationApprovalDecision;
  comment?: string;
  isolation?: ExecutionIsolation;
}> {
  const terminal = createInterface({ input: options.input, output: options.output });
  try {
    options.output.write(
      `\n${options.title}\nProposal: ${options.proposalHash}\n${options.details.join('\n')}\n\n1) Approve\n2) Revise\n3) Reject\n`,
    );
    const answer = (await terminal.question('Decision [1-3]: ')).trim();
    const decision: SpecificationApprovalDecision =
      answer === '1'
        ? 'approve'
        : answer === '2'
          ? 'revise'
          : answer === '3'
            ? 'reject'
            : (() => {
                throw new Error('Decision must be 1, 2, or 3');
              })();
    let isolation: ExecutionIsolation | undefined;
    if (options.selectIsolation && decision === 'approve') {
      options.output.write(
        '\nReplacement execution isolation:\n1) Current checkout\n2) Branch checkout\n3) Linked worktree\n',
      );
      const isolationAnswer = (await terminal.question('Isolation [1-3]: ')).trim();
      isolation =
        isolationAnswer === '1'
          ? 'current'
          : isolationAnswer === '2'
            ? 'branch'
            : isolationAnswer === '3'
              ? 'worktree'
              : (() => {
                  throw new Error('Isolation must be 1, 2, or 3');
                })();
    }
    const comment = (await terminal.question('Comment (optional): ')).trim();
    return {
      decision,
      ...(isolation ? { isolation } : {}),
      ...(comment ? { comment } : {}),
    };
  } finally {
    terminal.close();
  }
}
