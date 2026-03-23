import type { HostToWebviewEvent } from '../../src/host/webviewMessageBridge.js';
import type { HostCapabilities } from '../../src/runtime/contracts.js';

export interface StandaloneAgentSeat {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface StandaloneHostSettings {
  soundEnabled: boolean;
  externalAssetDirectories: string[];
}

export interface StandaloneLayout {
  [key: string]: unknown;
}

export type StandaloneBrowserCommand =
  | { type: 'webviewReady' }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'startCodexSession'; cwd?: string; bypassPermissions?: boolean }
  | { type: 'saveAgentSeats'; seats: Record<number, StandaloneAgentSeat> }
  | { type: 'saveLayout'; layout: StandaloneLayout }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'exportLayout' }
  | { type: 'addExternalAssetDirectory' }
  | { type: 'removeExternalAssetDirectory'; path: string }
  | { type: 'importLayout' }
  | { type: 'openCodexSessions' };

export type StandaloneChromeEvent = Extract<
  HostToWebviewEvent,
  | { type: 'settings_changed' }
  | { type: 'external_asset_directories_changed' }
  | { type: 'layout_changed' }
>;

export interface StandaloneHostChromeOptions {
  capabilities?: Partial<HostCapabilities>;
  settings?: Partial<StandaloneHostSettings>;
  layout?: StandaloneLayout | null;
  persistedAgentMeta?: Record<string, StandaloneAgentSeat>;
}

export interface StandaloneHostChromeResult {
  handled: boolean;
  events: StandaloneChromeEvent[];
}

const defaultHostCapabilities: HostCapabilities = {
  revealTranscript: false,
  revealSessionsRoot: false,
  importLayout: false,
  exportLayout: false,
  pickAssetDirectory: false,
};

export class StandaloneHostChrome {
  private readonly capabilities: HostCapabilities;
  private readonly settings: StandaloneHostSettings;
  private layout: StandaloneLayout | null;
  private persistedAgentMeta: Record<string, StandaloneAgentSeat>;

  constructor(options: StandaloneHostChromeOptions = {}) {
    this.capabilities = {
      ...defaultHostCapabilities,
      ...(options.capabilities ?? {}),
    };
    this.settings = {
      soundEnabled: options.settings?.soundEnabled ?? true,
      externalAssetDirectories: [...(options.settings?.externalAssetDirectories ?? [])],
    };
    this.layout = options.layout ?? null;
    this.persistedAgentMeta = { ...(options.persistedAgentMeta ?? {}) };
  }

  getCapabilities(): HostCapabilities {
    return { ...this.capabilities };
  }

  getSettings(): StandaloneHostSettings {
    return {
      soundEnabled: this.settings.soundEnabled,
      externalAssetDirectories: [...this.settings.externalAssetDirectories],
    };
  }

  getLayout(): StandaloneLayout | null {
    return this.layout ? { ...this.layout } : null;
  }

  getPersistedAgentMeta(): Record<string, StandaloneAgentSeat> {
    return { ...this.persistedAgentMeta };
  }

  async handleCommand(command: StandaloneBrowserCommand): Promise<StandaloneHostChromeResult> {
    switch (command.type) {
      case 'saveAgentSeats':
        this.persistedAgentMeta = sanitizeAgentSeats(command.seats);
        return { handled: true, events: [] };
      case 'saveLayout':
        this.layout = isRecord(command.layout) ? { ...command.layout } : null;
        return { handled: true, events: [] };
      case 'setSoundEnabled':
        this.settings.soundEnabled = command.enabled === true;
        return { handled: true, events: [] };
      case 'removeExternalAssetDirectory':
        if (typeof command.path !== 'string') {
          return { handled: false, events: [] };
        }

        this.settings.externalAssetDirectories = this.settings.externalAssetDirectories.filter(
          (entry) => entry !== command.path,
        );
        return {
          handled: true,
          events: [
            {
              type: 'external_asset_directories_changed',
              dirs: [...this.settings.externalAssetDirectories],
            },
          ],
        };
      case 'addExternalAssetDirectory':
      case 'exportLayout':
      case 'importLayout':
      case 'openCodexSessions':
        return { handled: true, events: [] };
      default:
        return { handled: false, events: [] };
    }
  }
}

export function readStandaloneBrowserCommand(value: unknown): StandaloneBrowserCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  switch (value.type) {
    case 'webviewReady':
    case 'exportLayout':
    case 'addExternalAssetDirectory':
    case 'importLayout':
    case 'openCodexSessions':
      return { type: value.type };
    case 'focusAgent':
    case 'closeAgent':
      return typeof value.id === 'number' ? { type: value.type, id: value.id } : null;
    case 'startCodexSession':
      return {
        type: 'startCodexSession',
        ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
        ...(value.bypassPermissions === true ? { bypassPermissions: true } : {}),
      };
    case 'saveAgentSeats':
      return isRecord(value.seats)
        ? {
            type: 'saveAgentSeats',
            seats: value.seats as Record<number, StandaloneAgentSeat>,
          }
        : null;
    case 'saveLayout':
      return isRecord(value.layout)
        ? {
            type: 'saveLayout',
            layout: value.layout,
          }
        : null;
    case 'setSoundEnabled':
      return typeof value.enabled === 'boolean'
        ? {
            type: 'setSoundEnabled',
            enabled: value.enabled,
          }
        : null;
    case 'removeExternalAssetDirectory':
      return typeof value.path === 'string'
        ? {
            type: 'removeExternalAssetDirectory',
            path: value.path,
          }
        : null;
    default:
      return null;
  }
}

function sanitizeAgentSeats(
  seats: Record<number, StandaloneAgentSeat>,
): Record<string, StandaloneAgentSeat> {
  const normalized: Record<string, StandaloneAgentSeat> = {};

  for (const [id, seat] of Object.entries(seats)) {
    if (!seat || typeof seat !== 'object') {
      continue;
    }

    normalized[id] = {
      ...(typeof seat.palette === 'number' ? { palette: seat.palette } : {}),
      ...(typeof seat.hueShift === 'number' ? { hueShift: seat.hueShift } : {}),
      ...(typeof seat.seatId === 'string' ? { seatId: seat.seatId } : {}),
    };
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
