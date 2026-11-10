import { open } from 'node:fs/promises';

import {
  HUMAN_DECISION_RESPONSE_MAX_BYTES,
  parseLifecycleHumanDecisionResponse,
} from '../../domains/change-lifecycle/human-decision.js';

/** Read at most limit+1 bytes even if the file grows after stat. */
export async function readLifecycleDecisionResponse(file: string) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(HUMAN_DECISION_RESPONSE_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > HUMAN_DECISION_RESPONSE_MAX_BYTES)
      throw new Error('Human Decision response exceeds 64 KiB');
    return parseLifecycleHumanDecisionResponse(
      JSON.parse(
        buffer
          .subarray(0, size)
          .toString('utf8')
          .replace(/^\uFEFF/u, ''),
      ),
    );
  } finally {
    await handle.close();
  }
}
