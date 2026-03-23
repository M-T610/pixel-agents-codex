import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexRuntimeAdapter } from './CodexRuntimeAdapter.js';
import type { PixelAgentsEvent } from './contracts.js';

interface TestWatcher {
  start(): Promise<void>;
  postSnapshot(): void;
  selectAgent(agentId: number): void;
  getSessionTranscriptPath(agentId: number): string | null;
  hideAgent(agentId: number): void;
  dispose(): void;
}

test('getCapabilities reports Codex runtime actions', () => {
  const adapter = new CodexRuntimeAdapter({
    workspacePaths: [],
    createWatcher: () => createWatcherStub(),
  });

  assert.deepEqual(adapter.getCapabilities(), {
    observe: true,
    launch: true,
    select: true,
    close: true,
  });
});

test('connect returns bootstrap before forwarding snapshot and live events', async () => {
  const received: PixelAgentsEvent[] = [];
  const calls: string[] = [];
  let emitEvent: ((event: PixelAgentsEvent) => void) | undefined;

  const adapter = new CodexRuntimeAdapter({
    workspacePaths: [],
    createWatcher: (sink) => {
      emitEvent = sink;
      return {
        async start() {
          calls.push('start');
          emitEvent?.({ type: 'live-event', source: 'start' });
        },
        postSnapshot() {
          calls.push('postSnapshot');
          emitEvent?.({ type: 'snapshot-event' });
        },
        selectAgent() {},
        getSessionTranscriptPath() {
          return null;
        },
        hideAgent() {},
        dispose() {},
      };
    },
  });

  const bootstrap = await adapter.connect((event) => {
    received.push(event);
  });

  assert.deepEqual(bootstrap, {
    backendCapabilities: adapter.getCapabilities(),
  });
  assert.deepEqual(calls, ['start']);
  assert.deepEqual(received, []);

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['start', 'postSnapshot']);
  assert.deepEqual(
    received.map((event: PixelAgentsEvent) => event.type),
    ['snapshot-event', 'live-event'],
  );
});

test('dispatch routes launch, select, and close commands through runtime services', async () => {
  const calls: Array<{ type: string; value?: unknown }> = [];

  const adapter = new CodexRuntimeAdapter({
    workspacePaths: [],
    createWatcher: () => ({
      ...createWatcherStub(),
      selectAgent(agentId: number) {
        calls.push({ type: 'select', value: agentId });
      },
      getSessionTranscriptPath() {
        return null;
      },
      hideAgent(agentId: number) {
        calls.push({ type: 'close', value: agentId });
      },
    }),
    terminalHost: {
      getTerminalNames() {
        return ['Codex #1'];
      },
      createTerminal(options) {
        calls.push({ type: 'createTerminal', value: options });
        return {
          show() {
            calls.push({ type: 'show' });
          },
          sendText(command) {
            calls.push({ type: 'sendText', value: command });
          },
        };
      },
    },
  });

  await adapter.dispatch({
    type: 'launch_session',
    cwd: 'C:\\workspace',
    bypassPermissions: true,
  });
  await adapter.dispatch({ type: 'select_session', id: 7 });
  await adapter.dispatch({ type: 'close_session', id: 7 });

  assert.deepEqual(calls, [
    {
      type: 'createTerminal',
      value: {
        cwd: 'C:\\workspace',
        name: 'Codex #2',
      },
    },
    { type: 'show' },
    {
      type: 'sendText',
      value: 'codex --dangerously-bypass-approvals-and-sandbox',
    },
    { type: 'select', value: 7 },
    { type: 'close', value: 7 },
  ]);
});

test('connect retries with a fresh watcher after a startup failure', async () => {
  const attempts: string[] = [];
  let watcherCount = 0;

  const adapter = new CodexRuntimeAdapter({
    workspacePaths: [],
    createWatcher: () => {
      watcherCount += 1;
      const watcherId = watcherCount;
      return {
        async start() {
          attempts.push(`start:${watcherId}`);
          if (watcherId === 1) {
            throw new Error('transient failure');
          }
        },
        postSnapshot() {
          attempts.push(`postSnapshot:${watcherId}`);
        },
        selectAgent() {},
        getSessionTranscriptPath() {
          return null;
        },
        hideAgent() {},
        dispose() {
          attempts.push(`dispose:${watcherId}`);
        },
      };
    },
  });

  await assert.rejects(
    adapter.connect(() => {}),
    /transient failure/,
  );

  const bootstrap = await adapter.connect(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(bootstrap, {
    backendCapabilities: adapter.getCapabilities(),
  });
  assert.deepEqual(attempts, ['start:1', 'dispose:1', 'start:2', 'postSnapshot:2']);
});

test('connect replays the runtime snapshot for a new listener after the adapter is already connected', async () => {
  const firstListenerEvents: string[] = [];
  const secondListenerEvents: string[] = [];
  const calls: string[] = [];
  let emitEvent: ((event: PixelAgentsEvent) => void) | undefined;
  let snapshotCount = 0;

  const adapter = new CodexRuntimeAdapter({
    workspacePaths: [],
    createWatcher: (sink) => {
      emitEvent = sink;
      return {
        async start() {
          calls.push('start');
        },
        postSnapshot() {
          snapshotCount += 1;
          calls.push(`postSnapshot:${snapshotCount}`);
          emitEvent?.({ type: `snapshot-event-${snapshotCount}` });
        },
        selectAgent() {},
        getSessionTranscriptPath() {
          return null;
        },
        hideAgent() {},
        dispose() {},
      };
    },
  });

  await adapter.connect((event) => {
    firstListenerEvents.push(event.type);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const reconnectBootstrap = await adapter.connect((event) => {
    secondListenerEvents.push(event.type);
  });
  emitEvent?.({ type: 'live-event-after-reconnect' });

  assert.deepEqual(reconnectBootstrap, {
    backendCapabilities: adapter.getCapabilities(),
  });
  assert.deepEqual(secondListenerEvents, []);

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['start', 'postSnapshot:1', 'postSnapshot:2']);
  assert.deepEqual(firstListenerEvents, ['snapshot-event-1']);
  assert.deepEqual(secondListenerEvents, ['snapshot-event-2', 'live-event-after-reconnect']);
});

function createWatcherStub(): TestWatcher {
  return {
    async start() {},
    postSnapshot() {},
    selectAgent() {},
    getSessionTranscriptPath() {
      return null;
    },
    hideAgent() {},
    dispose() {},
  };
}
