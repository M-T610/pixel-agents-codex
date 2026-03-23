(function () {
  const WS_PATH = '/__pixel_agents_host';
  const reconnectDelayMs = 1000;
  const queuedCommands = [];
  let socket = null;
  let reconnectTimer = null;
  let webviewReadySeen = false;
  let bootstrapCompleteForConnection = false;
  let bootstrapRequestedForConnection = false;
  let savedState;

  function getSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${WS_PATH}`;
  }

  function dispatchWindowMessage(data) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function sendCommand(command) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ kind: 'command', command }));
  }

  function requestBootstrapIfPossible() {
    if (
      !webviewReadySeen ||
      bootstrapRequestedForConnection ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    bootstrapRequestedForConnection = true;
    sendCommand({ type: 'webviewReady' });
  }

  function flushQueuedCommands() {
    if (!bootstrapCompleteForConnection || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (queuedCommands.length > 0) {
      sendCommand(queuedCommands.shift());
    }
  }

  function dispatchWebviewMessages(messages) {
    for (const message of messages ?? []) {
      dispatchWindowMessage(message);
    }
  }

  function handleBootstrapMessage(message) {
    dispatchWebviewMessages(message.payload.messages);

    if (message.step === 'sessions_snapshot' && !bootstrapCompleteForConnection) {
      bootstrapCompleteForConnection = true;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ kind: 'bootstrap_complete' }));
      }
      flushQueuedCommands();
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

    if (message.kind === 'webview_messages') {
      dispatchWebviewMessages(message.messages);
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
    bootstrapCompleteForConnection = false;
    bootstrapRequestedForConnection = false;
    socket = new WebSocket(getSocketUrl());
    socket.addEventListener('open', requestBootstrapIfPossible);
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
        requestBootstrapIfPossible();
        return;
      }

      if (socket && socket.readyState === WebSocket.OPEN && bootstrapCompleteForConnection) {
        sendCommand(message);
        return;
      }

      queuedCommands.push(message);
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
