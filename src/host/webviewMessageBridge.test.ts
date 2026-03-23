import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeHostEventToWebviewMessages,
  normalizeRuntimeEventToHostEvents,
  renderBootstrapAndRuntimeMessages,
} from './webviewMessageBridge.js';

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

test('normalizes current runtime snapshot events before translating them', () => {
  const hostEvents = normalizeRuntimeEventToHostEvents({
    type: 'existingAgents',
    agents: [8, 3],
    agentMeta: {
      3: {
        palette: 1,
        hueShift: 15,
        seatId: 'seat-a',
      },
    },
    folderNames: {
      8: 'workspace-b',
      3: 'workspace-a',
    },
  });

  assert.deepEqual(hostEvents, [
    {
      type: 'sessions_snapshot',
      sessions: [
        {
          id: 8,
          folderName: 'workspace-b',
        },
        {
          id: 3,
          palette: 1,
          hueShift: 15,
          seatId: 'seat-a',
          folderName: 'workspace-a',
        },
      ],
    },
  ]);

  assert.deepEqual(
    hostEvents.flatMap((event) => bridgeHostEventToWebviewMessages(event)),
    [
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
    ],
  );
});

test('renders buffered runtime messages only after the bootstrap sequence completes', () => {
  const messages = renderBootstrapAndRuntimeMessages({
    bootstrapEvents: [
      {
        type: 'settings_changed',
        soundEnabled: true,
        externalAssetDirectories: ['C:\\assets'],
      },
      {
        type: 'workspace_folders_loaded',
        folders: [{ name: 'workspace-a', path: 'C:\\workspace-a' }],
      },
      {
        type: 'assets_loaded',
        walls: {
          solidSets: [[[['solid']]]],
          glassSets: [[[['glass']]]],
        },
        furniture: {
          catalog: [
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
          ],
          sprites: new Map<string, string[][]>([['desk', [['pixel']]]]),
        },
      },
      {
        type: 'layout_changed',
        layout: { version: 1, tiles: [] },
      },
    ],
    runtimeEvents: [
      {
        type: 'existingAgents',
        agents: [7],
        agentMeta: {
          7: {
            seatId: 'seat-a',
          },
        },
        folderNames: {
          7: 'workspace-a',
        },
      },
      {
        type: 'agentStatus',
        id: 7,
        status: 'waiting',
      },
    ],
  });

  assert.deepEqual(
    messages.map((message) => message.type),
    [
      'settingsLoaded',
      'workspaceFolders',
      'wallTilesLoaded',
      'furnitureAssetsLoaded',
      'layoutLoaded',
      'existingAgents',
      'agentStatus',
    ],
  );
});
