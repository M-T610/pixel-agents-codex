import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StandaloneClientSession,
  createStandaloneBootstrapMessages,
  translateRuntimeEventToWebviewMessages,
  type StandaloneHostMessage,
} from './server.js';

test('serves bootstrap in the required order using translated webview messages', () => {
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

  assert.deepEqual(
    messages.map((message) => message.payload.messages.map((entry) => entry.type)),
    [
      ['hostCapabilitiesLoaded'],
      ['settingsLoaded'],
      ['workspaceFolders'],
      ['furnitureAssetsLoaded'],
      ['layoutLoaded'],
      ['existingAgents'],
    ],
  );
});

test('translates runtime events through the shared webview bridge', () => {
  const messages = translateRuntimeEventToWebviewMessages({
    type: 'agentStatus',
    id: 7,
    status: 'waiting',
  });

  assert.deepEqual(messages, [
    {
      type: 'agentStatus',
      id: 7,
      status: 'waiting',
    },
  ]);
});

test('does not forward live runtime webview messages before bootstrap completes', () => {
  const delivered: StandaloneHostMessage[] = [];
  const session = new StandaloneClientSession((message) => {
    delivered.push(message);
  });

  session.sendBootstrap([
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        messages: [
          {
            type: 'hostCapabilitiesLoaded',
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
        ],
      },
    },
  ]);

  session.enqueueWebviewMessages([
    {
      type: 'agentStatus',
      id: 7,
      status: 'waiting',
    },
  ]);

  assert.deepEqual(delivered, [
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        messages: [
          {
            type: 'hostCapabilitiesLoaded',
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
        ],
      },
    },
  ]);

  session.markBootstrapComplete();

  assert.deepEqual(delivered, [
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        messages: [
          {
            type: 'hostCapabilitiesLoaded',
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
        ],
      },
    },
    {
      kind: 'webview_messages',
      messages: [{ type: 'agentStatus', id: 7, status: 'waiting' }],
    },
  ]);
});

test('queues browser commands until bootstrap completes for the connection', () => {
  const session = new StandaloneClientSession(() => {});

  assert.deepEqual(session.acceptCommand({ type: 'webviewReady' }), [{ type: 'webviewReady' }]);
  assert.deepEqual(session.acceptCommand({ type: 'setSoundEnabled', enabled: false }), []);
  assert.deepEqual(session.acceptCommand({ type: 'focusAgent', id: 9 }), []);

  assert.deepEqual(session.markBootstrapComplete(), [
    { type: 'setSoundEnabled', enabled: false },
    { type: 'focusAgent', id: 9 },
  ]);
});
