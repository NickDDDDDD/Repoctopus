export type CompositionKind = 'bootstrap' | 'desktop' | 'project';

export interface PluginImplementationIdentity {
  id: string;
  version: string;
  configDigest: `sha256:${string}`;
  codeDigest: `sha256:${string}`;
  descriptorDigest: `sha256:${string}`;
  authorities: string[];
  stateSchemas: Record<string, string>;
  compatibleImplementations?: readonly {
    codeDigest: `sha256:${string}`;
    descriptorDigest: `sha256:${string}`;
  }[];
}

export interface CompositionCompatibility {
  status: 'same' | 'compatible' | 'migration_required';
  changedPluginIds: string[];
  reason: string;
}

export interface CompositionIdentitySnapshot {
  id: string;
  kind: CompositionKind;
  compositionDigest: `sha256:${string}`;
  plugins: PluginImplementationIdentity[];
  configuration?: {
    sharedDigest: string;
    localDigest: string | null;
    effectiveDigest: string;
  };
}
