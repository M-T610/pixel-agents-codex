import assert from 'node:assert/strict';
import test from 'node:test';

import * as codexRuntimeAdapterModule from '../../src/runtime/CodexRuntimeAdapter.js';
import type { PixelAgentsRuntimeAdapter } from '../../src/runtime/contracts.js';
import {
  StandaloneServer,
  StandaloneClientSession,
  createDetachedTerminalHost,
  createStandaloneBootstrapMessages,
  translateRuntimeEventToWebviewMessages,
  type DetachedSpawnOptions,
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
      clientEvents: [],
    });
  }
});

test('focusAgent sends agentSelected only to the originating standalone client', async (t) => {
  const server = new StandaloneServer({
    runtime: createNoopRuntime(),
  });
  await server.start();
  t.after(async () => {
    await server.stop();
  });

  assert.ok(server.port !== null);

  const firstClient = await connectAndBootstrapClient(server.port);
  const secondClient = await connectAndBootstrapClient(server.port);
  t.after(() => {
    firstClient.close();
    secondClient.close();
  });

  firstClient.sendCommand({ type: 'focusAgent', id: 11 });

  const selectedMessage = await firstClient.waitForMessage(
    (message) =>
      message.kind === 'webview_messages' &&
      message.messages.length === 1 &&
      message.messages[0]?.type === 'agentSelected' &&
      message.messages[0]?.id === 11,
  );
  assert.deepEqual(selectedMessage, {
    kind: 'webview_messages',
    messages: [{ type: 'agentSelected', id: 11 }],
  });

  await secondClient.assertNoMessage(
    (message) =>
      message.kind === 'webview_messages' &&
      message.messages.some((entry) => entry.type === 'agentSelected'),
  );
});

test('detached standalone launch ignores invalid cwd and never throws on spawn failure', () => {
  const spawnCalls: Array<{ command: string; options: Record<string, unknown> }> = [];
  const terminalHost = createDetachedTerminalHost(
    (command: string, options: DetachedSpawnOptions) => {
      spawnCalls.push({
        command,
        options: options as unknown as Record<string, unknown>,
      });
      const error = new Error('ENOENT');
      (error as Error & { code?: string }).code = 'ENOENT';
      throw error;
    },
  );

  const invalidCwd = `C:\\__pixel_agents_missing__\\${Date.now().toString()}`;

  assert.doesNotThrow(() => {
    const terminal = terminalHost.createTerminal({
      name: 'Codex #1',
      cwd: invalidCwd,
    });
    terminal.sendText('codex');
  });

  assert.deepEqual(spawnCalls, [
    {
      command: 'codex',
      options: {
        detached: true,
        shell: true,
        stdio: 'ignore',
      },
    },
  ]);
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
          getSessionTranscriptPath() {
            return null;
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

function createNoopRuntime() {
  const runtime: PixelAgentsRuntimeAdapter = {
    getCapabilities() {
      return {
        observe: true,
        launch: false,
        select: false,
        close: false,
      };
    },
    async connect() {
      return {
        backendCapabilities: {
          observe: true,
          launch: false,
          select: false,
          close: false,
        },
      };
    },
    async dispatch() {
      throw new Error('dispatch should not be called in this test');
    },
    dispose() {},
  };

  return runtime;
}

async function connectAndBootstrapClient(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port.toString()}/__pixel_agents_host`);
  const queuedMessages: StandaloneHostMessage[] = [];
  const waitingResolvers: Array<(message: StandaloneHostMessage) => void> = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as StandaloneHostMessage;
    const resolver = waitingResolvers.shift();
    if (resolver) {
      resolver(message);
      return;
    }

    queuedMessages.push(message);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out opening websocket'));
    }, 5000);

    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.addEventListener('error', (event) => {
      clearTimeout(timeout);
      reject(event);
    });
  });

  socket.send(JSON.stringify({ kind: 'command', command: { type: 'webviewReady' } }));

  while (true) {
    const message = await waitForStandaloneMessage(queuedMessages, waitingResolvers);
    if (message.kind !== 'bootstrap') {
      continue;
    }

    if (message.step === 'sessions_snapshot') {
      socket.send(JSON.stringify({ kind: 'bootstrap_complete' }));
      break;
    }
  }

  return {
    close() {
      socket.close();
    },
    sendCommand(command: Record<string, unknown>) {
      socket.send(JSON.stringify({ kind: 'command', command }));
    },
    async waitForMessage(
      predicate: (message: StandaloneHostMessage) => boolean,
      timeoutMs = 1000,
    ): Promise<StandaloneHostMessage> {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const message = await waitForStandaloneMessage(
          queuedMessages,
          waitingResolvers,
          deadline - Date.now(),
        );
        if (predicate(message)) {
          return message;
        }
      }

      throw new Error('Timed out waiting for matching host message');
    },
    async assertNoMessage(
      predicate: (message: StandaloneHostMessage) => boolean,
      timeoutMs = 250,
    ): Promise<void> {
      try {
        const message = await this.waitForMessage(predicate, timeoutMs);
        assert.fail(`Unexpected host message: ${JSON.stringify(message)}`);
      } catch (error) {
        assert.match(String(error), /Timed out waiting for standalone host message/);
      }
    },
  };
}

async function waitForStandaloneMessage(
  queuedMessages: StandaloneHostMessage[],
  waitingResolvers: Array<(message: StandaloneHostMessage) => void>,
  timeoutMs = 5000,
): Promise<StandaloneHostMessage> {
  const immediate = queuedMessages.shift();
  if (immediate) {
    return immediate;
  }

  return await new Promise<StandaloneHostMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waitingResolvers.indexOf(resolve);
      if (index >= 0) {
        waitingResolvers.splice(index, 1);
      }
      reject(new Error('Timed out waiting for standalone host message'));
    }, timeoutMs);

    waitingResolvers.push((message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}
