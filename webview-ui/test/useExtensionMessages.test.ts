import assert from 'node:assert/strict';
import { test } from 'node:test';

import { subscribeToExtensionMessages } from '../src/hooks/useExtensionMessages.js';

test('subscribeToExtensionMessages forwards vscode.onMessage payloads and cleans up the listener', () => {
  let registeredType: string | null = null;
  let registeredHandler: ((event: { data: unknown }) => void) | null = null;
  let removedType: string | null = null;
  let removedHandler: ((event: { data: unknown }) => void) | null = null;
  const originalWindow = globalThis.window;

  globalThis.window = {
    addEventListener(type: string, handler: (event: { data: unknown }) => void) {
      registeredType = type;
      registeredHandler = handler;
    },
    removeEventListener(type: string, handler: (event: { data: unknown }) => void) {
      removedType = type;
      removedHandler = handler;
    },
  } as unknown as Window & typeof globalThis;

  try {
    const forwarded: Array<Record<string, unknown>> = [];
    const dispose = subscribeToExtensionMessages((message) => {
      forwarded.push(message);
    });

    assert.equal(registeredType, 'message');
    assert.ok(registeredHandler, 'expected subscribeToExtensionMessages to register a listener');
    const messageHandler = registeredHandler as (event: { data: unknown }) => void;

    messageHandler({ data: null });
    messageHandler({
      data: {
        type: 'settingsLoaded',
        soundEnabled: false,
        externalAssetDirectories: ['C:\\assets'],
      },
    });

    assert.deepEqual(forwarded, [
      {
        type: 'settingsLoaded',
        soundEnabled: false,
        externalAssetDirectories: ['C:\\assets'],
      },
    ]);

    dispose();

    assert.equal(removedType, 'message');
    assert.strictEqual(removedHandler, messageHandler);
  } finally {
    globalThis.window = originalWindow;
  }
});
