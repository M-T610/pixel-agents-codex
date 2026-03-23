export interface BackendCapabilities {
  observe: true;
  launch: boolean;
  select: boolean;
  close: boolean;
}

export interface HostCapabilities {
  revealTranscript: boolean;
  revealSessionsRoot: boolean;
  importLayout: boolean;
  exportLayout: boolean;
  pickAssetDirectory: boolean;
}

const defaultHostCapabilities = {
  revealTranscript: false,
  revealSessionsRoot: false,
  importLayout: false,
  exportLayout: false,
  pickAssetDirectory: false,
} satisfies HostCapabilities;

export function createHostCapabilities(
  overrides: Partial<HostCapabilities> = {},
): HostCapabilities {
  return {
    ...defaultHostCapabilities,
    ...overrides,
  };
}

export interface PixelAgentsEvent {
  type: string;
  [key: string]: unknown;
}

export interface PixelAgentsBackendCommand {
  type: string;
  [key: string]: unknown;
}

export interface PixelAgentsRuntimeBootstrap {
  backendCapabilities: BackendCapabilities;
}

export interface PixelAgentsRuntimeAdapter {
  getCapabilities(): BackendCapabilities;
  connect(listener: (event: PixelAgentsEvent) => void): Promise<PixelAgentsRuntimeBootstrap>;
  dispatch(command: PixelAgentsBackendCommand): Promise<void>;
  dispose(): void;
}
