export interface HostCapabilities {
  revealTranscript: boolean;
  revealSessionsRoot: boolean;
  importLayout: boolean;
  exportLayout: boolean;
  pickAssetDirectory: boolean;
}

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
  | { type: 'openCodexSessions' }
  | { type: string; [key: string]: unknown };

export type StandaloneChromeEvent =
  | { type: 'settings_changed'; soundEnabled: boolean; externalAssetDirectories: string[] }
  | { type: 'external_asset_directories_changed'; dirs: string[] }
  | { type: 'layout_changed'; layout: StandaloneLayout | null; wasReset?: boolean };

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
        return { handled: false, events: [] };
      default:
        return { handled: false, events: [] };
    }
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
