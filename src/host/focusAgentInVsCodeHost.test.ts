import assert from 'node:assert/strict';
import test from 'node:test';

import { focusAgentInVsCodeHost } from './focusAgentInVsCodeHost.js';

test('dispatches selection and reveals the transcript for the focused VS Code agent', async () => {
  const calls: Array<readonly [string, unknown]> = [];
  const transcriptPath = 'C:\\Users\\Moham\\.codex\\sessions\\session-7.jsonl';

  await focusAgentInVsCodeHost({
    agentId: 7,
    runtime: {
      async dispatch(command) {
        calls.push(['dispatch', command]);
      },
      getSessionTranscriptPath(agentId) {
        calls.push(['lookup', agentId]);
        return transcriptPath;
      },
    },
    hostChrome: {
      async revealTranscript(path) {
        calls.push(['reveal', path]);
      },
    },
  });

  assert.deepEqual(calls, [
    ['dispatch', { type: 'select_session', id: 7 }],
    ['lookup', 7],
    ['reveal', transcriptPath],
  ]);
});
