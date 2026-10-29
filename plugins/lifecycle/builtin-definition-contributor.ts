import type { Context, Plugin } from '@deepseek-ai/cordis';

import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  prepareChangeLifecycleDefinition,
} from '../../domains/change-lifecycle/definition.js';
import { lifecycleContributorIdentity } from '../../domains/change-lifecycle/contributors.js';

const plugin = ((context: Context) => {
  const definitionDigest = prepareChangeLifecycleDefinition().snapshot.digest;
  context.effect(() =>
    context.lifecycleDefinitions.register({
      identity: lifecycleContributorIdentity({
        kind: 'definition',
        id: 'repoctopus.change-lifecycle',
        version: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
        codeDigest: definitionDigest,
        configDigest: definitionDigest,
        compatibleWith: [BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version, '4.2.0'],
      }),
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['lifecycleDefinitions'] });

export default plugin;
