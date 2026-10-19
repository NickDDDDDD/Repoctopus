import { Service, type Context } from '@deepseek-ai/cordis';

import type { CompositionIdentitySnapshot } from '../domains/composition/types.js';

export class CompositionIdentity extends Service {
  private readonly snapshot: CompositionIdentitySnapshot;

  constructor(context: Context, snapshot: CompositionIdentitySnapshot) {
    super(context, 'compositionIdentity');
    this.snapshot = structuredClone(snapshot);
  }

  current(): CompositionIdentitySnapshot {
    return structuredClone(this.snapshot);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    compositionIdentity: CompositionIdentity;
  }
}
