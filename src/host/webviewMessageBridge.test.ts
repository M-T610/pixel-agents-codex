import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgeHostEventToWebviewMessages } from './webviewMessageBridge.js';

test('assets_loaded maps wall and furniture payloads to current webview messages', () => {
  const solidSets = [[[['solid']]]];
  const glassSets = [[[['glass']]]];
  const catalog = [
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

  const messages = bridgeHostEventToWebviewMessages({
    type: 'assets_loaded',
    walls: { solidSets, glassSets },
    furniture: {
      catalog,
      sprites: furnitureSprites,
    },
  });

  assert.deepEqual(messages, [
    {
      type: 'wallTilesLoaded',
      solidSets,
      glassSets,
    },
    {
      type: 'furnitureAssetsLoaded',
      catalog,
      sprites: {
        desk: [['pixel']],
      },
    },
  ]);
});

test('sessions_snapshot maps runtime session state to existingAgents with folderNames', () => {
  const messages = bridgeHostEventToWebviewMessages({
    type: 'sessions_snapshot',
    sessions: [
      {
        id: 3,
        palette: 1,
        hueShift: 15,
        seatId: 'seat-a',
        folderName: 'workspace-a',
      },
      {
        id: 8,
        folderName: 'workspace-b',
      },
    ],
  });

  assert.deepEqual(messages, [
    {
      type: 'existingAgents',
      agents: [3, 8],
      agentMeta: {
        3: {
          palette: 1,
          hueShift: 15,
          seatId: 'seat-a',
        },
      },
      folderNames: {
        3: 'workspace-a',
        8: 'workspace-b',
      },
    },
  ]);
});
