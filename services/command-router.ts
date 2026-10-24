import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';

import type { RuntimeWorkOperation } from '../domains/change-lifecycle/work-guard.js';

export interface CommandRequest<TInput = unknown> {
  input: TInput;
  signal: AbortSignal;
}

export interface CommandHandler<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly runtimeWork?: (input: TInput) => RuntimeWorkOperation;
  execute(request: CommandRequest<TInput>): Promise<TOutput>;
}

export class CommandNotFoundError extends Error {
  constructor(command: string) {
    super(`Command capability is not active: ${command}`);
    this.name = 'CommandNotFoundError';
  }
}

export class CommandRouter extends Service {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(context: Context) {
    super(context, 'commandRouter');
  }

  register(handler: CommandHandler): () => void {
    const name = handler.name.trim();
    if (!name) throw new Error('Command handler name is required');
    if (this.handlers.has(name)) throw new Error(`Command handler already registered: ${name}`);
    this.handlers.set(name, handler);
    return () => {
      if (this.handlers.get(name) === handler) this.handlers.delete(name);
    };
  }

  list(): string[] {
    return [...this.handlers.keys()].sort((left, right) => left.localeCompare(right));
  }

  async execute<TInput, TOutput>(
    name: string,
    input: TInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<TOutput> {
    const handler = this.handlers.get(name) as CommandHandler<TInput, TOutput> | undefined;
    if (!handler) throw new CommandNotFoundError(name);
    if (signal.aborted) throw signal.reason;
    if (handler.runtimeWork) {
      const guard = this.ctx.get('runtimeWorkGuard');
      if (!guard) throw new Error(`Runtime Work Guard is not active for command: ${name}`);
      await guard.authorize(handler.runtimeWork(input));
    }
    return handler.execute({ input, signal });
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    commandRouter: CommandRouter;
  }
}
