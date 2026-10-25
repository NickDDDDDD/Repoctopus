import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { execute } from '../process/execute.js';

export interface IsolatedSpecificationCheckout {
  checkoutId: string;
  root: string;
  head: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

export class GitSpecificationCheckoutManager {
  private readonly checkoutRoot: string;

  constructor(private readonly workspaceRoot: string) {
    this.checkoutRoot = path.resolve(workspaceRoot, '.repoctopus', 'archive-checkouts');
  }

  async create(checkoutId: string): Promise<IsolatedSpecificationCheckout> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(checkoutId)) {
      throw new Error('Archive checkout id is invalid');
    }
    const root = path.resolve(this.checkoutRoot, checkoutId);
    if (!root.startsWith(`${this.checkoutRoot}${path.sep}`)) {
      throw new Error('Archive checkout escaped its managed root');
    }
    await mkdir(this.checkoutRoot, { recursive: true });
    const existing = await this.find(checkoutId);
    if (existing) return existing;
    const head = await git(this.workspaceRoot, ['rev-parse', 'HEAD']);
    await git(this.workspaceRoot, ['worktree', 'add', '--detach', root, head]);
    return { checkoutId, root: await realpath(root), head };
  }

  async find(checkoutId: string): Promise<IsolatedSpecificationCheckout | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(checkoutId)) return null;
    const root = path.resolve(this.checkoutRoot, checkoutId);
    try {
      const resolved = await realpath(root);
      const head = await git(resolved, ['rev-parse', 'HEAD']);
      return { checkoutId, root: resolved, head };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  async cleanup(checkout: IsolatedSpecificationCheckout): Promise<void> {
    const root = path.resolve(checkout.root);
    if (!root.startsWith(`${this.checkoutRoot}${path.sep}`)) {
      throw new Error('Refusing to remove an unmanaged Archive checkout');
    }
    await git(this.workspaceRoot, ['worktree', 'remove', '--force', root]).catch(async () => {
      await rm(root, { recursive: true, force: true });
      await git(this.workspaceRoot, ['worktree', 'prune']);
    });
  }
}
