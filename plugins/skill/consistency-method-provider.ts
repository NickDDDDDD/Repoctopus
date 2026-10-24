import path from 'node:path';

import type { Context, Plugin } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import { FileSkillProvider } from './file-skill-provider.js';

const CONSISTENCY_SCOPE = `

## Repoctopus consistency review scope

Use this method only to assess whether bounded post-publication evidence changes an accepted behavior contract. Do not create or edit specification artifacts, publish tickets, apply labels, or establish another requirements authority. Output only semantic findings, an impact recommendation, and evidence mappings for the Consistency Review Service. Implementation paths alone are never sufficient evidence for no-spec-impact.
`;

function apply(context: Context, config: { productRoot: string }): void {
  context.skills.registerProvider(
    (control) =>
      new FileSkillProvider(context, control, {
        name: 'matt-consistency-method',
        roots: [
          {
            path: path.join(
              config.productRoot,
              'third_party',
              'matt-skills',
              'references',
              'engineering',
              'to-spec',
            ),
            source: 'bundled',
            rank: 650,
          },
        ],
        watch: false,
        transform: (definition: SkillDefinition) => ({
          ...definition,
          invocation: { modelInvocable: false, userInvocable: false },
          content: `${definition.content}${CONSISTENCY_SCOPE}`,
        }),
      }),
  );
}

export default Object.assign(apply as Plugin, { inject: ['skills'] });
