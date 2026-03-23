import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as webviewMessageBridge from '../../src/host/webviewMessageBridge.js';
import type {
  HostToWebviewEvent,
  SessionSnapshotEntry,
} from '../../src/host/webviewMessageBridge.js';
import type {
  BackendCapabilities,
  HostCapabilities,
  PixelAgentsEvent,
  PixelAgentsRuntimeAdapter,
} from '../../src/runtime/contracts.js';
import * as codexRuntimeAdapterModule from '../../src/runtime/CodexRuntimeAdapter.js';
import type { CodexTerminalHost } from '../../src/codexTerminal.js';
import {
  StandaloneHostChrome,
  readStandaloneBrowserCommand,
  type StandaloneBrowserCommand,
  type StandaloneHostSettings,
  type StandaloneLayout,
} from './standaloneHostChrome.js';
import { WorkspaceScopeStore, type WorkspaceScope } from './workspaceScopeStore.js';

const sharedBridge = (
  'default' in webviewMessageBridge &&
  webviewMessageBridge.default &&
  typeof webviewMessageBridge.default === 'object'
    ? webviewMessageBridge.default
    : webviewMessageBridge
) as {
  normalizeRuntimeEventToHostEvents(event: PixelAgentsEvent): HostToWebviewEvent[];
  renderHostEventsToWebviewMessages(events: HostToWebviewEvent[]): WebviewMessage[];
};

const { normalizeRuntimeEventToHostEvents, renderHostEventsToWebviewMessages } = sharedBridge;
const CodexRuntimeAdapter = (
  'default' in codexRuntimeAdapterModule &&
  codexRuntimeAdapterModule.default &&
  typeof codexRuntimeAdapterModule.default === 'object'
    ? codexRuntimeAdapterModule.default.CodexRuntimeAdapter
    : undefined
) as typeof import('../../src/runtime/CodexRuntimeAdapter.js').CodexRuntimeAdapter;

export type WebviewMessage = Record<string, unknown>;

export type StandaloneBootstrapStep =
  | 'capabilities'
  | 'settings'
  | 'scopes'
  | 'assets'
  | 'layout'
  | 'sessions_snapshot';

export interface StandaloneBootstrapPayload {
  messages: WebviewMessage[];
}

export type StandaloneBootstrapMessage = {
  kind: 'bootstrap';
  step: StandaloneBootstrapStep;
  payload: StandaloneBootstrapPayload;
};

export type StandaloneHostMessage =
  | StandaloneBootstrapMessage
  | {
      kind: 'webview_messages';
      messages: WebviewMessage[];
    }
  | {
      kind: 'error';
      message: string;
    };

export type StandaloneClientMessage =
  | {
      kind: 'command';
      command: StandaloneBrowserCommand;
    }
  | {
      kind: 'bootstrap_complete';
    };

export interface StandaloneBootstrapState {
  backendCapabilities: BackendCapabilities;
  hostCapabilities: HostCapabilities;
  settings: StandaloneHostSettings;
  scopes: WorkspaceScope[];
  assets: HostToWebviewEvent[];
  layout: StandaloneLayout | null;
  sessions: SessionSnapshotEntry[];
}

export interface StandaloneServerOptions {
  port?: number;
  runtime?: PixelAgentsRuntimeAdapter;
  runtimeFactory?: (options: {
    workspacePaths: string[];
    terminalHost: CodexTerminalHost;
  }) => PixelAgentsRuntimeAdapter;
  hostChrome?: StandaloneHostChrome;
  workspaceScopeStore?: WorkspaceScopeStore;
  assets?: HostToWebviewEvent[];
}

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WEBSOCKET_PATH = '/__pixel_agents_host';
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function createStandaloneBootstrapMessages(
  state: StandaloneBootstrapState,
): StandaloneBootstrapMessage[] {
  return [
    createBootstrapStepMessage('capabilities', [
      {
        type: 'hostCapabilitiesLoaded',
        backendCapabilities: state.backendCapabilities,
        hostCapabilities: state.hostCapabilities,
      },
    ]),
    createBootstrapStepMessage(
      'settings',
      renderHostEventsToWebviewMessages([
        {
          type: 'settings_changed',
          soundEnabled: state.settings.soundEnabled,
          externalAssetDirectories: state.settings.externalAssetDirectories,
        },
      ]),
    ),
    createBootstrapStepMessage(
      'scopes',
      renderHostEventsToWebviewMessages([
        {
          type: 'workspace_folders_loaded',
          folders: state.scopes,
        },
      ]),
    ),
    createBootstrapStepMessage('assets', renderHostEventsToWebviewMessages(state.assets)),
    createBootstrapStepMessage(
      'layout',
      renderHostEventsToWebviewMessages([
        {
          type: 'layout_changed',
          layout: state.layout,
          wasReset: false,
        },
      ]),
    ),
    createBootstrapStepMessage(
      'sessions_snapshot',
      renderHostEventsToWebviewMessages([
        {
          type: 'sessions_snapshot',
          sessions: state.sessions,
        },
      ]),
    ),
  ];
}

export function translateRuntimeEventToWebviewMessages(event: PixelAgentsEvent): WebviewMessage[] {
  return renderHostEventsToWebviewMessages(normalizeRuntimeEventToHostEvents(event));
}

export class StandaloneClientSession {
  private bootstrapSent = false;
  private bootstrapCompleted = false;
  private readonly bufferedHostMessages: StandaloneHostMessage[] = [];
  private readonly bufferedCommands: StandaloneBrowserCommand[] = [];

  constructor(private readonly deliver: (message: StandaloneHostMessage) => void) {}

  sendBootstrap(messages: StandaloneBootstrapMessage[]): void {
    if (this.bootstrapSent) {
      return;
    }

    this.bootstrapSent = true;
    for (const message of messages) {
      this.deliver(message);
    }
  }

  enqueueWebviewMessages(messages: WebviewMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    const hostMessage: StandaloneHostMessage = {
      kind: 'webview_messages',
      messages,
    };

    if (!this.bootstrapCompleted) {
      this.bufferedHostMessages.push(hostMessage);
      return;
    }

    this.deliver(hostMessage);
  }

  acceptCommand(command: StandaloneBrowserCommand): StandaloneBrowserCommand[] {
    if (command.type === 'webviewReady') {
      return [command];
    }

    if (!this.bootstrapCompleted) {
      this.bufferedCommands.push(command);
      return [];
    }

    return [command];
  }

  markBootstrapComplete(): StandaloneBrowserCommand[] {
    if (this.bootstrapCompleted) {
      return [];
    }

    this.bootstrapCompleted = true;
    while (this.bufferedHostMessages.length > 0) {
      const next = this.bufferedHostMessages.shift();
      if (next) {
        this.deliver(next);
      }
    }

    return this.bufferedCommands.splice(0);
  }
}

export class StandaloneServer {
  private readonly hostChrome: StandaloneHostChrome;
  private readonly workspaceScopeStore: WorkspaceScopeStore;
  private readonly bootstrapAssets: HostToWebviewEvent[];
  private readonly clientConnections = new Map<
    SimpleWebSocketConnection,
    StandaloneClientSession
  >();
  private readonly sessionProjection = new Map<number, SessionSnapshotEntry>();
  private backendCapabilities: BackendCapabilities = {
    observe: true,
    launch: false,
    select: false,
    close: false,
  };
  private httpServer: HttpServer | null = null;
  private runtime: PixelAgentsRuntimeAdapter | null = null;

  constructor(private readonly options: StandaloneServerOptions = {}) {
    this.hostChrome = options.hostChrome ?? new StandaloneHostChrome();
    this.workspaceScopeStore =
      options.workspaceScopeStore ?? new WorkspaceScopeStore({ initialScopes: [] });
    this.bootstrapAssets = options.assets ?? [];
  }

  async start(): Promise<void> {
    await this.attachRuntime();

    this.httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    this.httpServer.on('upgrade', (request, socket) => {
      void this.handleUpgrade(request, socket);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.httpServer;
      if (!server) {
        reject(new Error('HTTP server was not created.'));
        return;
      }

      server.once('error', reject);
      server.listen(this.options.port ?? 0, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const connection of this.clientConnections.keys()) {
      connection.close();
    }
    this.clientConnections.clear();

    this.runtime?.dispose();
    this.runtime = null;

    if (!this.httpServer) {
      return;
    }

    const server = this.httpServer;
    this.httpServer = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  get port(): number | null {
    const address = this.httpServer?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  private async attachRuntime(): Promise<void> {
    const runtime = await this.getRuntime();
    if (!runtime) {
      return;
    }

    const bufferedHostEvents: HostToWebviewEvent[] = [];
    let runtimeUnlocked = false;

    const bootstrap = await runtime.connect((event) => {
      const hostEvents = normalizeRuntimeEventToHostEvents(event);
      for (const hostEvent of hostEvents) {
        this.applySessionProjection(hostEvent);
      }

      if (runtimeUnlocked) {
        this.broadcastHostEvents(hostEvents);
        return;
      }

      bufferedHostEvents.push(...hostEvents);
    });

    this.backendCapabilities = toStandaloneBackendCapabilities(bootstrap.backendCapabilities);
    await waitForImmediate();
    for (const hostEvent of bufferedHostEvents) {
      this.applySessionProjection(hostEvent);
    }
    runtimeUnlocked = true;
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestPath = new URL(request.url ?? '/', 'http://standalone.local').pathname;
    if (requestPath === '/host-bridge.js') {
      await this.serveFile(getHostBridgePath(), response);
      return;
    }

    const webRoot = getWebRootPath();
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const candidatePath = path.resolve(webRoot, relativePath);

    if (!candidatePath.startsWith(webRoot)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    if (path.basename(candidatePath) === 'index.html' || !path.extname(candidatePath)) {
      await this.serveIndexHtml(response);
      return;
    }

    try {
      await this.serveFile(candidatePath, response);
    } catch {
      await this.serveIndexHtml(response);
    }
  }

  private async serveIndexHtml(response: ServerResponse): Promise<void> {
    const indexHtmlPath = path.join(getWebRootPath(), 'index.html');
    const html = await readFile(indexHtmlPath, 'utf8');
    const injected = html.replace(
      '</head>',
      '    <script src="/host-bridge.js"></script>\n  </head>',
    );

    response.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
    response.end(injected);
  }

  private async serveFile(filePath: string, response: ServerResponse): Promise<void> {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(content);
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex): Promise<void> {
    try {
      const pathname = new URL(request.url ?? '/', 'http://standalone.local').pathname;
      if (pathname !== WEBSOCKET_PATH) {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }

      const rawKey = request.headers['sec-websocket-key'];
      if (typeof rawKey !== 'string') {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const acceptKey = createHash('sha1')
        .update(rawKey + WEBSOCKET_GUID)
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey}`,
          '\r\n',
        ].join('\r\n'),
      );

      const connection = new SimpleWebSocketConnection(socket);
      const clientSession = new StandaloneClientSession((message) => {
        connection.send(JSON.stringify(message));
      });
      this.clientConnections.set(connection, clientSession);

      connection.onMessage((rawMessage) => {
        void this.handleClientMessage(connection, clientSession, rawMessage);
      });
      connection.onClose(() => {
        this.clientConnections.delete(connection);
      });
    } catch {
      socket.destroy();
    }
  }

  private async handleClientMessage(
    connection: SimpleWebSocketConnection,
    session: StandaloneClientSession,
    rawMessage: string,
  ): Promise<void> {
    const message = readStandaloneClientMessage(rawMessage);
    if (!message) {
      connection.send(
        JSON.stringify({
          kind: 'error',
          message: 'Invalid client message.',
        } satisfies StandaloneHostMessage),
      );
      return;
    }

    if (message.kind === 'bootstrap_complete') {
      const queuedCommands = session.markBootstrapComplete();
      for (const command of queuedCommands) {
        await this.processCommand(session, command);
      }
      return;
    }

    const acceptedCommands = session.acceptCommand(message.command);
    for (const command of acceptedCommands) {
      await this.processCommand(session, command);
    }
  }

  private async processCommand(
    session: StandaloneClientSession,
    command: StandaloneBrowserCommand,
  ): Promise<void> {
    if (command.type === 'webviewReady') {
      session.sendBootstrap(await this.buildBootstrapMessages());
      return;
    }

    if (await this.dispatchRuntimeCommand(command)) {
      return;
    }

    const chromeResult = await this.hostChrome.handleCommand(command);
    if (chromeResult.events.length > 0) {
      this.broadcastHostEvents(chromeResult.events);
    }
  }

  private async buildBootstrapMessages(): Promise<StandaloneBootstrapMessage[]> {
    return createStandaloneBootstrapMessages({
      backendCapabilities: this.backendCapabilities,
      hostCapabilities: this.hostChrome.getCapabilities(),
      settings: this.hostChrome.getSettings(),
      scopes: await this.workspaceScopeStore.list(),
      assets: this.bootstrapAssets,
      layout: this.hostChrome.getLayout(),
      sessions: this.getSessionSnapshot(),
    });
  }

  private getSessionSnapshot(): SessionSnapshotEntry[] {
    return [...this.sessionProjection.values()].sort((left, right) => left.id - right.id);
  }

  private applySessionProjection(event: HostToWebviewEvent): void {
    switch (event.type) {
      case 'sessions_snapshot':
        this.sessionProjection.clear();
        for (const session of event.sessions) {
          this.sessionProjection.set(session.id, { ...session });
        }
        return;
      case 'session_discovered':
        this.sessionProjection.set(event.id, {
          id: event.id,
          ...(event.folderName ? { folderName: event.folderName } : {}),
        });
        return;
      case 'session_closed':
        this.sessionProjection.delete(event.id);
        return;
    }
  }

  private broadcastHostEvents(events: HostToWebviewEvent[]): void {
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      this.applySessionProjection(event);
    }

    const messages = renderHostEventsToWebviewMessages(events);
    for (const session of this.clientConnections.values()) {
      session.enqueueWebviewMessages(messages);
    }
  }

  private async dispatchRuntimeCommand(command: StandaloneBrowserCommand): Promise<boolean> {
    const runtime = await this.getRuntime();
    if (!runtime) {
      return false;
    }

    switch (command.type) {
      case 'closeAgent':
        await runtime.dispatch({
          type: 'close_session',
          id: command.id,
        });
        return true;
      case 'startCodexSession':
        await runtime.dispatch({
          type: 'launch_session',
          cwd: command.cwd,
          bypassPermissions: command.bypassPermissions === true,
        });
        return true;
      default:
        return false;
    }
  }

  private async getRuntime(): Promise<PixelAgentsRuntimeAdapter | null> {
    if (this.runtime) {
      return this.runtime;
    }

    if (this.options.runtime) {
      this.runtime = this.options.runtime;
      return this.runtime;
    }

    const workspacePaths = (await this.workspaceScopeStore.list()).map((scope) => scope.path);
    const runtimeFactory =
      this.options.runtimeFactory ??
      ((options: { workspacePaths: string[]; terminalHost: CodexTerminalHost }) =>
        new CodexRuntimeAdapter({
          workspacePaths: options.workspacePaths,
          terminalHost: options.terminalHost,
        }));

    this.runtime = runtimeFactory({
      workspacePaths,
      terminalHost: createDetachedTerminalHost(),
    });
    return this.runtime;
  }
}

export async function startStandaloneServer(
  options: StandaloneServerOptions = {},
): Promise<StandaloneServer> {
  const server = new StandaloneServer(options);
  await server.start();
  return server;
}

function createBootstrapStepMessage(
  step: StandaloneBootstrapStep,
  messages: WebviewMessage[],
): StandaloneBootstrapMessage {
  return {
    kind: 'bootstrap',
    step,
    payload: {
      messages,
    },
  };
}

function readStandaloneClientMessage(rawMessage: string): StandaloneClientMessage | null {
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (parsed.kind === 'bootstrap_complete') {
      return { kind: 'bootstrap_complete' };
    }

    if (parsed.kind === 'command') {
      const command = readStandaloneBrowserCommand(parsed.command);
      return command ? { kind: 'command', command } : null;
    }

    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStandaloneBackendCapabilities(
  backendCapabilities: BackendCapabilities,
): BackendCapabilities {
  return {
    ...backendCapabilities,
    select: false,
  };
}

function getWebRootPath(): string {
  return path.resolve(getStandaloneDirectory(), '..', '..', 'dist', 'webview');
}

function getHostBridgePath(): string {
  return path.resolve(getStandaloneDirectory(), '..', 'public', 'host-bridge.js');
}

function getStandaloneDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function createDefaultWorkspaceScopeStore(): WorkspaceScopeStore {
  return new WorkspaceScopeStore({
    initialScopes: readWorkspaceScopesFromEnv(),
    filePath: path.resolve(getStandaloneDirectory(), '..', 'workspace-scopes.json'),
  });
}

function readWorkspaceScopesFromEnv(): WorkspaceScope[] {
  const rawScopes = process.env.PIXEL_AGENTS_WORKSPACES ?? process.env.PIXEL_AGENTS_WORKSPACE;
  if (!rawScopes) {
    return [];
  }

  return rawScopes
    .split(path.delimiter)
    .map((workspacePath) => workspacePath.trim())
    .filter((workspacePath) => workspacePath.length > 0)
    .map((workspacePath) => ({
      name: path.basename(workspacePath),
      path: workspacePath,
    }));
}

function isDirectExecution(importMetaUrl: string): boolean {
  return !!process.argv[1] && pathToFileURL(process.argv[1]).href === importMetaUrl;
}

async function runStandaloneCli(): Promise<void> {
  const server = await startStandaloneServer({
    workspaceScopeStore: createDefaultWorkspaceScopeStore(),
  });

  const stopServer = async () => {
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void stopServer();
  });
  process.once('SIGTERM', () => {
    void stopServer();
  });

  console.log(
    `[Standalone] listening on http://127.0.0.1:${server.port?.toString() ?? 'unknown-port'}`,
  );
}

function createDetachedTerminalHost(): CodexTerminalHost {
  return {
    getTerminalNames() {
      return [];
    },
    createTerminal(options) {
      return {
        show() {},
        sendText(command) {
          const child = spawn(command, {
            cwd: options.cwd,
            detached: true,
            shell: true,
            stdio: 'ignore',
          });
          child.unref();
        },
      };
    },
  };
}

function waitForImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class SimpleWebSocketConnection {
  private readonly messageListeners = new Set<(message: string) => void>();
  private readonly closeListeners = new Set<() => void>();
  private buffer = Buffer.alloc(0);

  constructor(private readonly socket: Duplex) {
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainFrames();
    });
    socket.on('close', () => {
      this.emitClose();
    });
    socket.on('end', () => {
      this.emitClose();
    });
    socket.on('error', () => {
      this.emitClose();
    });
  }

  onMessage(listener: (message: string) => void): void {
    this.messageListeners.add(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  send(message: string): void {
    this.writeFrame(0x1, Buffer.from(message, 'utf8'));
  }

  close(): void {
    this.writeFrame(0x8, Buffer.alloc(0));
    this.socket.end();
  }

  private drainFrames(): void {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) {
          return;
        }

        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) {
          return;
        }

        const high = this.buffer.readUInt32BE(2);
        if (high !== 0) {
          this.close();
          return;
        }

        payloadLength = this.buffer.readUInt32BE(6);
        offset = 10;
      }

      const masked = (secondByte & 0x80) !== 0;
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + payloadLength) {
        return;
      }

      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      const payloadStart = offset + maskLength;
      const payload = Buffer.from(this.buffer.subarray(payloadStart, payloadStart + payloadLength));

      this.buffer = this.buffer.subarray(payloadStart + payloadLength);

      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      if (opcode === 0x8) {
        this.socket.end();
        this.emitClose();
        return;
      }

      if (opcode === 0x9) {
        this.writeFrame(0xa, payload);
        continue;
      }

      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        for (const listener of this.messageListeners) {
          listener(text);
        }
      }
    }
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
    }

    this.socket.write(Buffer.concat([header, payload]));
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) {
      listener();
    }
    this.closeListeners.clear();
  }
}

if (isDirectExecution(import.meta.url)) {
  void runStandaloneCli();
}
