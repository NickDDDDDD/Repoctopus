import type { Context, Plugin } from '@deepseek-ai/cordis';

import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  prepareChangeLifecycleDefinition,
} from '../../domains/change-lifecycle/definition.js';
import { lifecycleContributorIdentity } from '../../domains/change-lifecycle/contributors.js';

const plugin = ((context: Context) => {
  const definitionDigest = prepareChangeLifecycleDefinition().snapshot.digest;
  const profiles = [
    ...new Set(BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works.map((work) => work.validatorProfile.id)),
  ].sort();
  context.effect(() =>
    context.lifecycleValidators.register({
      identity: lifecycleContributorIdentity({
        kind: 'validator',
        id: 'repoctopus.lifecycle-validators',
        version: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
        codeDigest: definitionDigest,
        configDigest: definitionDigest,
        compatibleWith: [BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version, '4.0.0'],
      }),
      profiles,
      validate({ profileId, work }) {
        const accepted = profiles.includes(profileId) && work.validatorProfile.id === profileId;
        return Promise.resolve({
          accepted,
          diagnostic: accepted ? 'validator-profile-matched' : 'validator-profile-mismatch',
        });
      },
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['lifecycleValidators'] });

export default plugin;
