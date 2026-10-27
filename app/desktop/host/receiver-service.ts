import { randomBytes } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { DesktopReceiverConnection } from '../shared/host-protocol.js';
import { DesktopOtlpHttpReceiver } from './otlp-http-receiver.js';
import { decodeOtlpJsonProjectionObservations } from './otlp-json-projection.js';

/** Single Desktop Host owner for the loopback OTLP receiver and session secret. */
export class DesktopReceiver extends Service {
  static inject = ['desktopProjection'];

  private receiver: DesktopOtlpHttpReceiver | null = null;
  private sessionToken: string | null = null;

  constructor(context: Context) {
    super(context, 'desktopReceiver');
  }

  async start(): Promise<DesktopReceiverConnection> {
    if (this.receiver !== null) return this.connection();
    const sessionToken = randomBytes(32).toString('base64url');
    const receiver = new DesktopOtlpHttpReceiver({
      sessionToken,
      onExport: (record) => {
        if (record.signal !== 'log' || record.contentType !== 'json') return;
        for (const observation of decodeOtlpJsonProjectionObservations(record.body)) {
          this.ctx.desktopProjection.accept(observation);
        }
      },
    });
    const endpoint = await receiver.start();
    this.receiver = receiver;
    this.sessionToken = sessionToken;
    return { schemaVersion: 1, endpoint, sessionToken };
  }

  connection(): DesktopReceiverConnection {
    const snapshot = this.receiver?.snapshot();
    if (!snapshot?.endpoint || this.sessionToken === null) {
      throw new Error('Desktop OTLP receiver is not active');
    }
    return {
      schemaVersion: 1,
      endpoint: snapshot.endpoint,
      sessionToken: this.sessionToken,
    };
  }

  async stop(): Promise<void> {
    const receiver = this.receiver;
    this.receiver = null;
    this.sessionToken = null;
    await receiver?.stop();
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopReceiver: DesktopReceiver;
  }
}
