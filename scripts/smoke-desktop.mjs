import console from 'node:console';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

import { app } from 'electron';

const expectedHeading = '等待首个 OTLP 上报';
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
    }))()`);
    if (state.heading === expectedHeading) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (state?.heading !== expectedHeading || !state.body.includes('Host 已就绪')) {
    throw new Error(`Desktop did not reach the Host-ready state: ${JSON.stringify(state)}`);
  }
  if (
    state.processType !== 'undefined' ||
    state.requireType !== 'undefined' ||
    state.bridgeType !== 'object'
  ) {
    throw new Error(`Desktop Renderer isolation failed: ${JSON.stringify(state)}`);
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
