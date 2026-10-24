import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  LifecycleContributorIdentity,
  LifecycleDefinitionContributor,
  LifecycleExtensionContributor,
  LifecycleValidatorContributor,
} from '../domains/change-lifecycle/contributors.js';
import {
  assertSafeLifecycleExtension,
  lifecycleContributorSnapshot,
} from '../domains/change-lifecycle/contributors.js';

class ContributorRegistry<T extends { identity: LifecycleContributorIdentity }> {
  private readonly values = new Map<string, T>();

  register(contributor: T): () => void {
    const key = `${contributor.identity.kind}:${contributor.identity.id}`;
    if (this.values.has(key)) throw new Error(`Lifecycle Contributor already registered: ${key}`);
    const stored = contributor;
    this.values.set(key, stored);
    return () => {
      if (this.values.get(key) === stored) this.values.delete(key);
    };
  }

  list(): T[] {
    return [...this.values.values()].sort((left, right) =>
      left.identity.id.localeCompare(right.identity.id),
    );
  }

  snapshot() {
    return lifecycleContributorSnapshot(this.list().map((entry) => entry.identity));
  }
}

export class LifecycleDefinitions extends Service {
  private readonly registry = new ContributorRegistry<LifecycleDefinitionContributor>();

  constructor(context: Context) {
    super(context, 'lifecycleDefinitions');
  }

  register(contributor: LifecycleDefinitionContributor): () => void {
    return this.registry.register(contributor);
  }

  current(): LifecycleDefinitionContributor {
    const contributors = this.registry.list();
    if (contributors.length !== 1) {
      throw new Error(`Exactly one Lifecycle Definition Contributor is required; found ${contributors.length}`);
    }
    return contributors[0]!;
  }

  snapshot() {
    return this.registry.snapshot();
  }
}

export class LifecycleValidators extends Service {
  private readonly registry = new ContributorRegistry<LifecycleValidatorContributor>();

  constructor(context: Context) {
    super(context, 'lifecycleValidators');
  }

  register(contributor: LifecycleValidatorContributor): () => void {
    return this.registry.register(contributor);
  }

  resolve(profileId: string): LifecycleValidatorContributor {
    const matches = this.registry.list().filter((entry) => entry.profiles.includes(profileId));
    if (matches.length !== 1) {
      throw new Error(`Validator profile ${profileId} must resolve exactly once; found ${matches.length}`);
    }
    return matches[0]!;
  }

  snapshot() {
    return this.registry.snapshot();
  }
}

export class LifecycleExtensions extends Service {
  static inject = ['lifecycleDefinitions'];
  private readonly registry = new ContributorRegistry<LifecycleExtensionContributor>();

  constructor(context: Context) {
    super(context, 'lifecycleExtensions');
  }

  register(contributor: LifecycleExtensionContributor): () => void {
    assertSafeLifecycleExtension(contributor, this.ctx.lifecycleDefinitions.current().definition);
    return this.registry.register(contributor);
  }

  list(): LifecycleExtensionContributor[] {
    return this.registry.list();
  }

  snapshot() {
    return this.registry.snapshot();
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lifecycleDefinitions: LifecycleDefinitions;
    lifecycleValidators: LifecycleValidators;
    lifecycleExtensions: LifecycleExtensions;
  }
}
