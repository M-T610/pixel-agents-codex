(function () {
  const WS_PATH = '/__pixel_agents_host';
  const reconnectDelayMs = 1000;
  const queuedMessages = [];
  let socket = null;
  let reconnectTimer = null;
  let bootstrapCompleteSent = false;
  let webviewReadySeen = false;
  let savedState;

  function getSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${WS_PATH}`;
  }

  function dispatchWindowMessage(data) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function sendTransport(message) {
    const encoded = JSON.stringify(message);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
      return;
    }

    queuedMessages.push(encoded);
  }

  function flushQueue() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (queuedMessages.length > 0) {
      socket.send(queuedMessages.shift());
    }

    if (webviewReadySeen) {
      socket.send(JSON.stringify({ kind: 'command', command: { type: 'webviewReady' } }));
    }
  }

  function normalizeFurnitureSprites(sprites) {
    if (!sprites || typeof sprites !== 'object') {
      return {};
    }

    return sprites;
  }

  function dispatchSessionsSnapshot(sessions) {
    const sortedSessions = [...sessions].sort((left, right) => left.id - right.id);
    const agentMeta = {};
    const folderNames = {};

    for (const session of sortedSessions) {
      const meta = {};
      if (typeof session.palette === 'number') {
        meta.palette = session.palette;
      }
      if (typeof session.hueShift === 'number') {
        meta.hueShift = session.hueShift;
      }
      if (typeof session.seatId === 'string') {
        meta.seatId = session.seatId;
      }
      if (Object.keys(meta).length > 0) {
        agentMeta[session.id] = meta;
      }
      if (typeof session.folderName === 'string') {
        folderNames[session.id] = session.folderName;
      }
    }

    dispatchWindowMessage({
      type: 'existingAgents',
      agents: sortedSessions.map((session) => session.id),
      agentMeta,
      folderNames,
    });
  }

  function dispatchHostEvent(event) {
    switch (event.type) {
      case 'settings_changed':
        dispatchWindowMessage({
          type: 'settingsLoaded',
          soundEnabled: event.soundEnabled,
          externalAssetDirectories: event.externalAssetDirectories,
        });
        return;
      case 'workspace_folders_loaded':
        dispatchWindowMessage({
          type: 'workspaceFolders',
          folders: event.folders,
        });
        return;
      case 'external_asset_directories_changed':
        dispatchWindowMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: event.dirs,
        });
        return;
      case 'assets_loaded':
        if (event.characters) {
          dispatchWindowMessage({
            type: 'characterSpritesLoaded',
            characters: event.characters.characters ?? event.characters,
          });
        }
        if (event.floors) {
          dispatchWindowMessage({
            type: 'floorTilesLoaded',
            sprites: event.floors.sprites ?? event.floors,
          });
        }
        if (event.walls) {
          dispatchWindowMessage({
            type: 'wallTilesLoaded',
            solidSets: event.walls.solidSets,
            glassSets: event.walls.glassSets,
          });
        }
        if (event.furniture) {
          dispatchWindowMessage({
            type: 'furnitureAssetsLoaded',
            catalog: event.furniture.catalog ?? [],
            sprites: normalizeFurnitureSprites(event.furniture.sprites),
          });
        }
        return;
      case 'layout_changed':
        dispatchWindowMessage({
          type: 'layoutLoaded',
          layout: event.layout,
          wasReset: event.wasReset === true,
        });
        return;
      case 'sessions_snapshot':
        dispatchSessionsSnapshot(event.sessions);
        return;
      case 'session_discovered':
        dispatchWindowMessage({
          type: 'agentCreated',
          id: event.id,
          ...(event.folderName ? { folderName: event.folderName } : {}),
        });
        return;
      case 'session_closed':
        dispatchWindowMessage({ type: 'agentClosed', id: event.id });
        return;
      case 'session_selected':
        dispatchWindowMessage({ type: 'agentSelected', id: event.id });
        return;
      case 'status_changed':
        dispatchWindowMessage({ type: 'agentStatus', id: event.id, status: event.status });
        return;
      case 'tool_started':
        dispatchWindowMessage(
          event.parentToolId
            ? {
                type: 'subagentToolStart',
                id: event.id,
                parentToolId: event.parentToolId,
                toolId: event.toolId,
                status: event.status,
              }
            : {
                type: 'agentToolStart',
                id: event.id,
                toolId: event.toolId,
                status: event.status,
              },
        );
        return;
      case 'tool_finished':
        dispatchWindowMessage(
          event.parentToolId
            ? {
                type: 'subagentToolDone',
                id: event.id,
                parentToolId: event.parentToolId,
                toolId: event.toolId,
              }
            : {
                type: 'agentToolDone',
                id: event.id,
                toolId: event.toolId,
              },
        );
        return;
      case 'tools_cleared':
        dispatchWindowMessage({ type: 'agentToolsClear', id: event.id });
        return;
      case 'permission_requested':
        dispatchWindowMessage(
          event.parentToolId
            ? {
                type: 'subagentToolPermission',
                id: event.id,
                parentToolId: event.parentToolId,
              }
            : {
                type: 'agentToolPermission',
                id: event.id,
              },
        );
        return;
      case 'permission_cleared':
        dispatchWindowMessage({ type: 'agentToolPermissionClear', id: event.id });
        return;
      case 'subagent_finished':
        dispatchWindowMessage({
          type: 'subagentClear',
          id: event.id,
          parentToolId: event.parentToolId,
        });
        return;
    }
  }

  function handleBootstrapMessage(message) {
    switch (message.step) {
      case 'capabilities':
        dispatchWindowMessage({
          type: 'hostCapabilitiesLoaded',
          backendCapabilities: message.payload.backendCapabilities,
          hostCapabilities: message.payload.hostCapabilities,
        });
        return;
      case 'settings':
        dispatchHostEvent({
          type: 'settings_changed',
          soundEnabled: message.payload.soundEnabled,
          externalAssetDirectories: message.payload.externalAssetDirectories ?? [],
        });
        return;
      case 'scopes':
        dispatchHostEvent({
          type: 'workspace_folders_loaded',
          folders: message.payload.folders ?? [],
        });
        return;
      case 'assets':
        for (const event of message.payload.events ?? []) {
          dispatchHostEvent(event);
        }
        return;
      case 'layout':
        dispatchHostEvent({
          type: 'layout_changed',
          layout: message.payload.layout ?? null,
          wasReset: message.payload.wasReset === true,
        });
        return;
      case 'sessions_snapshot':
        dispatchHostEvent({
          type: 'sessions_snapshot',
          sessions: message.payload.sessions ?? [],
        });
        if (!bootstrapCompleteSent) {
          bootstrapCompleteSent = true;
          sendTransport({ kind: 'bootstrap_complete' });
        }
        return;
    }
  }

  function handleServerMessage(rawData) {
    let message;
    try {
      message = JSON.parse(rawData);
    } catch (error) {
      console.error('[StandaloneBridge] Failed to parse server message', error);
      return;
    }

    if (message.kind === 'bootstrap') {
      handleBootstrapMessage(message);
      return;
    }

    if (message.kind === 'event') {
      dispatchHostEvent(message.event);
      return;
    }

    if (message.kind === 'error') {
      console.error('[StandaloneBridge]', message.message);
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function connect() {
    bootstrapCompleteSent = false;
    socket = new WebSocket(getSocketUrl());
    socket.addEventListener('open', flushQueue);
    socket.addEventListener('message', (event) => {
      handleServerMessage(typeof event.data === 'string' ? event.data : '');
    });
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => {
      socket && socket.close();
    });
  }

  const vscodeApi = {
    postMessage(message) {
      if (message && message.type === 'webviewReady') {
        webviewReadySeen = true;
      }
      sendTransport({ kind: 'command', command: message });
    },
    setState(state) {
      savedState = state;
      return state;
    },
    getState() {
      return savedState;
    },
  };

  if (typeof window.acquireVsCodeApi !== 'function') {
    window.acquireVsCodeApi = function () {
      return vscodeApi;
    };
  }

  connect();
})();
