import { randomBytes } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import { decodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import { DesktopOtlpHttpReceiver } from '../app/desktop/host/otlp-http-receiver.js';
import type { DesktopProjection } from './desktop-projection.js';

export interface DesktopReceiverConnection {
  schemaVersion: 1;
  endpoint: string;
  sessionToken: string;
}

/** Cordis-owned receiver lifecycle. A failed local receiver never changes Runtime domain state. */
export class DesktopReceiver extends Service {
  static inject = ['desktopProjection'];

  private receiver: DesktopOtlpHttpReceiver | null = null;
  private token: string | null = null;
  private readonly projection: DesktopProjection;

  constructor(context: Context) {
    super(context, 'desktopReceiver');
    this.projection = (
      context as Context & { desktopProjection: DesktopProjection }
    ).desktopProjection;
    context.effect(() => () => this.stop());
  }

  async start(): Promise<DesktopReceiverConnection> {
    if (this.receiver !== null) return this.connection();
    const token = randomBytes(32).toString('base64url');
    const receiver = new DesktopOtlpHttpReceiver({
      sessionToken: token,
      onExport: async (request) => {
        if (request.contentType !== 'json') return;
        await this.projection.ingest(decodeObservationOtlpJson(request.body));
      },
    });
    const endpoint = await receiver.start();
    this.receiver = receiver;
    this.token = token;
    return { schemaVersion: 1, endpoint, sessionToken: token };
  }

  connection(): DesktopReceiverConnection {
    const endpoint = this.receiver?.snapshot().endpoint;
    if (endpoint === null || endpoint === undefined || this.token === null) {
      throw new Error('Desktop OTLP receiver is not active');
    }
    return { schemaVersion: 1, endpoint, sessionToken: this.token };
  }

  async stop(): Promise<void> {
    const receiver = this.receiver;
    this.receiver = null;
    this.token = null;
    await receiver?.stop();
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopReceiver: DesktopReceiver;
  }
}
