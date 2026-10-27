import console from 'node:console';
import childProcess from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

import { app } from 'electron';

const expectedChangeId = 'desktop-smoke';
const screenshot = process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT;
const auditAccessibility = process.env.REPOCTOPUS_DESKTOP_A11Y_AUDIT === '1';
const expectedDevicePixelRatio = Number(process.env.REPOCTOPUS_DESKTOP_EXPECT_DPR ?? '0');
let finished = false;

function fail(error) {
  if (finished) return;
  finished = true;
  console.error('desktop smoke failed', error);
  app.exit(1);
}

function attribute(key, value) {
  return {
    key,
    value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
  };
}

const originalSpawn = childProcess.spawn;
childProcess.spawn = function instrumentDesktopHost(...args) {
  const child = originalSpawn.apply(this, args);
  child.on('message', (message) => {
    if (message?.type !== 'ready') return;
    void globalThis
      .fetch(`${message.receiver.endpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-repoctopus-session': message.receiver.sessionToken,
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [attribute('repoctopus.workspace.id', 'workspace-smoke')],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                      body: { stringValue: 'change.phase.entered' },
                      attributes: [
                        attribute('repoctopus.event.id', 'event-smoke-open'),
                        attribute('repoctopus.event.sequence', 1),
                        attribute('repoctopus.change.id', expectedChangeId),
                        attribute('repoctopus.run.id', 'run-desktop-smoke'),
                        attribute('repoctopus.workflow.name', 'repoctopus-change'),
                        attribute('repoctopus.execution.phase', 'open'),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      })
      .then((response) => {
        if (!response.ok) fail(new Error(`Desktop smoke OTLP export failed: ${response.status}`));
      }, fail);
  });
  return child;
};
syncBuiltinESMExports();

async function inspect(window) {
  const deadline = Date.now() + 15_000;
  let state;
  while (Date.now() < deadline) {
    state = await window.webContents.executeJavaScript(`(() => ({
      dashboardState: document.querySelector('[data-dashboard-state]')?.dataset.dashboardState,
      phaseStatus: document.querySelector('[data-phase-status="running"]')?.textContent,
      body: document.body.innerText,
      processType: typeof globalThis.process,
      requireType: typeof globalThis.require,
      bridgeType: typeof window.repoctopusDesktop,
      devicePixelRatio: window.devicePixelRatio,
    }))()`);
    if (state.dashboardState === 'live') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (
    state?.dashboardState !== 'live' ||
    !state.body.includes(expectedChangeId) ||
    !state.phaseStatus?.includes('Open') ||
    !state.phaseStatus.includes('进行中')
  ) {
    throw new Error(`Desktop did not render the OTLP projection: ${JSON.stringify(state)}`);
  }
  if (
    state.processType !== 'undefined' ||
    state.requireType !== 'undefined' ||
    state.bridgeType !== 'object'
  ) {
    throw new Error(`Desktop Renderer isolation failed: ${JSON.stringify(state)}`);
  }
  if (
    expectedDevicePixelRatio > 0 &&
    (!Number.isFinite(state.devicePixelRatio) || state.devicePixelRatio < expectedDevicePixelRatio)
  ) {
    throw new Error(`Desktop high-DPI scale was not applied: ${JSON.stringify(state)}`);
  }

  if (auditAccessibility) {
    const domAudit = await window.webContents.executeJavaScript(`(() => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const controls = [...document.querySelectorAll('button, summary')];
      const unnamedControls = controls
        .filter((element) => !(element.getAttribute('aria-label') || element.textContent || '').trim())
        .map((element) => element.tagName);
      document.body.tabIndex = -1;
      document.body.focus();
      return {
        duplicateIds,
        unnamedControls,
        hasMain: document.querySelectorAll('main').length === 1,
        hasNamedNavigation: Boolean(document.querySelector('nav[aria-label]')),
        hasPrimaryHeading: document.querySelectorAll('h1').length === 1,
      };
    })()`);
    if (
      domAudit.duplicateIds.length > 0 ||
      domAudit.unnamedControls.length > 0 ||
      !domAudit.hasMain ||
      !domAudit.hasNamedNavigation ||
      !domAudit.hasPrimaryHeading
    ) {
      throw new Error(`Desktop DOM accessibility audit failed: ${JSON.stringify(domAudit)}`);
    }

    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const focusAudit = await window.webContents.executeJavaScript(`(() => {
      const active = document.activeElement;
      const style = active ? getComputedStyle(active) : null;
      return {
        tagName: active?.tagName,
        name: (active?.getAttribute('aria-label') || active?.textContent || '').trim(),
        outlineStyle: style?.outlineStyle,
        outlineWidth: style?.outlineWidth,
      };
    })()`);
    if (
      focusAudit.tagName !== 'BUTTON' ||
      !focusAudit.name ||
      focusAudit.outlineStyle === 'none' ||
      focusAudit.outlineWidth === '0px'
    ) {
      throw new Error(`Desktop keyboard focus audit failed: ${JSON.stringify(focusAudit)}`);
    }

    let accessibilityTree;
    try {
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Accessibility.enable');
      accessibilityTree = await window.webContents.debugger.sendCommand(
        'Accessibility.getFullAXTree',
      );
    } finally {
      if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    }
    const exposed = accessibilityTree?.nodes?.filter((node) => !node.ignored) ?? [];
    const buttons = exposed.filter((node) => node.role?.value === 'button');
    const headings = exposed.filter((node) => node.role?.value === 'heading');
    if (
      buttons.length === 0 ||
      buttons.some((node) => !String(node.name?.value ?? '').trim()) ||
      headings.length < 2
    ) {
      throw new Error(
        `Desktop accessibility tree audit failed: ${JSON.stringify({ buttons, headings })}`,
      );
    }
  }

  if (screenshot) {
    const image = await window.webContents.capturePage();
    await writeFile(path.resolve(screenshot), image.toPNG());
  }
  finished = true;
  window.close();
}

const timeout = setTimeout(() => {
  fail(new Error('Desktop window was not created within 20 seconds'));
}, 20_000);
timeout.unref();

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void inspect(window)
      .catch(fail)
      .finally(() => {
        clearTimeout(timeout);
      });
  });
});

await import('../dist/desktop/main.js');
