import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical.js';
import type { WorkflowDefinition } from './types.js';

export function hashWorkflowDefinition(definition: WorkflowDefinition): string {
  return createHash('sha256').update(canonicalJson(definition)).digest('hex');
}
