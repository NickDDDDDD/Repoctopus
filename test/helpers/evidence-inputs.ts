import {
  createEvidenceDependencyRecord,
  type EvidenceDependencySubjectKind,
} from '../../domains/evidence/dependencies.js';
import {
  createEvidenceNodeInputSnapshot,
  evidenceInputDigest,
} from '../../domains/evidence/input-snapshot.js';

export function evidenceDependencyFixture(
  subjectKind: EvidenceDependencySubjectKind,
  subjectId: string,
) {
  return createEvidenceDependencyRecord({
    subjectKind,
    subjectId,
    dependencies: [
      { partition: 'implementation-content', identity: evidenceInputDigest('test-input') },
    ],
  });
}

export function evidenceNodeInputFixture(nodeId = 'test') {
  return createEvidenceNodeInputSnapshot({
    node: {
      id: nodeId,
      type: 'command',
      repository: 'workspace',
      repositoryPath: '.',
      executable: 'node',
      args: [],
      dependsOn: [],
      required: true,
      cache: false,
      timeoutMs: 1000,
    },
    repositories: [],
    executionIdentity: 'test-adapter',
    environmentDigest: evidenceInputDigest([]),
    derivedFrom: [],
    outputs: [],
  });
}
