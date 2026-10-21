import path from 'node:path';

export interface DesktopProductRootInput {
  appPath: string;
  isPackaged: boolean;
  moduleDirectory: string;
}

/** Resolve the Repoctopus product root without inheriting DSH's different bundle layout. */
export function resolveDesktopProductRoot(input: DesktopProductRootInput): string {
  return input.isPackaged
    ? path.resolve(input.appPath)
    : path.resolve(input.moduleDirectory, '..', '..');
}
