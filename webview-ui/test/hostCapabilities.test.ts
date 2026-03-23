import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BottomToolbar } from '../src/components/BottomToolbar.js';
import { DebugView } from '../src/components/DebugView.js';
import { SettingsModal } from '../src/components/SettingsModal.js';
import { ToolOverlay } from '../src/office/components/ToolOverlay.js';
import { CharacterState, Direction } from '../src/office/types.js';
import {
  applyHostCapabilitiesMessage,
  getHostCapabilitiesSnapshot,
  postPrimaryAgentFocus,
} from '../src/vscodeApi.js';

function setCapabilities(overrides?: {
  backendCapabilities?: Partial<
    ReturnType<typeof getHostCapabilitiesSnapshot>['backendCapabilities']
  >;
  hostCapabilities?: Partial<ReturnType<typeof getHostCapabilitiesSnapshot>['hostCapabilities']>;
}) {
  applyHostCapabilitiesMessage({
    type: 'hostCapabilitiesLoaded',
    backendCapabilities: {
      observe: true,
      launch: true,
      select: true,
      close: true,
      ...(overrides?.backendCapabilities ?? {}),
    },
    hostCapabilities: {
      revealTranscript: true,
      revealSessionsRoot: true,
      importLayout: true,
      exportLayout: true,
      pickAssetDirectory: true,
      ...(overrides?.hostCapabilities ?? {}),
    },
  });
}

test('stores backend and host capabilities from hostCapabilitiesLoaded', () => {
  setCapabilities({
    backendCapabilities: { select: false, close: false },
    hostCapabilities: { revealSessionsRoot: false, importLayout: false },
  });

  assert.deepEqual(getHostCapabilitiesSnapshot(), {
    backendCapabilities: {
      observe: true,
      launch: true,
      select: false,
      close: false,
    },
    hostCapabilities: {
      revealTranscript: true,
      revealSessionsRoot: false,
      importLayout: false,
      exportLayout: true,
      pickAssetDirectory: true,
    },
  });
});

test('disables the toolbar sessions action when revealing sessions is unsupported', () => {
  setCapabilities({
    hostCapabilities: { revealSessionsRoot: false },
  });

  const html = renderToStaticMarkup(
    React.createElement(BottomToolbar, {
      isEditMode: false,
      onOpenCodexSessions: () => {},
      onToggleEditMode: () => {},
      isDebugMode: false,
      onToggleDebugMode: () => {},
      alwaysShowOverlay: false,
      onToggleAlwaysShowOverlay: () => {},
      externalAssetDirectories: [],
    }),
  );

  assert.match(html, /<button[^>]*disabled[^>]*>\+ Session<\/button>/);
});

test('hides unsupported host actions from the settings modal', () => {
  setCapabilities({
    hostCapabilities: {
      revealSessionsRoot: false,
      exportLayout: false,
      importLayout: false,
      pickAssetDirectory: false,
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(SettingsModal, {
      isOpen: true,
      onClose: () => {},
      isDebugMode: false,
      onToggleDebugMode: () => {},
      alwaysShowOverlay: false,
      onToggleAlwaysShowOverlay: () => {},
      externalAssetDirectories: ['C:\\assets'],
    }),
  );

  assert.doesNotMatch(html, /Open Sessions Folder/);
  assert.doesNotMatch(html, /Export Layout/);
  assert.doesNotMatch(html, /Import Layout/);
  assert.doesNotMatch(html, /Add Asset Directory/);
  assert.match(html, /Sound Notifications/);
});

test('disables debug runtime actions when backend select and close are unsupported', () => {
  setCapabilities({
    backendCapabilities: {
      select: false,
      close: false,
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(DebugView, {
      agents: [7],
      selectedAgent: null,
      agentTools: {},
      agentStatuses: {},
      agentNames: { 7: 'Session #7' },
      subagentTools: {},
      onSelectAgent: () => {},
    }),
  );

  assert.match(html, /<button[^>]*disabled[^>]*>Session #7<\/button>/);
  assert.match(
    html,
    /<button[^>]*disabled[^>]*title="Closing sessions is unavailable in this host">X<\/button>/,
  );
});

test('hides the primary overlay close action when backend close is unsupported', () => {
  setCapabilities({
    backendCapabilities: {
      close: false,
    },
  });

  const originalWindow = globalThis.window;
  globalThis.window = {
    devicePixelRatio: 1,
  } as Window & typeof globalThis;
  const overlayProps = {
    officeState: {
      selectedAgentId: 7,
      hoveredAgentId: null,
      characters: new Map([
        [
          7,
          {
            id: 7,
            x: 16,
            y: 16,
            state: CharacterState.IDLE,
            dir: Direction.DOWN,
            tileCol: 0,
            tileRow: 0,
            path: [],
            moveProgress: 0,
            currentTool: null,
            palette: 0,
            hueShift: 0,
            frame: 0,
            frameTimer: 0,
            wanderTimer: 0,
            wanderCount: 0,
            wanderLimit: 0,
            isSubagent: false,
            parentAgentId: null,
            isActive: false,
            seatId: null,
            bubbleType: null,
            bubbleTimer: 0,
            seatTimer: 0,
            matrixEffect: null,
            matrixEffectTimer: 0,
            matrixEffectSeeds: [],
            folderName: 'Session #7',
          },
        ],
      ]),
      getLayout() {
        return {
          version: 1,
          cols: 10,
          rows: 10,
          tiles: [],
          furniture: [],
        };
      },
    } as unknown as React.ComponentProps<typeof ToolOverlay>['officeState'],
    agents: [7],
    agentTools: {},
    subagentCharacters: [],
    containerRef: {
      current: {
        getBoundingClientRect() {
          return {
            x: 0,
            y: 0,
            top: 0,
            right: 400,
            bottom: 300,
            left: 0,
            width: 400,
            height: 300,
            toJSON() {
              return {};
            },
          };
        },
      },
    } as unknown as React.ComponentProps<typeof ToolOverlay>['containerRef'],
    zoom: 1,
    panRef: {
      current: { x: 0, y: 0 },
    } as unknown as React.ComponentProps<typeof ToolOverlay>['panRef'],
    onCloseAgent: () => {},
    alwaysShowOverlay: true,
    canCloseAgent: false,
  } satisfies React.ComponentProps<typeof ToolOverlay>;

  try {
    const html = renderToStaticMarkup(React.createElement(ToolOverlay, overlayProps));

    assert.doesNotMatch(html, /title="Close agent"/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('suppresses primary focus posts when backend select is unsupported', () => {
  const postedMessages: unknown[] = [];

  postPrimaryAgentFocus({
    canSelectAgent: false,
    agentId: 7,
    postMessage(message) {
      postedMessages.push(message);
    },
  });

  assert.deepEqual(postedMessages, []);
});
