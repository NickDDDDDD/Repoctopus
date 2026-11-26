export interface ParsedArguments {
  command: string[];
  flags: Map<string, string | true>;
  checkoutPaths: string[];
}

const BOOLEAN_FLAGS = new Set(['help', 'json', 'version', 'preview']);

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const command: string[] = [];
  const flags = new Map<string, string | true>();
  const checkoutPaths: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) continue;
    if (!value.startsWith('--')) {
      command.push(value);
      continue;
    }
    const equal = value.indexOf('=');
    const name = value.slice(2, equal > 2 ? equal : undefined);
    if (name === 'checkout') {
      const checkout = equal > 2 ? value.slice(equal + 1) : argv[index + 1];
      if (!checkout || (equal <= 2 && checkout.startsWith('--'))) {
        throw new Error('Missing required path after --checkout');
      }
      checkoutPaths.push(checkout);
      if (equal <= 2) index += 1;
      continue;
    }
    if (equal > 2) {
      flags.set(name, value.slice(equal + 1));
      continue;
    }
    if (!name) throw new Error('Option name is required after --');
    if (flags.has(name)) throw new Error(`Duplicate option: --${name}`);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }
    const candidate = argv[index + 1];
    if (candidate && !candidate.startsWith('--')) {
      flags.set(name, candidate);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, flags, checkoutPaths };
}

export function stringFlag(
  parsed: ParsedArguments,
  name: string,
  options: { required?: boolean; fallback?: string } = {},
): string | undefined {
  const value = parsed.flags.get(name);
  if (typeof value === 'string' && value.length > 0) return value;
  if (options.fallback !== undefined) return options.fallback;
  if (options.required) throw new Error(`Missing required option: --${name}`);
  return undefined;
}

export function booleanFlag(parsed: ParsedArguments, name: string): boolean {
  return parsed.flags.get(name) === true || parsed.flags.get(name) === 'true';
}

export function integerFlag(
  parsed: ParsedArguments,
  name: string,
  options: { required?: boolean; fallback?: number; minimum?: number } = {},
): number | undefined {
  const value = parsed.flags.get(name);
  if (value === undefined && options.fallback !== undefined) return options.fallback;
  if (value === undefined && options.required) {
    throw new Error(`Missing required option: --${name}`);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    if (value === undefined) return undefined;
    throw new Error(`Option --${name} must be an integer`);
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < (options.minimum ?? 0)) {
    throw new Error(`Option --${name} must be at least ${options.minimum ?? 0}`);
  }
  return parsedValue;
}
