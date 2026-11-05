import path from 'node:path';

const TEST_PATH_ROOT = path.resolve(path.parse(process.cwd()).root, '__repoctopus_tests__');

/** Build a virtual absolute checkout path using the current host's path semantics. */
export function hostAbsolutePath(...segments: string[]): string {
  return path.join(TEST_PATH_ROOT, ...segments);
}
