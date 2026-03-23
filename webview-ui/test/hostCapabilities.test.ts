import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BottomToolbar } from '../src/components/BottomToolbar.js';
import { DebugView } from '../src/components/DebugView.js';
import { SettingsModal } from '../src/components/SettingsModal.js';
import { applyHostCapabilitiesMessage, getHostCapabilitiesSnapshot } from '../src/vscodeApi.js';

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
