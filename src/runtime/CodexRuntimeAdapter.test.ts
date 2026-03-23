import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexRuntimeAdapter } from './CodexRuntimeAdapter.js';
import type { PixelAgentsEvent } from './contracts.js';

interface TestWatcher {
  start(): Promise<void>;
  postSnapshot(): void;
  selectAgent(agentId: number): void;
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

function createWatcherStub(): TestWatcher {
  return {
    async start() {},
    postSnapshot() {},
    selectAgent() {},
    hideAgent() {},
    dispose() {},
  };
}
