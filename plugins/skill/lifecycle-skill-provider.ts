import path from 'node:path';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { FileSkillProvider } from './file-skill-provider.js';

function apply(context: Context, config: { productRoot: string }): void {
  context.skills.registerProvider(
    (control) =>
      new FileSkillProvider(context, control, {
        name: 'repoctopus-lifecycle',
        roots: [
          {
            path: path.join(config.productRoot, 'skills', 'lifecycle'),
            source: 'bundled',
            rank: 900,
          },
        ],
        watch: false,
      }),
  );
}

export default Object.assign(apply as Plugin, { inject: ['skills'] });
