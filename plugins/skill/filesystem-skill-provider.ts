import { homedir } from 'node:os';
import path from 'node:path';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { FileSkillProvider } from './file-skill-provider.js';

interface Config {
  workspaceRoot: string;
  userSkillsRoot?: string;
}

function apply(context: Context, config: Config): void {
  let provider: FileSkillProvider;
  context.skills.registerProvider((control) => {
    provider = new FileSkillProvider(context, control, {
      name: 'project-user-files',
      roots: [
        {
          path: path.join(config.workspaceRoot, '.agents', 'skills'),
          source: 'project-agents',
          rank: 100,
        },
        {
          path: path.resolve(config.userSkillsRoot ?? path.join(homedir(), '.agents', 'skills')),
          source: 'user-agents',
          rank: 500,
          skipSystem: true,
        },
      ],
    });
    return provider;
  });
  context.effect(() => () => provider.dispose());
}

export default Object.assign(apply as Plugin, { inject: ['skills'] });
