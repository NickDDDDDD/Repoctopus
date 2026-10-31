import { describe, expect, it } from 'vitest';

import {
  DESKTOP_RECEIVER_HEALTH_PROTOCOL,
  parseDesktopReceiverHealth,
  serializeDesktopReceiverHealth,
} from '../app/desktop/shared/receiver-health.js';

describe('desktop receiver health contract', () => {
  it('round-trips the single versioned health representation', () => {
    const body = serializeDesktopReceiverHealth(4_242);

    expect(parseDesktopReceiverHealth('application/json', body)).toEqual({
      schemaVersion: 1,
      protocolVersion: DESKTOP_RECEIVER_HEALTH_PROTOCOL,
      pid: 4_242,
    });
  });

  it.each([
    [
      'wrong content type',
      'text/plain',
      '{"schemaVersion":1,"protocolVersion":"repoctopus.desktop.receiver-health/v1","pid":4242}',
    ],
    [
      'unknown field',
      'application/json',
      '{"schemaVersion":1,"protocolVersion":"repoctopus.desktop.receiver-health/v1","pid":4242,"extra":true}',
    ],
    [
      'unknown schema',
      'application/json',
      '{"schemaVersion":2,"protocolVersion":"repoctopus.desktop.receiver-health/v1","pid":4242}',
    ],
    [
      'unknown protocol',
      'application/json',
      '{"schemaVersion":1,"protocolVersion":"repoctopus.desktop.receiver-health/v2","pid":4242}',
    ],
    [
      'invalid pid',
      'application/json',
      '{"schemaVersion":1,"protocolVersion":"repoctopus.desktop.receiver-health/v1","pid":0}',
    ],
    ['oversized body', 'application/json', ' '.repeat(1_025)],
  ])('rejects %s', (_name, contentType, body) => {
    expect(parseDesktopReceiverHealth(contentType, body)).toBeNull();
  });

  it('accepts the JSON media type with parameters', () => {
    expect(
      parseDesktopReceiverHealth(
        'application/json; charset=utf-8',
        serializeDesktopReceiverHealth(7),
      ),
    ).toMatchObject({ pid: 7 });
  });
});
