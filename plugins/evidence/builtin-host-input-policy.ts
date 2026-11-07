import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { RepositoryInputPolicyContributor } from '../../domains/evidence/repository-input-policy.js';

export const BUILTIN_HOST_INPUT_CONTRIBUTOR: RepositoryInputPolicyContributor = {
  identity: { id: 'repoctopus-host-inputs', version: '2.0.0' },
  rules: [
    {
      id: 'runtime-evidence-outputs',
      owner: 'repoctopus-host-inputs',
      path: '.repoctopus',
      match: 'tree',
      tracked: 'conflict',
      allowedKinds: ['file'],
      untracked: 'runtime-output',
    },
    {
      id: 'agent-skill-installation',
      owner: 'repoctopus-host-inputs',
      path: '.agents/skills',
      match: 'tree',
      tracked: 'product',
      allowedKinds: ['file'],
    },
    {
      id: 'codex-hooks',
      owner: 'repoctopus-host-inputs',
      path: '.codex/hooks.json',
      match: 'file',
      tracked: 'conflict',
      allowedKinds: ['file'],
    },
    {
      id: 'codex-rules',
      owner: 'repoctopus-host-inputs',
      path: '.codex/rules',
      match: 'tree',
      tracked: 'conflict',
      allowedKinds: ['file'],
    },
    {
      id: 'agent-instructions',
      owner: 'repoctopus-host-inputs',
      path: 'AGENTS.md',
      match: 'file',
      tracked: 'product',
      allowedKinds: ['file'],
    },
    {
      id: 'agent-skill-lock',
      owner: 'repoctopus-host-inputs',
      path: 'skills-lock.json',
      match: 'file',
      tracked: 'product',
      allowedKinds: ['file'],
    },
  ],
};

const builtinHostInputPolicy = ((context: Context) => {
  context.effect(() => context.repositoryInputPolicies.register(BUILTIN_HOST_INPUT_CONTRIBUTOR));
}) as Plugin;

Object.assign(builtinHostInputPolicy, { inject: ['repositoryInputPolicies'] });

export default builtinHostInputPolicy;
