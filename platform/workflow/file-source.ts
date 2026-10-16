import { readFile } from 'node:fs/promises';

import type { WorkflowSourcePort } from '../../domains/runtime/types.js';
import { parseWorkflowPackage } from '../../domains/workflow-contract/package.js';

export class FileWorkflowSource implements WorkflowSourcePort {
  async load(source: string) {
    return parseWorkflowPackage(await readFile(source, 'utf8'));
  }
}
