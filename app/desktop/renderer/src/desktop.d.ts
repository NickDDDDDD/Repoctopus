import type { RepoctopusDesktopBridge } from '../../shared/renderer-contract.js';

declare global {
  interface Window {
    repoctopusDesktop: RepoctopusDesktopBridge;
  }
}

export {};
