import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceService } from '../domains/evidence/service.js';
import { compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function config(
  workspace: string,
  nodes: EffectiveProjectConfig['shared']['profiles'][number]['nodes'],
): EffectiveProjectConfig {
  return {
    shared: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusProject',
      project: { id: 'sample' },
      repositories: [{ id: 'workspace', path: '.' }],
      profiles: [{ id: 'verify', nodes }],
    },
    local: null,
    repositories: [{ id: 'workspace', path: '.', resolvedPath: workspace }],
    sharedDigest: 'shared',
    localDigest: null,
    effectiveDigest: 'effective',
  };
}

function command(
  id: string,
  script: string,
  options: { dependsOn?: string[]; required?: boolean } = {},
): EffectiveProjectConfig['shared']['profiles'][number]['nodes'][number] {
  return {
    id,
    type: 'command',
    repository: 'workspace',
    dependsOn: options.dependsOn ?? [],
    required: options.required ?? true,
    executable: process.execPath,
    args: ['-e', script],
    timeoutMs: 5000,
    cache: false,
  };
}

describe('evidence command vertical slice', () => {
  it('persists receipts and artifacts while blocking only dependent nodes', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        command('build', "process.stdout.write('built'); process.exit(2)"),
        command('browser', "process.stdout.write('should not run')", { dependsOn: ['build'] }),
        command('backend', "process.stderr.write('healthy')"),
      ]),
      'verify',
    );
    const store = new FileEvidenceStore(workspace);
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      store,
      new LocalCommandAdapter(),
    ).run(plan, 'fingerprint-1');

    expect(result.bundle.outcome).toBe('failed');
    expect(result.bundle.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'build', status: 'failed' }),
        expect.objectContaining({ nodeId: 'browser', status: 'blocked', blockedBy: ['build'] }),
        expect.objectContaining({ nodeId: 'backend', status: 'passed', trust: 'verified' }),
      ]),
    );
    expect(result.receipts.map((receipt) => receipt.nodeId).sort()).toEqual(['backend', 'build']);
    expect(result.bundle.artifactDigests).toHaveLength(2);
    expect((await store.loadBundle(result.bundle.bundleId)).outcome).toBe('failed');
  });

  it('returns passed_with_warnings for an optional command failure', async () => {
    const workspace = await temporaryDirectory('repoctopus-evidence-warning-');
    cleanup.push(workspace);
    const plan = compileEvidenceProfile(
      config(workspace, [
        command('required', 'process.exit(0)'),
        command('optional', 'process.exit(1)', { required: false }),
      ]),
      'verify',
    );
    const result = await new EvidenceService(
      new FileArtifactStore(workspace),
      new FileEvidenceStore(workspace),
      new LocalCommandAdapter(),
    ).run(plan, 'fingerprint-2');
    expect(result.bundle.outcome).toBe('passed_with_warnings');
  });
});
