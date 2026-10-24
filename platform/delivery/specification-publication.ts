import { execute } from '../process/execute.js';
import { observeOrCreateMergeRequest } from '../../domains/delivery/stable-publication.js';
import type { MergeRequestPort } from '../../domains/delivery/ports.js';
import type {
  SpecificationPublicationRequest,
  SpecificationPublicationResult,
} from '../../domains/delivery/specification-publication.js';

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

export class SpecificationPublicationAdapter {
  constructor(private readonly mergeRequests: MergeRequestPort) {}

  async publish(request: SpecificationPublicationRequest): Promise<SpecificationPublicationResult> {
    if (request.closure.changeId !== request.changeId || request.closure.status !== 'closed') {
      throw new Error('Specification publication requires the matching Closure Receipt');
    }
    const sourceBranch = `repoctopus/archive/${request.changeId}-${request.closure.closureId.slice(7, 19)}`;
    await git(request.workspaceRoot, ['check-ref-format', '--branch', sourceBranch]);
    await git(request.workspaceRoot, ['add', '--all', '--', ...request.closure.changedFiles]);
    const staged = (await execute('git', ['diff', '--cached', '--name-only', '-z'], { cwd: request.workspaceRoot })).stdout
      .split('\0').filter(Boolean).map((item) => item.replaceAll('\\', '/')).sort();
    const expected = [...request.closure.changedFiles].map((item) => item.replaceAll('\\', '/')).sort();
    if (JSON.stringify(staged) !== JSON.stringify(expected)) {
      throw new Error('Specification publication diff escaped the Closure Receipt allowlist');
    }
    if (staged.length > 0) {
      await git(request.workspaceRoot, ['commit', '-m', `chore(spec): archive ${request.changeId}`]);
    }
    const publishedOid = await git(request.workspaceRoot, ['rev-parse', 'HEAD']);
    await git(request.workspaceRoot, ['push', request.remote, `HEAD:refs/heads/${sourceBranch}`]);
    const observedRemote = (await git(request.workspaceRoot, ['ls-remote', '--heads', request.remote, `refs/heads/${sourceBranch}`])).split(/\s+/u)[0];
    if (observedRemote !== publishedOid) throw new Error('Specification publication remote OID drifted');
    const mr = await observeOrCreateMergeRequest({
      port: this.mergeRequests,
      request: {
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
        title: request.title,
        body: request.body,
      },
      identity: {
        changeId: request.changeId,
        generation: request.generation,
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
        publishedOid,
      },
    });
    return {
      expectedPublishedOid: publishedOid,
      item: {
        publicationId: `specification:${request.changeId}:${request.generation}`,
        role: 'specification',
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        remote: request.remote,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
        publishedOid,
        mergeRequest: mr.identity,
        provenance: mr.provenance,
        verifiedAt: new Date().toISOString(),
      },
    };
  }
}
