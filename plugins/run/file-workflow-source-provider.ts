import type { Context } from '@deepseek-ai/cordis';

import { FileWorkflowSource } from '../../platform/workflow/file-source.js';
import { WorkflowSource } from '../../services/workflow-support.js';

export class FileWorkflowSourceProvider extends WorkflowSource {
  private readonly source = new FileWorkflowSource();

  constructor(context: Context) {
    super(context);
  }

  load(source: string) {
    return this.source.load(source);
  }
}
