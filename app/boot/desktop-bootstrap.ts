import { bootApp, type RunningApp } from './boot.js';
import { compileComposition } from './composition.js';
import { createDesktopBuiltinCatalog } from '../../plugins/desktop-builtin-catalog.js';

/** Boots only the packaged Desktop Host composition and its four allowed built-ins. */
export async function bootDesktopComposition(productRoot: string): Promise<RunningApp> {
  const catalog = await createDesktopBuiltinCatalog(productRoot);
  const composition = compileComposition(
    {
      id: 'repoctopus-desktop',
      kind: 'desktop',
      plugins: [
        { id: 'desktop-application-service' },
        { id: 'desktop-projection-service' },
        { id: 'desktop-receiver-service' },
        { id: 'desktop-application' },
      ],
      requiredServices: ['desktopApplication', 'desktopProjection', 'desktopReceiver'],
    },
    catalog,
  );
  return bootApp({ composition, catalog });
}
