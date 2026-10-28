import type { Context, Plugin } from '@deepseek-ai/cordis';

import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  prepareChangeLifecycleDefinition,
} from '../../domains/change-lifecycle/definition.js';
import { lifecycleContributorIdentity } from '../../domains/change-lifecycle/contributors.js';

const plugin = ((context: Context) => {
  const definitionDigest = prepareChangeLifecycleDefinition().snapshot.digest;
  context.effect(() =>
    context.lifecycleExtensions.register({
      identity: lifecycleContributorIdentity({
        kind: 'extension',
        id: 'repoctopus.core-checkpoints',
        version: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
        codeDigest: definitionDigest,
        configDigest: definitionDigest,
        compatibleWith: [BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version, '4.0.0'],
      }),
      declaredCapabilities: [],
      declaredWriteScopes: [],
      works: [],
      validations: [],
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['lifecycleExtensions'] });

export default plugin;
