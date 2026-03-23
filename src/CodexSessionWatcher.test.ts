import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexSessionWatcher } from './CodexSessionWatcher.js';

test('CodexSessionWatcher stays runtime-focused and exposes read-only session accessors', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-watcher-'));
  const sessionFile = path.join(tempRoot, 'thread-1.jsonl');
  fs.writeFileSync(sessionFile, '');

  const watcher = new CodexSessionWatcher([], () => {});
  const rootSessions = new Map([
    [
      'thread-1',
      {
        agentId: 3,
        threadId: 'thread-1',
        threadName: 'Session',
        sessionFile,
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set<string>(),
        activeToolStatuses: new Map<string, string>(),
        activeToolNames: new Map<string, string>(),
        activeSpawnToolIds: new Set<string>(),
        isActive: false,
        isWaiting: false,
        taskCompletePending: false,
      },
    ],
  ]);

  Object.assign(watcher as object, {
    rootSessions,
    sessionsRoot: 'C:\\Users\\Moham\\.codex\\sessions',
  });

  assert.equal('focusAgent' in watcher, false);
  assert.equal('openSessionsFolder' in watcher, false);
  assert.equal(watcher.getSessionFileForAgent(3), sessionFile);
  assert.equal(watcher.getSessionsRoot(), 'C:\\Users\\Moham\\.codex\\sessions');
  assert.equal(watcher.getSessionFileForAgent(99), undefined);
});
