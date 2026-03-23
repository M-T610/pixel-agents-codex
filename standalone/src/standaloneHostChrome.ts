import type { HostToWebviewEvent } from '../../src/host/webviewMessageBridge.js';
import type { HostCapabilities } from '../../src/runtime/contracts.js';
import * as layoutPersistenceModule from '../../src/layoutPersistence.js';
import * as configPersistenceModule from '../../src/configPersistence.js';

export interface StandaloneAgentSeat {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface StandaloneHostSettings {
  soundEnabled: boolean;
  externalAssetDirectories: string[];
}

export interface StandaloneSettingsStore {
  read(): { externalAssetDirectories: string[] };
  write(settings: { externalAssetDirectories: string[] }): void;
}

export interface StandaloneLayout {
  [key: string]: unknown;
}

export interface StandaloneLayoutStore {
  read(): StandaloneLayout | null;
  write(layout: StandaloneLayout): void;
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

export type StandaloneClientChromeEvent = Extract<HostToWebviewEvent, { type: 'session_selected' }>;

export interface StandaloneHostChromeOptions {
  capabilities?: Partial<HostCapabilities>;
  settings?: Partial<StandaloneHostSettings>;
  settingsStore?: StandaloneSettingsStore;
  layout?: StandaloneLayout | null;
  layoutStore?: StandaloneLayoutStore;
  persistedAgentMeta?: Record<string, StandaloneAgentSeat>;
}

export interface StandaloneHostChromeResult {
  handled: boolean;
  events: StandaloneChromeEvent[];
  clientEvents: StandaloneClientChromeEvent[];
}

const defaultHostCapabilities: HostCapabilities = {
  revealTranscript: false,
  revealSessionsRoot: false,
  importLayout: false,
  exportLayout: false,
  pickAssetDirectory: false,
};

const layoutPersistence = (
  'default' in layoutPersistenceModule &&
  layoutPersistenceModule.default &&
  typeof layoutPersistenceModule.default === 'object'
    ? layoutPersistenceModule.default
    : layoutPersistenceModule
) as {
  readLayoutFromFile: () => StandaloneLayout | null;
  writeLayoutToFile: (layout: StandaloneLayout) => void;
};
const configPersistence = (
  'default' in configPersistenceModule &&
  configPersistenceModule.default &&
  typeof configPersistenceModule.default === 'object'
    ? configPersistenceModule.default
    : configPersistenceModule
) as {
  readConfig: () => { externalAssetDirectories: string[] };
  writeConfig: (settings: { externalAssetDirectories: string[] }) => void;
};

const defaultLayoutStore: StandaloneLayoutStore = {
  read() {
    return layoutPersistence.readLayoutFromFile();
  },
  write(layout) {
    layoutPersistence.writeLayoutToFile(layout);
  },
};

const defaultSettingsStore: StandaloneSettingsStore = {
  read() {
    return configPersistence.readConfig();
  },
  write(settings) {
    configPersistence.writeConfig(settings);
  },
};

export class StandaloneHostChrome {
  private readonly capabilities: HostCapabilities;
  private readonly settingsStore: StandaloneSettingsStore;
  private readonly settings: StandaloneHostSettings;
  private readonly layoutStore: StandaloneLayoutStore;
  private layout: StandaloneLayout | null;
  private persistedAgentMeta: Record<string, StandaloneAgentSeat>;

  constructor(options: StandaloneHostChromeOptions = {}) {
    this.capabilities = {
      ...defaultHostCapabilities,
      ...(options.capabilities ?? {}),
    };
    this.settingsStore = options.settingsStore ?? defaultSettingsStore;
    const persistedSettings = this.settingsStore.read();
    this.settings = {
      soundEnabled: options.settings?.soundEnabled ?? true,
      externalAssetDirectories: [
        ...(options.settings?.externalAssetDirectories ??
          persistedSettings.externalAssetDirectories ??
          []),
      ],
    };
    this.layoutStore = options.layoutStore ?? defaultLayoutStore;
    this.layout = options.layout ?? this.layoutStore.read();
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
      case 'focusAgent':
        return {
          handled: true,
          events: [],
          clientEvents: [{ type: 'session_selected', id: command.id }],
        };
      case 'saveAgentSeats':
        this.persistedAgentMeta = sanitizeAgentSeats(command.seats);
        return { handled: true, events: [], clientEvents: [] };
      case 'saveLayout':
        this.layout = isRecord(command.layout) ? { ...command.layout } : null;
        if (this.layout) {
          this.layoutStore.write(this.layout);
        }
        return { handled: true, events: [], clientEvents: [] };
      case 'setSoundEnabled':
        this.settings.soundEnabled = command.enabled === true;
        return { handled: true, events: [], clientEvents: [] };
      case 'removeExternalAssetDirectory':
        if (typeof command.path !== 'string') {
          return { handled: false, events: [], clientEvents: [] };
        }

        this.settings.externalAssetDirectories = this.settings.externalAssetDirectories.filter(
          (entry) => entry !== command.path,
        );
        this.settingsStore.write({
          externalAssetDirectories: [...this.settings.externalAssetDirectories],
        });
        return {
          handled: true,
          events: [
            {
              type: 'external_asset_directories_changed',
              dirs: [...this.settings.externalAssetDirectories],
            },
          ],
          clientEvents: [],
        };
      case 'addExternalAssetDirectory':
      case 'exportLayout':
      case 'importLayout':
      case 'openCodexSessions':
        return { handled: true, events: [], clientEvents: [] };
      default:
        return { handled: false, events: [], clientEvents: [] };
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
