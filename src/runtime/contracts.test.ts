import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createHostCapabilities } from './contracts.js';

test('createHostCapabilities defaults all host capabilities to false', () => {
  const capabilities = createHostCapabilities();

  assert.deepEqual(Object.keys(capabilities).sort(), [
    'exportLayout',
    'importLayout',
    'pickAssetDirectory',
    'revealSessionsRoot',
    'revealTranscript',
  ]);
  assert.deepEqual(capabilities, {
    revealTranscript: false,
    revealSessionsRoot: false,
    importLayout: false,
    exportLayout: false,
    pickAssetDirectory: false,
  });
});

test('createHostCapabilities applies overrides', () => {
  const capabilities = createHostCapabilities({
    revealTranscript: true,
    exportLayout: true,
    pickAssetDirectory: true,
  });

  assert.deepEqual(capabilities, {
    revealTranscript: true,
    revealSessionsRoot: false,
    importLayout: false,
    exportLayout: true,
    pickAssetDirectory: true,
  });
});
