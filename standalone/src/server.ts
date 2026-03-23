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
import { fileURLToPath } from 'node:url';

import type {
  BackendCapabilities,
  HostCapabilities,
  PixelAgentsEvent,
  PixelAgentsRuntimeAdapter,
} from '../../src/runtime/contracts.js';
import {
  StandaloneHostChrome,
  type StandaloneBrowserCommand,
  type StandaloneChromeEvent,
  type StandaloneHostSettings,
  type StandaloneLayout,
} from './standaloneHostChrome.js';
import { WorkspaceScopeStore, type WorkspaceScope } from './workspaceScopeStore.js';

export interface SessionSnapshotEntry {
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  folderName?: string;
}

export interface StandaloneAssetsPayload {
  characters?: unknown | null;
  floors?: unknown | null;
  walls?: {
    solidSets: unknown;
    glassSets: unknown;
  } | null;
  furniture?: {
    catalog: unknown[];
    sprites: Map<string, unknown> | Record<string, unknown>;
  } | null;
}

export type StandaloneHostEvent =
  | StandaloneChromeEvent
  | { type: 'workspace_folders_loaded'; folders: WorkspaceScope[] }
  | {
      type: 'assets_loaded';
      characters?: unknown | null;
      floors?: unknown | null;
      walls?: StandaloneAssetsPayload['walls'];
      furniture?: StandaloneAssetsPayload['furniture'];
    }
  | { type: 'sessions_snapshot'; sessions: SessionSnapshotEntry[] }
  | { type: 'session_discovered'; id: number; folderName?: string }
  | { type: 'session_closed'; id: number }
  | { type: 'session_selected'; id: number }
  | { type: 'status_changed'; id: number; status: string }
  | { type: 'tool_started'; id: number; toolId: string; status: string; parentToolId?: string }
  | { type: 'tool_finished'; id: number; toolId: string; parentToolId?: string }
  | { type: 'tools_cleared'; id: number }
  | { type: 'permission_requested'; id: number; parentToolId?: string }
  | { type: 'permission_cleared'; id: number }
  | { type: 'subagent_finished'; id: number; parentToolId: string };

export type StandaloneBootstrapMessage =
  | {
      kind: 'bootstrap';
      step: 'capabilities';
      payload: {
        backendCapabilities: BackendCapabilities;
        hostCapabilities: HostCapabilities;
      };
    }
  | {
      kind: 'bootstrap';
      step: 'settings';
      payload: StandaloneHostSettings;
    }
  | {
      kind: 'bootstrap';
      step: 'scopes';
      payload: {
        folders: WorkspaceScope[];
      };
    }
  | {
      kind: 'bootstrap';
      step: 'assets';
      payload: {
        events: StandaloneHostEvent[];
      };
    }
  | {
      kind: 'bootstrap';
      step: 'layout';
      payload: {
        layout: StandaloneLayout | null;
        wasReset: boolean;
      };
    }
  | {
      kind: 'bootstrap';
      step: 'sessions_snapshot';
      payload: {
        sessions: SessionSnapshotEntry[];
      };
    };

export type StandaloneHostMessage =
  | StandaloneBootstrapMessage
  | {
      kind: 'event';
      event: StandaloneHostEvent;
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
  assets: StandaloneHostEvent[];
  layout: StandaloneLayout | null;
  sessions: SessionSnapshotEntry[];
}

export interface StandaloneServerOptions {
  port?: number;
  runtime?: PixelAgentsRuntimeAdapter;
  hostChrome?: StandaloneHostChrome;
  workspaceScopeStore?: WorkspaceScopeStore;
  assets?: StandaloneHostEvent[];
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
    {
      kind: 'bootstrap',
      step: 'capabilities',
      payload: {
        backendCapabilities: state.backendCapabilities,
        hostCapabilities: state.hostCapabilities,
      },
    },
    {
      kind: 'bootstrap',
      step: 'settings',
      payload: state.settings,
    },
    {
      kind: 'bootstrap',
      step: 'scopes',
      payload: {
        folders: state.scopes,
      },
    },
    {
      kind: 'bootstrap',
      step: 'assets',
      payload: {
        events: state.assets,
      },
    },
    {
      kind: 'bootstrap',
      step: 'layout',
      payload: {
        layout: state.layout,
        wasReset: false,
      },
    },
    {
      kind: 'bootstrap',
      step: 'sessions_snapshot',
      payload: {
        sessions: state.sessions,
      },
    },
  ];
}

export class StandaloneClientSession {
  private bootstrapSent = false;
  private bootstrapCompleted = false;
  private readonly bufferedMessages: StandaloneHostMessage[] = [];

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

  enqueueRuntimeEvent(event: StandaloneHostEvent): void {
    const message: StandaloneHostMessage = {
      kind: 'event',
      event,
    };

    if (!this.bootstrapCompleted) {
      this.bufferedMessages.push(message);
      return;
    }

    this.deliver(message);
  }

  markBootstrapComplete(): void {
    if (this.bootstrapCompleted) {
      return;
    }

    this.bootstrapCompleted = true;
    while (this.bufferedMessages.length > 0) {
      const next = this.bufferedMessages.shift();
      if (next) {
        this.deliver(next);
      }
    }
  }
}

export class StandaloneServer {
  private readonly hostChrome: StandaloneHostChrome;
  private readonly workspaceScopeStore: WorkspaceScopeStore;
  private readonly bootstrapAssets: StandaloneHostEvent[];
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

    this.options.runtime?.dispose();

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
    const runtime = this.options.runtime;
    if (!runtime) {
      return;
    }

    const bufferedEvents: StandaloneHostEvent[] = [];
    let runtimeUnlocked = false;

    const bootstrap = await runtime.connect((event) => {
      const hostEvents = normalizeRuntimeEventToHostEvents(event);
      for (const hostEvent of hostEvents) {
        this.applySessionProjection(hostEvent);
        if (runtimeUnlocked) {
          this.broadcastHostEvent(hostEvent);
          continue;
        }

        bufferedEvents.push(hostEvent);
      }
    });

    this.backendCapabilities = bootstrap.backendCapabilities;
    for (const event of bufferedEvents) {
      this.applySessionProjection(event);
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
        connection.send(serializeStandaloneHostMessage(message));
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
        serializeStandaloneHostMessage({
          kind: 'error',
          message: 'Invalid client message.',
        }),
      );
      return;
    }

    if (message.kind === 'bootstrap_complete') {
      session.markBootstrapComplete();
      return;
    }

    if (message.command.type === 'webviewReady') {
      session.sendBootstrap(await this.buildBootstrapMessages());
      return;
    }

    if (await this.dispatchRuntimeCommand(message.command)) {
      return;
    }

    const chromeResult = await this.hostChrome.handleCommand(message.command);
    if (chromeResult.events.length > 0) {
      for (const event of chromeResult.events) {
        this.broadcastHostEvent(event);
      }
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

  private applySessionProjection(event: StandaloneHostEvent): void {
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

  private broadcastHostEvent(event: StandaloneHostEvent): void {
    this.applySessionProjection(event);
    for (const session of this.clientConnections.values()) {
      session.enqueueRuntimeEvent(event);
    }
  }

  private async dispatchRuntimeCommand(command: StandaloneBrowserCommand): Promise<boolean> {
    const runtime = this.options.runtime;
    if (!runtime) {
      return false;
    }

    switch (command.type) {
      case 'focusAgent':
        await runtime.dispatch({
          type: 'select_session',
          id: command.id,
        });
        return true;
      case 'closeAgent':
        await runtime.dispatch({
          type: 'close_session',
          id: command.id,
        });
        return true;
      case 'startCodexSession':
        await runtime.dispatch({
          type: 'launch_session',
          cwd: typeof command.cwd === 'string' ? command.cwd : undefined,
          bypassPermissions: command.bypassPermissions === true,
        });
        return true;
      default:
        return false;
    }
  }
}

export async function startStandaloneServer(
  options: StandaloneServerOptions = {},
): Promise<StandaloneServer> {
  const server = new StandaloneServer(options);
  await server.start();
  return server;
}

function normalizeRuntimeEventToHostEvents(event: PixelAgentsEvent): StandaloneHostEvent[] {
  switch (event.type) {
    case 'existingAgents':
      return [
        {
          type: 'sessions_snapshot',
          sessions: normalizeSessionsSnapshot(
            readNumberArray(event.agents),
            readAgentMeta(event.agentMeta),
            readFolderNames(event.folderNames),
          ),
        },
      ];
    case 'agentCreated':
      return [
        {
          type: 'session_discovered',
          id: requireNumber(event.id, event.type, 'id'),
          folderName: readOptionalString(event.folderName),
        },
      ];
    case 'agentClosed':
      return [
        {
          type: 'session_closed',
          id: requireNumber(event.id, event.type, 'id'),
        },
      ];
    case 'agentSelected':
      return [
        {
          type: 'session_selected',
          id: requireNumber(event.id, event.type, 'id'),
        },
      ];
    case 'agentStatus':
      return [
        {
          type: 'status_changed',
          id: requireNumber(event.id, event.type, 'id'),
          status: requireString(event.status, event.type, 'status'),
        },
      ];
    case 'agentToolStart':
      return [
        {
          type: 'tool_started',
          id: requireNumber(event.id, event.type, 'id'),
          toolId: requireString(event.toolId, event.type, 'toolId'),
          status: requireString(event.status, event.type, 'status'),
        },
      ];
    case 'agentToolDone':
      return [
        {
          type: 'tool_finished',
          id: requireNumber(event.id, event.type, 'id'),
          toolId: requireString(event.toolId, event.type, 'toolId'),
        },
      ];
    case 'agentToolsClear':
      return [
        {
          type: 'tools_cleared',
          id: requireNumber(event.id, event.type, 'id'),
        },
      ];
    case 'subagentToolStart':
      return [
        {
          type: 'tool_started',
          id: requireNumber(event.id, event.type, 'id'),
          parentToolId: requireString(event.parentToolId, event.type, 'parentToolId'),
          toolId: requireString(event.toolId, event.type, 'toolId'),
          status: requireString(event.status, event.type, 'status'),
        },
      ];
    case 'subagentToolDone':
      return [
        {
          type: 'tool_finished',
          id: requireNumber(event.id, event.type, 'id'),
          parentToolId: requireString(event.parentToolId, event.type, 'parentToolId'),
          toolId: requireString(event.toolId, event.type, 'toolId'),
        },
      ];
    case 'subagentClear':
      return [
        {
          type: 'subagent_finished',
          id: requireNumber(event.id, event.type, 'id'),
          parentToolId: requireString(event.parentToolId, event.type, 'parentToolId'),
        },
      ];
    case 'agentToolPermission':
      return [
        {
          type: 'permission_requested',
          id: requireNumber(event.id, event.type, 'id'),
        },
      ];
    case 'subagentToolPermission':
      return [
        {
          type: 'permission_requested',
          id: requireNumber(event.id, event.type, 'id'),
          parentToolId: requireString(event.parentToolId, event.type, 'parentToolId'),
        },
      ];
    case 'agentToolPermissionClear':
      return [
        {
          type: 'permission_cleared',
          id: requireNumber(event.id, event.type, 'id'),
        },
      ];
    default:
      return [];
  }
}

function serializeStandaloneHostMessage(message: StandaloneHostMessage): string {
  return JSON.stringify(makeJsonCompatible(message));
}

function makeJsonCompatible<T>(value: T): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entryValue]) => [key, makeJsonCompatible(entryValue)]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => makeJsonCompatible(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        makeJsonCompatible(entryValue),
      ]),
    );
  }

  return value;
}

function readStandaloneClientMessage(rawMessage: string): StandaloneClientMessage | null {
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const kind = (parsed as { kind?: unknown }).kind;
    if (kind === 'bootstrap_complete') {
      return { kind: 'bootstrap_complete' };
    }

    if (
      kind === 'command' &&
      typeof (parsed as { command?: { type?: unknown } }).command?.type === 'string'
    ) {
      return parsed as StandaloneClientMessage;
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeSessionsSnapshot(
  agentIds: number[],
  agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }>,
  folderNames: Record<number, string>,
): SessionSnapshotEntry[] {
  return agentIds.map((id) => ({
    id,
    ...agentMeta[id],
    ...(folderNames[id] ? { folderName: folderNames[id] } : {}),
  }));
}

function readAgentMeta(
  value: unknown,
): Record<number, { palette?: number; hueShift?: number; seatId?: string }> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
  for (const [rawId, entry] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || !isRecord(entry)) {
      continue;
    }

    result[id] = {
      ...(typeof entry.palette === 'number' ? { palette: entry.palette } : {}),
      ...(typeof entry.hueShift === 'number' ? { hueShift: entry.hueShift } : {}),
      ...(typeof entry.seatId === 'string' ? { seatId: entry.seatId } : {}),
    };
  }

  return result;
}

function readFolderNames(value: unknown): Record<number, string> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<number, string> = {};
  for (const [rawId, entry] of Object.entries(value)) {
    const id = Number(rawId);
    if (Number.isFinite(id) && typeof entry === 'string') {
      result[id] = entry;
    }
  }

  return result;
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : [];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requireNumber(value: unknown, eventType: string, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`Runtime event "${eventType}" requires numeric ${field}`);
  }

  return value;
}

function requireString(value: unknown, eventType: string, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Runtime event "${eventType}" requires string ${field}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
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
