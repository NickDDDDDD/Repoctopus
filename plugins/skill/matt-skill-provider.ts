import path from 'node:path';

import type { Context, Plugin } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import { FileSkillProvider } from './file-skill-provider.js';

interface Config {
  productRoot: string;
}

const TEACH_POLICY = `

## Repoctopus learning state policy

All lessons, mission files, resource indexes, notes, and learning records MUST be written below \`.repoctopus/learning/<topic>/\` in the active workspace. This policy replaces references above that place learning state in the directory where the command was invoked. Personal learning content stays local and MUST NOT be written to telemetry or committed to Git unless the user explicitly promotes a reviewed conclusion through the project's normal documentation path.
`;

function apply(context: Context, config: Config): void {
  const skillsRoot = path.join(config.productRoot, 'third_party', 'matt-skills', 'skills');
  context.skills.registerProvider(
    (control) =>
      new FileSkillProvider(context, control, {
        name: 'matt-builtins',
        roots: [
          {
            path: path.join(skillsRoot, 'engineering'),
            source: 'bundled',
            rank: 600,
          },
          {
            path: path.join(skillsRoot, 'productivity'),
            source: 'bundled',
            rank: 600,
          },
        ],
        watch: false,
        transform: (definition: SkillDefinition) =>
          definition.name === 'teach'
            ? { ...definition, content: `${definition.content}${TEACH_POLICY}` }
            : definition,
      }),
  );
}

export default Object.assign(apply as Plugin, { inject: ['skills'] });
