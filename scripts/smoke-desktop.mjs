import console from 'node:console';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

import { app } from 'electron';

const expectedHeading = 'add-windows-desktop-dashboard';
const screenshot = process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT;
let finished = false;

function fail(error) {
  if (finished) return;
  finished = true;
  console.error('desktop smoke failed', error);
  app.exit(1);
}

async function inspect(window) {
  const deadline = Date.now() + 15_000;
  let state;
  while (Date.now() < deadline) {
    state = await window.webContents.executeJavaScript(`(() => ({
      heading: document.querySelector('h1')?.textContent,
      body: document.body.innerText,
      processType: typeof globalThis.process,
      requireType: typeof globalThis.require,
      bridgeType: typeof window.repoctopusDesktop,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))()`);
    if (state.heading === expectedHeading) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (
    state?.heading !== expectedHeading ||
    !state.body.includes('实时接收') ||
    !state.body.includes('run-desktop-smoke') ||
    !state.body.includes('implementation')
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
  if (state.scrollWidth > state.innerWidth) {
    throw new Error(`Desktop layout overflowed at default width: ${JSON.stringify(state)}`);
  }

  window.setSize(680, 480);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const narrow = await window.webContents.executeJavaScript(`(() => ({
    heading: document.querySelector('h1')?.textContent,
    body: document.body.innerText,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))()`);
  if (
    narrow.heading !== expectedHeading ||
    !narrow.body.includes('run-desktop-smoke') ||
    narrow.scrollWidth > narrow.innerWidth
  ) {
    throw new Error(`Desktop layout failed at minimum width: ${JSON.stringify(narrow)}`);
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

const desktop = await import('../dist/desktop/main.js');
const attribute = (key, value) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
});
void desktop
  .waitForDesktopHostReady()
  .then(async (ready) => {
    const response = await globalThis.fetch(new URL('/v1/logs', ready.receiver.origin), {
      method: 'POST',
      headers: {
        authorization: ready.receiver.authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      attribute('repoctopus.telemetry.schema.version', 1),
                      attribute('repoctopus.envelope.id', `sha256:${'c'.repeat(64)}`),
                      attribute('repoctopus.envelope.digest', `sha256:${'d'.repeat(64)}`),
                      attribute('repoctopus.stream.id', 'run-desktop-smoke'),
                      attribute('repoctopus.event.id', 'event-desktop-smoke'),
                      attribute('repoctopus.event.type', 'run.progressed'),
                      attribute('repoctopus.event.sequence', 1),
                      attribute('repoctopus.observed_at', new Date().toISOString()),
                      attribute('repoctopus.workspace.id', 'repoctopus'),
                      attribute('repoctopus.change.id', 'add-windows-desktop-dashboard'),
                      attribute('repoctopus.change.status', 'active'),
                      attribute('repoctopus.run.id', 'run-desktop-smoke'),
                      attribute('repoctopus.run.status', 'active'),
                      attribute('repoctopus.stage.name', 'implementation'),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Desktop OTLP smoke request failed: ${response.status}`);
  })
  .catch(fail);
