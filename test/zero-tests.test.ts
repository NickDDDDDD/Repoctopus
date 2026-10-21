import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceService } from '../domains/evidence/service.js';
import { parseTestExecution } from '../domains/evidence/test-output.js';
import { compileEvidenceProfile } from '../domains/feedback/profile.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import {
  removeTemporaryDirectory,
  temporaryDirectory,
  TEST_COMPOSITION_DIGEST,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function config(
  workspace: string,
  zeroTests: 'warning' | 'blocking',
  output: string,
): EffectiveProjectConfig {
  return {
    shared: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'zero-tests', repositoryId: 'app' },
      repositories: [{ id: 'app', path: '.' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'tests',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', `process.stdout.write(${JSON.stringify(output)})`],
              timeoutMs: 5000,
              cache: false,
              zeroTests,
            },
          ],
        },
      ],
    },
    local: null,
    repositories: [{ id: 'app', path: '.', resolvedPath: workspace }],
    sharedDigest: 'shared',
    localDigest: null,
    effectiveDigest: 'effective',
  };
}

async function run(zeroTests: 'warning' | 'blocking', output: string) {
  const workspace = await temporaryDirectory('repoctopus-zero-tests-');
  cleanup.push(workspace);
  return new EvidenceService(
    new FileArtifactStore(workspace),
    new FileEvidenceStore(workspace),
    new LocalCommandAdapter(),
  ).run(compileEvidenceProfile(config(workspace, zeroTests, output), 'verify'), 'fingerprint', {
    compositionDigest: TEST_COMPOSITION_DIGEST,
  });
}

describe('zero test detection', () => {
  it('parses npm ecosystem and Maven summaries without treating zero as a pass', async () => {
    expect(parseTestExecution('Tests:       0 total')).toMatchObject({
      framework: 'jest',
      executed: 0,
    });
    expect(parseTestExecution('Tests run: 0, Failures: 0, Errors: 0, Skipped: 0')).toMatchObject({
      framework: 'maven-surefire',
      executed: 0,
    });
    expect(parseTestExecution('[INFO] No tests to run.')).toMatchObject({
      framework: 'maven-surefire',
      executed: 0,
    });

    const warning = await run('warning', 'Tests: 0 total');
    expect(warning.bundle.outcome).toBe('passed_with_warnings');
    expect(warning.receipts[0]).toMatchObject({
      status: 'passed',
      findings: [{ code: 'no-tests-detected', severity: 'warning' }],
    });

    const blocking = await run('blocking', 'Tests run: 0, Failures: 0, Errors: 0, Skipped: 0');
    expect(blocking.bundle.outcome).toBe('incomplete');
    expect(blocking.receipts[0]).toMatchObject({
      status: 'incomplete',
      findings: [{ code: 'no-tests-detected', severity: 'error' }],
    });
  });

  it('does not invent a count when the command has no recognized test summary', () => {
    expect(parseTestExecution('build completed successfully')).toBeNull();
  });
});
