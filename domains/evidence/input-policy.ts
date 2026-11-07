/** Portable, versioned command dependencies. Patterns are deliberately not shell globs. */
export interface EvidenceRepositoryInputs {
  repository: string;
  files?: string[];
  outputs: string[];
}

export interface EvidenceInputPolicy {
  schemaVersion: 1;
  repositories?: EvidenceRepositoryInputs[];
  git: 'none' | 'all';
  taskCheckboxes: 'ignore' | 'include';
  env: string[];
}

export const DEFAULT_EVIDENCE_INPUT_POLICY: EvidenceInputPolicy = Object.freeze({
  schemaVersion: 1,
  git: 'none',
  taskCheckboxes: 'ignore',
  env: [],
});

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Evidence inputs must be an object');
  }
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Evidence inputs contain unsupported fields');
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, allowEmpty: boolean): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw new Error('Evidence input declaration requires nonempty strings');
  }
  if (new Set(value).size !== value.length) throw new Error('Duplicate Evidence input declaration');
  return [...value].sort();
}

export function validateEvidenceInputPath(value: string): string {
  if (
    !value ||
    /[\\\0:!{}()|]/u.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    value.split('/').some((part) => part.includes('**') && part !== '**')
  ) {
    throw new Error(`Unsafe or unsupported Evidence input path: ${value}`);
  }
  return value;
}

export function matchesEvidenceInputPath(pattern: string, file: string): boolean {
  validateEvidenceInputPath(pattern);
  const parts = pattern.split('/');
  const expression = parts
    .map((part, index) => {
      if (part === '**') return index === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
      const escaped = [...part]
        .map((char) =>
          char === '*'
            ? '[^/]*'
            : char === '?'
              ? '[^/]'
              : char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
        )
        .join('');
      return escaped + (index === parts.length - 1 ? '' : '/');
    })
    .join('');
  return new RegExp(`^${expression}$`, 'u').test(file);
}

/** Intersect the two glob NFAs instead of guessing with representative filenames. */
export function evidenceInputPatternsOverlap(left: string, right: string): boolean {
  type Label = { char: string } | { any: true } | { segment: true };
  type State = { epsilon: number[]; edges: { label: Label; to: number }[] };
  const compile = (pattern: string) => {
    validateEvidenceInputPath(pattern);
    const states: State[] = [{ epsilon: [], edges: [] }];
    let current = 0;
    const state = () => {
      states.push({ epsilon: [], edges: [] });
      return states.length - 1;
    };
    const parts = pattern.split('/');
    for (const [index, part] of parts.entries()) {
      if (part === '**' && index < parts.length - 1) {
        const next = state(),
          directory = state();
        states[current]!.epsilon.push(next);
        states[current]!.edges.push({ label: { segment: true }, to: directory });
        states[directory]!.edges.push(
          { label: { segment: true }, to: directory },
          { label: { char: '/' }, to: current },
        );
        current = next;
        continue;
      }
      for (const char of part === '**' ? ['**'] : [...part]) {
        const next = state();
        if (char === '*' || char === '**') {
          states[current]!.epsilon.push(next);
          states[current]!.edges.push({
            label: char === '**' ? { any: true } : { segment: true },
            to: current,
          });
        } else
          states[current]!.edges.push({
            label: char === '?' ? { segment: true } : { char },
            to: next,
          });
        current = next;
      }
      if (index < parts.length - 1) {
        const next = state();
        states[current]!.edges.push({ label: { char: '/' }, to: next });
        current = next;
      }
    }
    return { states, accept: current };
  };
  const a = compile(left),
    b = compile(right);
  const queue: [number, number][] = [[0, 0]],
    seen = new Set<string>();
  const compatible = (a: Label, b: Label) =>
    'char' in a
      ? 'char' in b
        ? a.char === b.char
        : 'any' in b || a.char !== '/'
      : 'char' in b
        ? 'any' in a || b.char !== '/'
        : true;
  while (queue.length) {
    const [ai, bi] = queue.pop()!;
    const key = `${ai}:${bi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ai === a.accept && bi === b.accept) return true;
    a.states[ai]!.epsilon.forEach((next) => queue.push([next, bi]));
    b.states[bi]!.epsilon.forEach((next) => queue.push([ai, next]));
    for (const edge of a.states[ai]!.edges)
      for (const other of b.states[bi]!.edges) {
        if (compatible(edge.label, other.label)) queue.push([edge.to, other.to]);
      }
  }
  return false;
}

export function parseEvidenceInputPolicy(value: unknown): EvidenceInputPolicy {
  const input = record(value, ['schemaVersion', 'repositories', 'git', 'taskCheckboxes', 'env']);
  if (input.schemaVersion !== 1) throw new Error('Unsupported Evidence input schema');
  const git = input.git ?? 'none';
  const taskCheckboxes = input.taskCheckboxes ?? 'ignore';
  if (git !== 'none' && git !== 'all') throw new Error('Invalid Evidence Git input scope');
  if (taskCheckboxes !== 'ignore' && taskCheckboxes !== 'include') {
    throw new Error('Invalid Evidence task checkbox input scope');
  }
  const env = strings(input.env ?? [], true)
    .map((name) => (process.platform === 'win32' ? name.toUpperCase() : name))
    .sort();
  if (new Set(env).size !== env.length) throw new Error('Duplicate Evidence environment input');
  if (env.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) {
    throw new Error('Invalid Evidence environment input name');
  }
  let repositories: EvidenceRepositoryInputs[] | undefined;
  if (input.repositories !== undefined) {
    if (!Array.isArray(input.repositories) || !input.repositories.length) {
      throw new Error('Evidence repositories must not be empty');
    }
    repositories = input.repositories
      .map((value) => {
        const repo = record(value, ['repository', 'files', 'outputs']);
        if (typeof repo.repository !== 'string' || !repo.repository.trim()) {
          throw new Error('Evidence input repository identity is required');
        }
        const files =
          repo.files === undefined
            ? undefined
            : strings(repo.files, false).map(validateEvidenceInputPath);
        const outputs = strings(repo.outputs ?? [], true).map(validateEvidenceInputPath);
        if (
          files?.some((file) =>
            outputs.some((output) => evidenceInputPatternsOverlap(file, output)),
          )
        ) {
          throw new Error('Evidence input and output declarations are ambiguous');
        }
        return { repository: repo.repository, ...(files ? { files } : {}), outputs };
      })
      .sort((a, b) => a.repository.localeCompare(b.repository));
    if (new Set(repositories.map((repo) => repo.repository)).size !== repositories.length) {
      throw new Error('Duplicate Evidence input repository');
    }
  }
  return { schemaVersion: 1, ...(repositories ? { repositories } : {}), git, taskCheckboxes, env };
}
