import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { EvidenceExecutionPlan } from '../../domains/feedback/profile.js';
import type { RepositoryFingerprint } from '../../domains/evidence/fingerprint.js';
import {
  DEFAULT_EVIDENCE_INPUT_POLICY,
  evidenceInputPatternsOverlap,
  type EvidenceRepositoryInputs,
} from '../../domains/evidence/input-policy.js';
import {
  createEvidenceNodeInputSnapshot,
  evidenceInputDigest,
  evidenceNodeAncestors,
  evidenceOutputClaims,
  type EvidenceNodeInputSnapshot,
} from '../../domains/evidence/input-snapshot.js';
import {
  classifyRepositoryInput,
  type CompiledRepositoryInputPolicy,
} from '../../domains/evidence/repository-input-policy.js';
import type { EffectiveProjectConfig } from '../../domains/project-configuration/types.js';
import type { SpecificationEvidenceProjection } from '../../domains/specification/types.js';
import { hashFileRaceSafe } from '../filesystem/race-safe-read.js';
import { collectEvidenceInputFiles } from '../git/evidence-input-snapshot.js';
import { runExternalCommandAsync } from '../process/external-command.js';
import { resolveWindowsCommand } from '../process/spawn-command.js';

async function programIdentity(executable: string, cwd: string): Promise<unknown> {
  let resolved: string | undefined;
  if (process.platform === 'win32') resolved = resolveWindowsCommand(executable, process.env, cwd);
  else if (executable.includes('/')) resolved = path.resolve(cwd, executable);
  else {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.resolve(directory || cwd, executable);
      try {
        await access(candidate, constants.X_OK);
        resolved = candidate;
        break;
      } catch {
        /* continue PATH resolution */
      }
    }
  }
  if (!resolved || !path.isAbsolute(resolved)) return { executable, available: false };
  try {
    const file = await hashFileRaceSafe(resolved, {
      bigint: true,
      label: 'Evidence command program',
    });
    // A hash of the resolved path distinguishes equal programs at different locations
    // without exporting machine paths. Bytes and Node remain bound independently.
    return {
      available: true,
      pathDigest: evidenceInputDigest(file.realPath),
      digest: file.digest,
      node: process.version,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { executable, available: false };
    throw error;
  }
}

export async function observeEvidenceNodeInputs(input: {
  plan: EvidenceExecutionPlan;
  config: EffectiveProjectConfig;
  repositories: readonly RepositoryFingerprint[];
  policy: CompiledRepositoryInputPolicy;
  projection?: SpecificationEvidenceProjection;
  adapters: Readonly<Record<string, string>>;
}): Promise<EvidenceNodeInputSnapshot[]> {
  const claims = evidenceOutputClaims(input.plan);
  for (const claim of claims) {
    for (const pattern of claim.patterns) {
      if (
        input.policy.rules.some(
          (rule) =>
            evidenceInputPatternsOverlap(pattern, rule.path) ||
            (rule.match === 'tree' && evidenceInputPatternsOverlap(pattern, `${rule.path}/**`)),
        )
      ) {
        throw new Error('Evidence output claim overlaps control-plane ownership');
      }
    }
  }
  const captures = new Map<string, ReturnType<typeof collectEvidenceInputFiles>>();
  const nodes: EvidenceNodeInputSnapshot[] = [];
  const nodeProgram = await programIdentity(process.execPath, process.cwd());
  for (const node of input.plan.nodes) {
    const policy =
      node.type === 'command'
        ? (node.inputs ?? DEFAULT_EVIDENCE_INPUT_POLICY)
        : DEFAULT_EVIDENCE_INPUT_POLICY;
    const scopes: EvidenceRepositoryInputs[] =
      policy.repositories ??
      input.config.repositories.map((repo) => ({ repository: repo.id, outputs: [] }));
    const ancestors = evidenceNodeAncestors(input.plan, node);
    const derivedFrom = claims.filter(
      (claim) =>
        ancestors.has(claim.producerId) &&
        scopes.some(
          (scope) =>
            scope.repository === claim.repositoryId &&
            (!scope.files ||
              scope.files.some((file) =>
                claim.patterns.some((output) => evidenceInputPatternsOverlap(file, output)),
              )),
        ),
    );
    const repositories = await Promise.all(
      scopes.map(async (scope) => {
        const repo = input.config.repositories.find((repo) => repo.id === scope.repository);
        if (!repo)
          throw new Error(`Evidence input repository is not registered: ${scope.repository}`);
        const outputs = claims
          .filter((claim) => claim.repositoryId === repo.id)
          .flatMap((claim) => claim.patterns);
        const selection = {
          root: repo.resolvedPath,
          ...(scope.files ? { files: scope.files } : {}),
          exclude: outputs,
          policy: input.policy,
        };
        const key = JSON.stringify(selection);
        let capture = captures.get(key);
        if (!capture) {
          capture = collectEvidenceInputFiles(selection);
          captures.set(key, capture);
        }
        const files = await capture;
        // Control inputs are always bound, even when a command narrows its source scope.
        const controlPatterns = input.policy.rules
          .filter((rule) => rule.untracked !== 'runtime-output')
          .map((rule) => (rule.match === 'tree' ? `${rule.path}/**` : rule.path));
        const controlKey = JSON.stringify({ root: repo.resolvedPath, files: controlPatterns });
        let controlCapture = captures.get(controlKey);
        if (!controlCapture && controlPatterns.length) {
          controlCapture = collectEvidenceInputFiles({
            root: repo.resolvedPath,
            files: controlPatterns,
            policy: input.policy,
          });
          captures.set(controlKey, controlCapture);
        }
        const control = controlCapture ? await controlCapture : [];
        const selected = new Map([...files, ...control].map((file) => [file.path, file]));
        for (const file of selected.values()) {
          if (classifyRepositoryInput(input.policy, file.path, false).kind === 'runtime-output') {
            throw new Error('Runtime output cannot be a command control input');
          }
        }
        return {
          repositoryId: repo.id,
          files: [...selected.values()].sort((a, b) => a.path.localeCompare(b.path)),
        };
      }),
    );
    // A consumer can only read a producer output through an ancestor edge.
    for (const scope of scopes)
      for (const claim of claims.filter(
        (claim) =>
          claim.repositoryId === scope.repository &&
          claim.producerId !== node.id &&
          !ancestors.has(claim.producerId),
      )) {
        if (
          !scope.files ||
          scope.files.some((pattern) =>
            claim.patterns.some((output) => evidenceInputPatternsOverlap(pattern, output)),
          )
        ) {
          throw new Error(`Evidence node ${node.id} reads a non-ancestor output`);
        }
      }
    const envEntries = policy.env.map((name) => {
      const key = process.platform === 'win32' ? name.toUpperCase() : name;
      const value =
        Object.entries(process.env).find(([candidate]) =>
          process.platform === 'win32' ? candidate.toUpperCase() === key : candidate === key,
        )?.[1] ?? null;
      return [key, value] as const;
    });
    if (new Set(envEntries.map(([key]) => key)).size !== envEntries.length)
      throw new Error('Duplicate Evidence environment input');
    const gitIdentity =
      policy.git === 'all'
        ? await Promise.all(
            scopes.map(async (scope) => {
              const repo = input.config.repositories.find((repo) => repo.id === scope.repository)!;
              return {
                repositoryId: repo.id,
                head: input.repositories.find((entry) => entry.repositoryId === repo.id)!.head,
                tree: input.repositories.find((entry) => entry.repositoryId === repo.id)!.tree,
                index: evidenceInputDigest(
                  await runExternalCommandAsync('git', ['ls-files', '--stage', '-z'], {
                    cwd: repo.resolvedPath,
                  }),
                ),
              };
            }),
          )
        : undefined;
    const program =
      node.type === 'command'
        ? await programIdentity(node.executable, path.resolve(node.repositoryPath, node.cwd ?? '.'))
        : undefined;
    nodes.push(
      createEvidenceNodeInputSnapshot({
        node,
        policy,
        repositories,
        cacheable:
          node.type === 'command' &&
          (program as { available?: boolean } | undefined)?.available === true,
        ...(input.projection ? { projection: input.projection } : {}),
        executionIdentity: {
          adapters: input.adapters,
          contributors: input.policy.digest,
          node: nodeProgram,
          cwdDigest: evidenceInputDigest(
            path.resolve(node.repositoryPath, 'cwd' in node ? (node.cwd ?? '.') : '.'),
          ),
          ...(program ? { program } : {}),
        },
        ...(gitIdentity ? { gitIdentity } : {}),
        environmentDigest: evidenceInputDigest({
          domain: 'repoctopus.evidence.environment/v1',
          entries: envEntries,
        }),
        derivedFrom,
        outputs: claims.filter((claim) => claim.producerId === node.id),
      }),
    );
  }
  return nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}
