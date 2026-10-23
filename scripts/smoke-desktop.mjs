import console from 'node:console';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

import { app } from 'electron';

const primaryContext = {
  workspaceId: 'repoctopus',
  changeId: 'add-windows-desktop-dashboard',
  runId: 'run-desktop-smoke',
  streamId: 'run-desktop-smoke',
};
const secondaryContext = {
  workspaceId: 'team-platform',
  changeId: 'harden-delivery-gates',
  runId: 'run-delivery-gates',
  streamId: 'run-delivery-gates',
};
const screenshot = process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT;
const screenshotSection = process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT_SECTION;
const screenshotWidth = Number(process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT_WIDTH ?? 0);
const screenshotHeight = Number(process.env.REPOCTOPUS_DESKTOP_SMOKE_SCREENSHOT_HEIGHT ?? 0);
let finished = false;
let resolveDesktopReady;
let rejectDesktopReady;
const desktopReady = new Promise((resolve, reject) => {
  resolveDesktopReady = resolve;
  rejectDesktopReady = reject;
});

function fail(error) {
  if (finished) return;
  finished = true;
  console.error('desktop smoke failed', error);
  app.exit(1);
}

const attribute = (key, value) => ({
  key,
  value:
    typeof value === 'number'
      ? { intValue: String(value) }
      : typeof value === 'boolean'
        ? { boolValue: value }
        : { stringValue: value },
});

async function sendObservation(ready, context, sequence, stageName) {
  const identitySeed =
    context === primaryContext ? (sequence === 1 ? ['c', 'd'] : ['e', 'f']) : ['a', 'b'];
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
                    attribute('repoctopus.envelope.id', `sha256:${identitySeed[0].repeat(64)}`),
                    attribute('repoctopus.envelope.digest', `sha256:${identitySeed[1].repeat(64)}`),
                    attribute('repoctopus.stream.id', context.streamId),
                    attribute('repoctopus.event.id', `${context.streamId}-${sequence}`),
                    attribute('repoctopus.event.type', 'run.progressed'),
                    attribute('repoctopus.event.sequence', sequence),
                    attribute('repoctopus.observed_at', new Date().toISOString()),
                    attribute('repoctopus.workspace.id', context.workspaceId),
                    attribute('repoctopus.change.id', context.changeId),
                    attribute('repoctopus.change.status', 'active'),
                    attribute('repoctopus.run.id', context.runId),
                    attribute('repoctopus.run.status', 'active'),
                    attribute('repoctopus.stage.name', stageName),
                    ...(context === primaryContext && sequence === 1
                      ? [
                          attribute('repoctopus.workflow.name', 'self-hosted-development'),
                          attribute('repoctopus.workflow.version', '1.0.0'),
                          attribute('repoctopus.execution.id', 'task-desktop-smoke'),
                          attribute('repoctopus.execution.parent.id', context.runId),
                          attribute('repoctopus.execution.kind', 'workflow-action'),
                          attribute('repoctopus.execution.subject.kind', 'agent'),
                          attribute('repoctopus.execution.subject.id', 'agent-desktop-smoke'),
                          attribute('repoctopus.execution.subject.provider', 'smoke-provider'),
                          attribute('repoctopus.task.id', 'task-desktop-smoke'),
                          attribute('repoctopus.task.ref', 'desktop.smoke-renderer'),
                          attribute('repoctopus.task.type', 'checkpoint'),
                          attribute('repoctopus.task.status', 'pending'),
                          attribute('repoctopus.verification.id', 'attempt-desktop-smoke'),
                          attribute('repoctopus.verification.status', 'satisfied'),
                          attribute('repoctopus.verification.outcome', 'passed_with_warnings'),
                          attribute('repoctopus.evidence.attempt.id', 'attempt-desktop-smoke'),
                          attribute('repoctopus.evidence.bundle.id', 'bundle-desktop-smoke'),
                          attribute('repoctopus.evidence.gate.status', 'satisfied'),
                          attribute(
                            'repoctopus.evidence.artifactDigest',
                            `sha256:${'8'.repeat(64)}`,
                          ),
                          attribute('repoctopus.evidence.artifactType', 'command-stdout'),
                          attribute('repoctopus.evidence.mediaType', 'text/plain; charset=utf-8'),
                          attribute('repoctopus.evidence.artifactSize', 4096),
                          attribute('repoctopus.evidence.redacted', true),
                          attribute('repoctopus.blocker.category', 'human-decision'),
                          attribute('repoctopus.blocker.request.id', 'task-desktop-smoke'),
                          attribute('repoctopus.next_action.id', 'task-desktop-smoke'),
                          attribute('repoctopus.next_action.type', 'checkpoint'),
                          attribute('repoctopus.next_action.ref', 'desktop.smoke-renderer'),
                          attribute('repoctopus.next_action.stage', 'implementation'),
                          attribute('repoctopus.prompt', 'PRIVATE_PROMPT_NEVER_RENDER'),
                          attribute('repoctopus.reply', 'PRIVATE_REPLY_NEVER_RENDER'),
                          attribute('repoctopus.command.output', 'PRIVATE_OUTPUT_NEVER_RENDER'),
                          attribute(
                            'repoctopus.artifact.path',
                            'C:\\Users\\private\\desktop-smoke.log',
                          ),
                        ]
                      : []),
                  ],
                  ...(context === primaryContext && sequence === 1
                    ? { body: { stringValue: 'PRIVATE_BODY_NEVER_RENDER' } }
                    : {}),
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Desktop OTLP smoke request failed: ${response.status}`);
}

async function inspect(window) {
  const readState = () =>
    window.webContents.executeJavaScript(`(() => ({
      heading: document.querySelector('h1')?.textContent,
      body: document.body.innerText,
      dashboardState: document.querySelector('[data-dashboard-state]')?.dataset.dashboardState,
      selectedChange: document.querySelector('[aria-current="page"] .change-selector__name')?.textContent,
      changes: [...document.querySelectorAll('.change-selector__name')].map((node) => node.textContent),
      processType: typeof globalThis.process,
      requireType: typeof globalThis.require,
      bridgeType: typeof window.repoctopusDesktop,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))()`);

  async function waitForState(predicate) {
    const deadline = Date.now() + 15_000;
    let state;
    while (Date.now() < deadline) {
      state = await readState();
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Desktop state did not converge: ${JSON.stringify(state)}`);
  }

  async function selectChange(changeId) {
    const clicked = await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('.change-selector')].find(
        (candidate) => candidate.querySelector('.change-selector__name')?.textContent === ${JSON.stringify(changeId)},
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Desktop navigation could not select ${changeId}`);
    return waitForState((state) => state.heading === changeId && state.selectedChange === changeId);
  }

  const ready = await desktopReady;
  let state = await waitForState((candidate) => candidate.heading === primaryContext.changeId);
  if (
    state.dashboardState !== 'live' ||
    !state.body.includes('实时接收') ||
    !state.body.includes(primaryContext.runId) ||
    !state.body.includes('implementation') ||
    !state.body.includes('agent-desktop-smoke') ||
    !state.body.includes('desktop.smoke-renderer') ||
    !state.body.includes('attempt-desktop-smoke') ||
    !state.body.includes('command-stdout') ||
    !state.body.includes('等待人工决定') ||
    !state.body.includes('下一步动作') ||
    !state.body.includes('阶段与任务') ||
    !state.body.includes('验证与阻塞') ||
    !state.body.includes('接收与事件') ||
    !state.body.includes('本地目的地') ||
    !state.body.includes('desktop-local') ||
    !state.body.includes('run.progressed') ||
    !state.body.includes('最近事件')
  ) {
    throw new Error(`Desktop did not render the OTLP projection: ${JSON.stringify(state)}`);
  }
  if (
    /PRIVATE_BODY|PRIVATE_PROMPT|PRIVATE_REPLY|PRIVATE_OUTPUT|C:\\Users\\private/iu.test(state.body)
  ) {
    throw new Error(`Desktop rendered private OTLP content: ${JSON.stringify(state)}`);
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
  if (screenshot) {
    if (screenshotWidth > 0 && screenshotHeight > 0) {
      window.setSize(screenshotWidth, screenshotHeight);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (screenshotSection) {
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector(${JSON.stringify(`#${screenshotSection}`)})?.scrollIntoView({
          block: 'start',
          behavior: 'instant',
        });
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const image = await window.webContents.capturePage();
    await writeFile(path.resolve(screenshot), image.toPNG());
  }

  await selectChange(primaryContext.changeId);
  await sendObservation(ready, secondaryContext, 1, 'verification');
  state = await waitForState(
    (candidate) =>
      candidate.changes.includes(secondaryContext.changeId) &&
      candidate.heading === primaryContext.changeId,
  );
  if (state.selectedChange !== primaryContext.changeId) {
    throw new Error(`A new OTLP context stole the explicit selection: ${JSON.stringify(state)}`);
  }

  await selectChange(secondaryContext.changeId);
  const reloaded = new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
  });
  window.webContents.reload();
  await reloaded;
  await waitForState(
    (candidate) =>
      candidate.heading === secondaryContext.changeId &&
      candidate.selectedChange === secondaryContext.changeId,
  );

  await sendObservation(ready, primaryContext, 2, 'implementation');
  state = await waitForState(
    (candidate) =>
      candidate.heading === secondaryContext.changeId &&
      candidate.body.includes(secondaryContext.runId),
  );
  if (state.selectedChange !== secondaryContext.changeId) {
    throw new Error(`An OTLP update stole the restored selection: ${JSON.stringify(state)}`);
  }

  window.setSize(680, 480);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const narrow = await readState();
  if (
    narrow.heading !== secondaryContext.changeId ||
    !narrow.body.includes(secondaryContext.runId) ||
    narrow.scrollWidth > narrow.innerWidth
  ) {
    throw new Error(`Desktop layout failed at minimum width: ${JSON.stringify(narrow)}`);
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
void desktop
  .waitForDesktopHostReady()
  .then(async (ready) => {
    resolveDesktopReady(ready);
    await sendObservation(ready, primaryContext, 1, 'implementation');
  })
  .catch((error) => {
    rejectDesktopReady(error);
    fail(error);
  });
