import { describe, expect, it } from 'vitest';

import { failureEnvelope } from '../app/cli/envelope.js';

describe('CLI failure envelope', () => {
  it('preserves a bounded public Runtime error code', () => {
    const error = Object.assign(new Error('local diagnostic'), {
      code: 'runtime.workspace-binding-conflict',
    });
    expect(failureEnvelope('run start', error).diagnostics[0]).toMatchObject({
      code: 'runtime.workspace-binding-conflict',
    });
  });

  it('does not expose arbitrary error codes', () => {
    const error = Object.assign(new Error('local diagnostic'), { code: 'SECRET_BRANCH_NAME' });
    expect(failureEnvelope('run start', error).diagnostics[0]).toMatchObject({
      code: 'cli.command-failed',
    });
  });
});
