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
  it('does not report terminated when the leader exited but the process group is still alive', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    inspectOwnership
      .mockResolvedValueOnce('matched')
      .mockResolvedValueOnce('not_running');

    const result = terminateRecoveredProcessTree(4_242, 'linux:boot:started');
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe('unknown');
    expect(kill).toHaveBeenCalledWith(-4_242, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(-4_242, 0);
  });

  it('reports terminated only after the complete process group disappears', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    let groupProbes = 0;
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal !== 0) return true;
      groupProbes += 1;
      if (groupProbes < 3) return true;
      throw Object.assign(new Error('process group is gone'), { code: 'ESRCH' });
    });
    inspectOwnership.mockResolvedValueOnce('matched');

    const result = terminateRecoveredProcessTree(4_242, 'linux:boot:started');
    await vi.advanceTimersByTimeAsync(40);

    await expect(result).resolves.toBe('terminated');
    expect(inspectOwnership).toHaveBeenCalledTimes(1);
  });
});
