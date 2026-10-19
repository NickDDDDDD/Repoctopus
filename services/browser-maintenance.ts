import { Service, type Context } from '@deepseek-ai/cordis';

import {
  doctorManagedChromium,
  installManagedChromium,
} from '../platform/browser/managed-browser.js';

export class BrowserMaintenance extends Service {
  constructor(context: Context) {
    super(context, 'browserMaintenance');
  }

  doctor(workspace: string) {
    return doctorManagedChromium(workspace);
  }

  install(workspace: string) {
    return installManagedChromium(workspace);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    browserMaintenance: BrowserMaintenance;
  }
}
