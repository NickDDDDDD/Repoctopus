import { describe, expect, it } from 'vitest';

import {
  desktopActivationDiagnostic,
  parseDesktopActivationResult,
  type DesktopActivationResult,
} from '../services/desktop-launcher.js';

const results: readonly DesktopActivationResult[] = [
  { status: 'started', targetKind: 'source', reason: 'new-instance' },
  { status: 'activated', targetKind: 'installed-protocol', reason: 'existing-instance' },
  { status: 'unavailable', targetKind: 'none', reason: 'target-unavailable' },
  { status: 'unsupported', targetKind: 'none', reason: 'platform-unsupported' },
];

describe('Desktop activation contract', () => {
  it('maps every bounded result to a stable path-free Runtime diagnostic', () => {
    expect(results.map(desktopActivationDiagnostic)).toEqual([
      {
        level: 'info',
        code: 'desktop.activation.started',
        message: 'Repoctopus Desktop start request was accepted',
      },
      {
        level: 'info',
        code: 'desktop.activation.activated',
        message: 'Repoctopus Desktop activation request was accepted',
      },
      {
        level: 'warning',
        code: 'desktop.activation.unavailable',
        message: 'Repoctopus Desktop activation target is unavailable',
      },
      {
        level: 'warning',
        code: 'desktop.activation.unsupported',
        message: 'Repoctopus Desktop activation is unsupported on this platform',
      },
    ]);
  });

  it('rejects unknown reasons, execution details, free text, and unknown fields', () => {
    expect(() =>
      parseDesktopActivationResult({
        status: 'unavailable',
        targetKind: 'none',
        reason: 'something-new',
      }),
    ).toThrow(/reason/u);
    expect(() =>
      parseDesktopActivationResult({
        ...results[2],
        executable: 'C:\\Users\\secret\\Repoctopus.exe',
      }),
    ).toThrow(/unknown field/u);
    expect(() => parseDesktopActivationResult({ ...results[2], command: 'cmd /c start' })).toThrow(
      /unknown field/u,
    );
    expect(() =>
      parseDesktopActivationResult({ ...results[2], warning: 'raw error text' }),
    ).toThrow(/unknown field/u);
  });
});
