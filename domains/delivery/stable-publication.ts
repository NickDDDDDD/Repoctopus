import type { MergeRequestInput, MergeRequestPort } from './ports.js';
import type { PublicationProvenance } from './publication-receipt.js';
import type { MergeRequestIdentity, MergeRequestStatus } from './types.js';

export interface StablePublicationIdentity {
  changeId: string;
  runId: string;
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  publishedOid: string;
}

export interface StableMergeRequestResult {
  identity: MergeRequestIdentity;
  status: MergeRequestStatus;
  provenance: PublicationProvenance;
}

function assertExactStatus(status: MergeRequestStatus, expected: StablePublicationIdentity): void {
  if (
    status.repositoryId !== expected.repositoryId ||
    status.sourceBranch !== expected.sourceBranch ||
    status.targetBranch !== expected.targetBranch ||
    status.headCommit !== expected.publishedOid
  ) {
    throw new Error(
      `Merge request does not match exact repository/head/base/head OID: ${expected.repositoryId}`,
    );
  }
}

async function observe(
  port: MergeRequestPort,
  request: MergeRequestInput,
  expected: StablePublicationIdentity,
): Promise<Array<{ identity: MergeRequestIdentity; status: MergeRequestStatus }>> {
  const identities = port.findAll
    ? await port.findAll(request)
    : await (async () => {
        const identity = await port.find(request);
        return identity ? [identity] : [];
      })();
  const observed = await Promise.all(
    identities.map(async (identity) => ({ identity, status: await port.status(identity) })),
  );
  const exact = observed.filter(({ status }) => {
    try {
      assertExactStatus(status, expected);
      return true;
    } catch {
      return false;
    }
  });
  if (observed.length > 0 && exact.length === 0) {
    throw new Error(
      `Merge request candidates exist but none match the exact published OID: ${expected.repositoryId}`,
    );
  }
  if (exact.length > 1) {
    throw new Error(`Merge request publication is ambiguous: ${expected.repositoryId}`);
  }
  return exact;
}

export async function observeOrCreateMergeRequest(input: {
  port: MergeRequestPort;
  request: MergeRequestInput;
  identity: StablePublicationIdentity;
}): Promise<StableMergeRequestResult> {
  const existing = await observe(input.port, input.request, input.identity);
  if (existing.length === 1) {
    return { ...existing[0]!, provenance: 'human-created' };
  }

  let created: MergeRequestIdentity;
  try {
    created = await input.port.create(input.request);
  } catch (error) {
    const recovered = await observe(input.port, input.request, input.identity);
    if (recovered.length !== 1) throw error;
    return { ...recovered[0]!, provenance: 'recovered' };
  }
  const status = await input.port.status(created);
  assertExactStatus(status, input.identity);
  return { identity: created, status, provenance: 'runtime-created' };
}
