import { Service, type Context } from '@deepseek-ai/cordis';

import type { ArtifactStore } from '../domains/evidence/ports.js';
import type { BrowserAdapter } from '../domains/feedback/browser.js';
import type { CommandAdapter } from '../domains/feedback/ports.js';
import type { ServiceAdapter } from '../domains/feedback/service.js';
import type { VisualInspectionAdapter } from '../domains/feedback/visual.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';

export interface EvidenceAdapterSet {
  command: CommandAdapter;
  services?: ServiceAdapter;
  browser?: BrowserAdapter;
  visual?: VisualInspectionAdapter;
}

type AdapterKind = 'command' | 'service' | 'browser' | 'visual';
type AdapterFactory = (
  config: EffectiveProjectConfig,
  artifacts: ArtifactStore,
) => CommandAdapter | ServiceAdapter | BrowserAdapter | VisualInspectionAdapter | undefined;

export class EvidenceAdapters extends Service {
  private readonly factories = new Map<AdapterKind, AdapterFactory>();

  constructor(context: Context) {
    super(context, 'evidenceAdapters');
  }

  register(kind: AdapterKind, factory: AdapterFactory): () => void {
    if (this.factories.has(kind)) throw new Error(`Evidence adapter already registered: ${kind}`);
    this.factories.set(kind, factory);
    return () => {
      if (this.factories.get(kind) === factory) this.factories.delete(kind);
    };
  }

  has(kind: AdapterKind): boolean {
    return this.factories.has(kind);
  }

  create(config: EffectiveProjectConfig, artifacts: ArtifactStore): EvidenceAdapterSet {
    const command = this.factories.get('command')?.(config, artifacts) as
      | CommandAdapter
      | undefined;
    if (!command) throw new Error('Command Evidence adapter is not active');
    const services = this.factories.get('service')?.(config, artifacts) as
      | ServiceAdapter
      | undefined;
    const browser = this.factories.get('browser')?.(config, artifacts) as
      | BrowserAdapter
      | undefined;
    const visual = this.factories.get('visual')?.(config, artifacts) as
      | VisualInspectionAdapter
      | undefined;
    return {
      command,
      ...(services ? { services } : {}),
      ...(browser ? { browser } : {}),
      ...(visual ? { visual } : {}),
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evidenceAdapters: EvidenceAdapters;
  }
}
