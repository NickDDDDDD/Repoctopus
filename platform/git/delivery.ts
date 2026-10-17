import type {
  CheckpointResult,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryRepositoryIntent,
  PublicationAction,
} from '../../domains/delivery/types.js';
import type { RepositorySnapshot } from '../../domains/project/types.js';
import { execute } from '../process/execute.js';

function globPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}

function protectedBranch(branch: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globPattern(pattern).test(branch));
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function remoteOid(cwd: string, remote: string, branch: string): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const [oid] = output.split(/\s+/);
  return oid || null;
}

export class GitDeliveryAdapter {
  async checkpoint(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<CheckpointResult> {
    if (!policy.checkpoint.automatic) throw new Error('Automatic checkpoint commits are disabled');
    const branch = await git(repository.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be checkpointed: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    if (protectedBranch(branch, policy.checkpoint.protectedBranches))
      throw new Error(`Protected branch cannot be checkpointed: ${branch}`);
    const messagePattern = new RegExp(policy.checkpoint.commitMessagePattern);
    if (!messagePattern.test(intent.commitMessage))
      throw new Error(`Commit message does not match policy for ${repository.id}`);
    const checks = [
      ...(policy.checkpoint.quickChecks['*'] ?? []),
      ...(policy.checkpoint.quickChecks[repository.id] ?? []),
    ];
    const results: CheckpointResult['checks'] = [];
    for (const check of checks) {
      await execute(check.command, check.args, { cwd: repository.path });
      results.push({ command: check.command, passed: true });
    }
    const status = await git(repository.path, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);
    if (!status)
      return {
        repositoryId: repository.id,
        created: false,
        head: await git(repository.path, ['rev-parse', 'HEAD']),
        checks: results,
      };
    await git(repository.path, ['add', '--all']);
    await git(repository.path, ['commit', '-m', intent.commitMessage]);
    return {
      repositoryId: repository.id,
      created: true,
      head: await git(repository.path, ['rev-parse', 'HEAD']),
      checks: results,
    };
  }

  async inspect(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<DeliveryRepositoryFacts> {
    const branch = await git(repository.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be delivered: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    const head = await git(repository.path, ['rev-parse', 'HEAD']);
    const tree = await git(repository.path, ['rev-parse', 'HEAD^{tree}']);
    const status = await git(repository.path, [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
    ]);
    const remoteSourceOid = await remoteOid(
      repository.path,
      policy.publication.remote,
      intent.sourceBranch,
    );
    const remoteTargetOid = await remoteOid(
      repository.path,
      policy.publication.remote,
      intent.targetBranch,
    );
    if (!remoteTargetOid)
      throw new Error(
        `Remote target branch is missing for ${repository.id}: ${intent.targetBranch}`,
      );
    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      remoteIdentity: repository.remoteIdentity,
      sourceBranch: branch,
      targetBranch: intent.targetBranch,
      head,
      tree,
      remoteSourceOid,
      remoteTargetOid,
      clean: status.length === 0,
    };
  }

  async push(
    repository: RepositorySnapshot,
    action: PublicationAction,
    policy: DeliveryPolicy,
  ): Promise<string> {
    if (action.type !== 'git.push') throw new Error(`Unsupported Git action: ${action.type}`);
    const intent: DeliveryRepositoryIntent = {
      repositoryId: action.repositoryId,
      sourceBranch: action.sourceBranch,
      targetBranch: action.targetBranch,
      commitMessage: 'not-used',
      actions: ['push'],
    };
    const facts = await this.inspect(repository, intent, policy);
    if (facts.head !== action.expectedHead)
      throw new Error(`Local HEAD drifted for ${repository.id}`);
    if (facts.remoteTargetOid !== action.expectedRemoteTargetOid)
      throw new Error(`Remote target drifted for ${repository.id}`);
    if (facts.remoteSourceOid !== action.expectedRemoteSourceOid) {
      if (facts.remoteSourceOid === facts.head) return facts.head;
      throw new Error(`Remote source drifted for ${repository.id}`);
    }
    if (facts.remoteSourceOid === facts.head) return facts.head;
    await git(repository.path, [
      'push',
      policy.publication.remote,
      `${action.sourceBranch}:refs/heads/${action.sourceBranch}`,
    ]);
    const published = await remoteOid(
      repository.path,
      policy.publication.remote,
      action.sourceBranch,
    );
    if (published !== facts.head)
      throw new Error(`Remote source verification failed for ${repository.id}`);
    return published;
  }
}
