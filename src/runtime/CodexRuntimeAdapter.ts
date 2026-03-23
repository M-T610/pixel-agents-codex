import { CodexSessionWatcher } from '../CodexSessionWatcher.js';
import { type CodexTerminalHost, launchCodexTerminal } from '../codexTerminal.js';
import type {
  BackendCapabilities,
  PixelAgentsBackendCommand,
  PixelAgentsEvent,
  PixelAgentsRuntimeAdapter,
  PixelAgentsRuntimeBootstrap,
} from './contracts.js';

const CODEX_BACKEND_CAPABILITIES: BackendCapabilities = {
  observe: true,
  launch: true,
  select: true,
  close: true,
};

export interface CodexRuntimeWatcher {
  start(): Promise<void>;
  postSnapshot(agentMeta?: Record<string, unknown>): void;
  selectAgent(agentId: number): void;
  getSessionTranscriptPath(agentId: number): string | null;
  hideAgent(agentId: number): void;
  dispose(): void;
}

export interface CodexRuntimeAdapterOptions {
  workspacePaths: string[];
  agentMeta?: Record<string, unknown>;
  getAgentMeta?: () => Record<string, unknown>;
  terminalHost?: CodexTerminalHost;
  createWatcher?: (listener: (event: PixelAgentsEvent) => void) => CodexRuntimeWatcher;
}

export class CodexRuntimeAdapter implements PixelAgentsRuntimeAdapter {
  private readonly queuedEvents: PixelAgentsEvent[] = [];
  private readonly capabilities = { ...CODEX_BACKEND_CAPABILITIES };

  private watcher: CodexRuntimeWatcher | null = null;
  private listener: ((event: PixelAgentsEvent) => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private initialDeliveryTimer: ReturnType<typeof setImmediate> | null = null;
  private deliveryState: 'idle' | 'connecting' | 'connected' | 'disposed' = 'idle';

  constructor(private readonly options: CodexRuntimeAdapterOptions) {}

  getCapabilities(): BackendCapabilities {
    return { ...this.capabilities };
  }

  async connect(listener: (event: PixelAgentsEvent) => void): Promise<PixelAgentsRuntimeBootstrap> {
    this.ensureNotDisposed();
    this.listener = listener;

    if (this.deliveryState === 'connected') {
      this.scheduleSnapshotReplay();
      return this.createBootstrap();
    }

    if (!this.connectPromise) {
      this.deliveryState = 'connecting';
      this.connectPromise = this.getWatcher()
        .start()
        .then(() => {
          this.scheduleSnapshotReplay();
        })
        .catch((error) => {
          this.resetAfterFailedConnect();
          throw error;
        });
    }

    await this.connectPromise;
    return this.createBootstrap();
  }

  async dispatch(command: PixelAgentsBackendCommand): Promise<void> {
    this.ensureNotDisposed();

    switch (command.type) {
      case 'launch_session':
        if (!this.options.terminalHost) {
          throw new Error('Codex terminal host is required for launch_session');
        }
        launchCodexTerminal({
          terminalHost: this.options.terminalHost,
          cwd: typeof command.cwd === 'string' ? command.cwd : undefined,
          bypassPermissions: command.bypassPermissions === true,
        });
        return;
      case 'select_session':
        this.getWatcher().selectAgent(this.requireAgentId(command));
        return;
      case 'close_session':
        this.getWatcher().hideAgent(this.requireAgentId(command));
        return;
      default:
        throw new Error(`Unsupported Codex backend command: ${command.type}`);
    }
  }

  dispose(): void {
    if (this.deliveryState === 'disposed') {
      return;
    }

    this.deliveryState = 'disposed';
    if (this.initialDeliveryTimer) {
      clearImmediate(this.initialDeliveryTimer);
      this.initialDeliveryTimer = null;
    }
    this.connectPromise = null;
    this.queuedEvents.length = 0;
    this.listener = null;
    this.watcher?.dispose();
    this.watcher = null;
  }

  getSessionTranscriptPath(agentId: number): string | null {
    this.ensureNotDisposed();
    return this.getWatcher().getSessionTranscriptPath(agentId);
  }

  private getWatcher(): CodexRuntimeWatcher {
    if (!this.watcher) {
      const createWatcher =
        this.options.createWatcher ??
        ((listener: (event: PixelAgentsEvent) => void) =>
          new CodexSessionWatcher(this.options.workspacePaths, listener));
      this.watcher = createWatcher((event) => this.handleWatcherEvent(event));
    }

    return this.watcher;
  }

  private handleWatcherEvent(event: PixelAgentsEvent): void {
    if (!this.listener || this.deliveryState !== 'connected') {
      this.queuedEvents.push(event);
      return;
    }

    this.listener(event);
  }

  private flushQueuedEvents(): void {
    if (!this.listener) {
      return;
    }

    for (const event of this.queuedEvents.splice(0)) {
      this.listener(event);
    }
  }

  private createBootstrap(): PixelAgentsRuntimeBootstrap {
    return {
      backendCapabilities: this.getCapabilities(),
    };
  }

  private getAgentMeta(): Record<string, unknown> {
    return this.options.getAgentMeta?.() ?? this.options.agentMeta ?? {};
  }

  private scheduleSnapshotReplay(): void {
    this.deliveryState = 'connecting';
    this.connectPromise = Promise.resolve();
    if (this.initialDeliveryTimer) {
      clearImmediate(this.initialDeliveryTimer);
    }
    this.initialDeliveryTimer = setImmediate(() => {
      this.initialDeliveryTimer = null;
      if (this.deliveryState === 'disposed') {
        return;
      }

      this.deliveryState = 'connected';
      this.connectPromise = null;
      this.getWatcher().postSnapshot(this.getAgentMeta());
      this.flushQueuedEvents();
    });
  }

  private resetAfterFailedConnect(): void {
    this.deliveryState = 'idle';
    this.connectPromise = null;
    this.queuedEvents.length = 0;
    if (this.initialDeliveryTimer) {
      clearImmediate(this.initialDeliveryTimer);
      this.initialDeliveryTimer = null;
    }
    this.watcher?.dispose();
    this.watcher = null;
  }

  private ensureNotDisposed(): void {
    if (this.deliveryState === 'disposed') {
      throw new Error('CodexRuntimeAdapter has been disposed');
    }
  }

  private requireAgentId(command: PixelAgentsBackendCommand): number {
    if (typeof command.id !== 'number') {
      throw new Error(`Codex backend command "${command.type}" requires a numeric id`);
    }

    return command.id;
  }
}
