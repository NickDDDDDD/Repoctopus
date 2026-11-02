import { Service, type Context } from '@deepseek-ai/cordis';

import {
  compileRepositoryInputPolicy,
  type CompiledRepositoryInputPolicy,
  type RepositoryInputPolicyContributor,
} from '../domains/evidence/repository-input-policy.js';

export class RepositoryInputPolicies extends Service {
  private readonly contributors = new Map<string, RepositoryInputPolicyContributor>();

  constructor(context: Context) {
    super(context, 'repositoryInputPolicies');
  }

  register(contributor: RepositoryInputPolicyContributor): () => void {
    const id = contributor.identity.id.trim();
    if (this.contributors.has(id)) {
      throw new Error(`Repository Input Policy Contributor already registered: ${id}`);
    }
    const stored = structuredClone(contributor);
    compileRepositoryInputPolicy([...this.contributors.values(), stored]);
    this.contributors.set(id, stored);
    return () => {
      if (this.contributors.get(id) === stored) this.contributors.delete(id);
    };
  }

  current(): CompiledRepositoryInputPolicy {
    return compileRepositoryInputPolicy([...this.contributors.values()]);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    repositoryInputPolicies: RepositoryInputPolicies;
  }
}
