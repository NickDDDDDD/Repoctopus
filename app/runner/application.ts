import { bootRunnerComposition } from '../boot/bootstrap.js';

export interface RunningRunnerApplication {
  origin: string;
  compositionDigest: `sha256:${string}`;
  close(): Promise<void>;
}

export async function startRunnerApplication(
  productRoot: string,
  workspaceRoot: string,
): Promise<RunningRunnerApplication> {
  const app = await bootRunnerComposition(productRoot, workspaceRoot);
  try {
    await app.context.httpHost.ready();
    return {
      origin: app.context.httpHost.origin(),
      compositionDigest: app.composition.compositionDigest,
      close: () => app.close(),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
