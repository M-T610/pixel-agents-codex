import assert from 'node:assert/strict';
import test from 'node:test';

import * as codexRuntimeAdapterModule from '../../src/runtime/CodexRuntimeAdapter.js';
import {
  StandaloneServer,
  StandaloneClientSession,
  createStandaloneBootstrapMessages,
  translateRuntimeEventToWebviewMessages,
  type StandaloneHostMessage,
  type StandaloneBootstrapMessage,
} from './server.js';
import { StandaloneHostChrome } from './standaloneHostChrome.js';
import { WorkspaceScopeStore } from './workspaceScopeStore.js';

const CodexRuntimeAdapter = codexRuntimeAdapterModule.default.CodexRuntimeAdapter;

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

test('treats standalone-unavailable VS Code actions as explicit no-ops', async () => {
  const hostChrome = new StandaloneHostChrome();
  const unsupportedCommands = [
    { type: 'openCodexSessions' } as const,
    { type: 'exportLayout' } as const,
    { type: 'importLayout' } as const,
    { type: 'addExternalAssetDirectory' } as const,
  ];

  for (const command of unsupportedCommands) {
    const result = await hostChrome.handleCommand(command);

    assert.deepEqual(result, {
      handled: true,
      events: [],
    });
  }
});

test('standalone host boots with codex runtime and emits current ui-compatible snapshot', async (t) => {
  const workspacePath = 'C:\\workspace-a';
  const furnitureCatalog = [
    {
      id: 'desk',
      name: 'Desk',
      label: 'Desk',
      category: 'desks',
      file: 'desk.png',
      width: 1,
      height: 1,
      footprintW: 1,
      footprintH: 1,
      isDesk: true,
      canPlaceOnWalls: false,
    },
  ];
  const furnitureSprites = new Map<string, string[][]>([['desk', [['pixel']]]]);

  let runtimeWorkspacePaths: string[] = [];

  const server = new StandaloneServer({
    hostChrome: new StandaloneHostChrome({
      layout: {
        version: 1,
        tiles: [],
      },
    }),
    workspaceScopeStore: new WorkspaceScopeStore({
      initialScopes: [{ name: 'workspace-a', path: workspacePath }],
    }),
    assets: [
      {
        type: 'assets_loaded',
        furniture: {
          catalog: furnitureCatalog,
          sprites: furnitureSprites,
        },
      },
    ],
    runtimeFactory: ({ workspacePaths, terminalHost }) => {
      runtimeWorkspacePaths = workspacePaths;
      return new CodexRuntimeAdapter({
        workspacePaths,
        terminalHost,
        createWatcher: (listener) => ({
          async start() {},
          postSnapshot() {
            listener({
              type: 'existingAgents',
              agents: [7],
              agentMeta: {
                7: {
                  palette: 2,
                  seatId: 'seat-a',
                },
              },
              folderNames: {
                7: 'workspace-a',
              },
            });
          },
          selectAgent() {
            throw new Error('session selection should remain client-local in standalone');
          },
          hideAgent() {},
          dispose() {},
        }),
      });
    },
  });

  await server.start();
  t.after(async () => {
    await server.stop();
  });

  assert.deepEqual(runtimeWorkspacePaths, [workspacePath]);
  assert.ok(server.port !== null);

  const bootstrapMessages = await connectAndReadBootstrap(server.port);

  assert.deepEqual(
    bootstrapMessages.map((message) => message.step),
    ['capabilities', 'settings', 'scopes', 'assets', 'layout', 'sessions_snapshot'],
  );

  const capabilitiesStep = bootstrapMessages.find((message) => message.step === 'capabilities');
  assert.deepEqual(capabilitiesStep?.payload.messages, [
    {
      type: 'hostCapabilitiesLoaded',
      backendCapabilities: {
        observe: true,
        launch: true,
        select: false,
        close: true,
      },
      hostCapabilities: {
        revealTranscript: false,
        revealSessionsRoot: false,
        importLayout: false,
        exportLayout: false,
        pickAssetDirectory: false,
      },
    },
  ]);

  const assetsStep = bootstrapMessages.find((message) => message.step === 'assets');
  assert.deepEqual(assetsStep?.payload.messages, [
    {
      type: 'furnitureAssetsLoaded',
      catalog: furnitureCatalog,
      sprites: {
        desk: [['pixel']],
      },
    },
  ]);

  const sessionsStep = bootstrapMessages.find((message) => message.step === 'sessions_snapshot');
  assert.deepEqual(sessionsStep?.payload.messages, [
    {
      type: 'existingAgents',
      agents: [7],
      agentMeta: {
        7: {
          palette: 2,
          seatId: 'seat-a',
        },
      },
      folderNames: {
        7: 'workspace-a',
      },
    },
  ]);
});

async function connectAndReadBootstrap(port: number): Promise<StandaloneBootstrapMessage[]> {
  const socket = new WebSocket(`ws://127.0.0.1:${port.toString()}/__pixel_agents_host`);

  return await new Promise<StandaloneBootstrapMessage[]>((resolve, reject) => {
    const bootstrapMessages: StandaloneBootstrapMessage[] = [];

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for standalone bootstrap'));
    }, 5000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ kind: 'command', command: { type: 'webviewReady' } }));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as StandaloneHostMessage;
      if (message.kind !== 'bootstrap') {
        return;
      }

      bootstrapMessages.push(message);
      if (message.step === 'sessions_snapshot') {
        socket.send(JSON.stringify({ kind: 'bootstrap_complete' }));
        clearTimeout(timeout);
        socket.close();
        resolve(bootstrapMessages);
      }
    });

    socket.addEventListener('error', (event) => {
      clearTimeout(timeout);
      reject(event);
    });

    socket.addEventListener('close', () => {
      clearTimeout(timeout);
    });
  });
}
