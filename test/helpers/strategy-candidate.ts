import type {
  BuildExecutionMode,
  BuildTddMode,
} from '../../domains/change-lifecycle/build-protocol.js';
import type { BuildStrategyCandidate } from '../../domains/change-lifecycle/strategy-selection.js';

export function strategyCandidateFixture(
  executionMode: BuildExecutionMode = 'autonomous',
  tddMode: BuildTddMode = 'tdd',
): BuildStrategyCandidate {
  return {
    schemaVersion: 1,
    kind: 'build-strategy-candidate',
    executionMode,
    tddMode,
    rationale: {
      execution: {
        summary: 'The fixture has an explicit bounded execution contract.',
        refs: ['tasks.md'],
      },
      tdd: {
        summary: 'The fixture declares the behavioral test method independently.',
        refs: ['design.md'],
      },
    },
  };
}
