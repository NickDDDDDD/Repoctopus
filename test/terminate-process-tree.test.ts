import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectProcessOwnership } from '../platform/process/process-identity.js';
import { terminateRecoveredProcessTree } from '../platform/process/terminate-process-tree.js';

vi.mock('../platform/process/process-identity.js', () => ({
  inspectProcessOwnership: vi.fn(),
}));

const inspectOwnership = vi.mocked(inspectProcessOwnership);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  inspectOwnership.mockReset();
});

describe('recovered POSIX process-tree termination', () => {
  it('reports terminated only after ownership confirms the process exited', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockReturnValue(true);
    inspectOwnership
      .mockResolvedValueOnce('matched')
      .mockResolvedValueOnce('matched')
      .mockResolvedValueOnce('not_running');

    const result = terminateRecoveredProcessTree(4_242, 'linux:boot:started');
    await vi.advanceTimersByTimeAsync(20);

    await expect(result).resolves.toBe('terminated');
  });

  it('stays conservative when ownership remains matched through the deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'kill').mockReturnValue(true);
    inspectOwnership.mockResolvedValue('matched');

    const result = terminateRecoveredProcessTree(4_242, 'linux:boot:started');
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe('unknown');
  });
});
