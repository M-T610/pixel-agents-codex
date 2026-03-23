import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StandaloneClientSession,
  createStandaloneBootstrapMessages,
  type StandaloneHostMessage,
} from './server.js';

test('serves bootstrap in the required order', () => {
  const messages = createStandaloneBootstrapMessages({
    backendCapabilities: {
      observe: true,
      launch: false,
      select: false,
      close: false,
    },
    hostCapabilities: {
      revealTranscript: false,
      revealSessionsRoot: false,
      importLayout: false,
      exportLayout: false,
      pickAssetDirectory: false,
    },
    settings: {
      soundEnabled: true,
      externalAssetDirectories: ['C:\\assets'],
    },
    scopes: [{ name: 'workspace-a', path: 'C:\\workspace-a' }],
    assets: [
      {
        type: 'assets_loaded',
        furniture: {
          catalog: [],
          sprites: new Map(),
        },
      },
    ],
    layout: {
      version: 1,
      tiles: [],
    },
    sessions: [
      {
        id: 7,
        folderName: 'workspace-a',
      },
    ],
  });

  assert.deepEqual(
    messages.map((message) => message.step),
    ['capabilities', 'settings', 'scopes', 'assets', 'layout', 'sessions_snapshot'],
  );
});

test('does not forward live runtime events before bootstrap completes', () => {
  const delivered: StandaloneHostMessage[] = [];
  const session = new StandaloneClientSession((message) => {
    delivered.push(message);
  });

  session.sendBootstrap([
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        backendCapabilities: {
          observe: true,
          launch: false,
          select: false,
          close: false,
        },
        hostCapabilities: {
          revealTranscript: false,
          revealSessionsRoot: false,
          importLayout: false,
          exportLayout: false,
          pickAssetDirectory: false,
        },
      },
    },
  ]);

  session.enqueueRuntimeEvent({
    type: 'status_changed',
    id: 7,
    status: 'waiting',
  });

  assert.deepEqual(delivered, [
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        backendCapabilities: {
          observe: true,
          launch: false,
          select: false,
          close: false,
        },
        hostCapabilities: {
          revealTranscript: false,
          revealSessionsRoot: false,
          importLayout: false,
          exportLayout: false,
          pickAssetDirectory: false,
        },
      },
    },
  ]);

  session.markBootstrapComplete();

  assert.deepEqual(delivered, [
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        backendCapabilities: {
          observe: true,
          launch: false,
          select: false,
          close: false,
        },
        hostCapabilities: {
          revealTranscript: false,
          revealSessionsRoot: false,
          importLayout: false,
          exportLayout: false,
          pickAssetDirectory: false,
        },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'status_changed',
        id: 7,
        status: 'waiting',
      },
    },
  ]);
});
