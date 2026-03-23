import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexLaunchCommand,
  getNextCodexTerminalName,
  launchCodexTerminal,
} from './codexTerminal.js';

test('buildCodexLaunchCommand defaults to codex', () => {
  assert.equal(buildCodexLaunchCommand(), 'codex');
});

test('buildCodexLaunchCommand adds bypass flag when requested', () => {
  assert.equal(
    buildCodexLaunchCommand({ bypassPermissions: true }),
    'codex --dangerously-bypass-approvals-and-sandbox',
  );
});

test('getNextCodexTerminalName starts at one', () => {
  assert.equal(getNextCodexTerminalName([]), 'Codex #1');
});

test('getNextCodexTerminalName skips unrelated terminals', () => {
  assert.equal(getNextCodexTerminalName(['Codex #1', 'Claude Code #9']), 'Codex #2');
});

test('getNextCodexTerminalName increments past gaps', () => {
  assert.equal(getNextCodexTerminalName(['Codex #1', 'Codex #3']), 'Codex #4');
});

test('launchCodexTerminal creates, shows, and starts the next Codex terminal', () => {
  const created: Array<Record<string, unknown>> = [];
  const sentCommands: string[] = [];

  launchCodexTerminal({
    cwd: 'C:\\workspace',
    bypassPermissions: true,
    terminalHost: {
      getTerminalNames() {
        return ['Codex #2', 'Claude Code #5'];
      },
      createTerminal(options) {
        created.push(options);
        return {
          show() {
            created.push({ shown: true });
          },
          sendText(command) {
            sentCommands.push(command);
          },
        };
      },
    },
  });

  assert.deepEqual(created, [
    {
      cwd: 'C:\\workspace',
      name: 'Codex #3',
    },
    { shown: true },
  ]);
  assert.deepEqual(sentCommands, ['codex --dangerously-bypass-approvals-and-sandbox']);
});
