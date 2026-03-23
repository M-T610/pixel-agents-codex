import { useSyncExternalStore } from 'react';

import { isBrowserRuntime } from './runtime';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export interface VsCodeMessageEvent<T = unknown> {
  data: T;
}

type MessageListener<T = unknown> = (event: VsCodeMessageEvent<T>) => void;

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

export interface HostCapabilitiesSnapshot {
  backendCapabilities: BackendCapabilities;
  hostCapabilities: HostCapabilities;
}

const defaultHostCapabilitiesSnapshot: HostCapabilitiesSnapshot = {
  backendCapabilities: {
    observe: true,
    launch: true,
    select: true,
    close: true,
  },
  hostCapabilities: {
    revealTranscript: true,
    revealSessionsRoot: true,
    importLayout: true,
    exportLayout: true,
    pickAssetDirectory: true,
  },
};

let hostCapabilitiesSnapshot = defaultHostCapabilitiesSnapshot;
const hostCapabilityListeners = new Set<() => void>();

function addWindowMessageListener<T>(listener: MessageListener<T>): () => void {
  const handler = (event: MessageEvent<T>) => {
    applyHostCapabilitiesMessage(event.data);
    listener({ data: event.data });
  };
  window.addEventListener('message', handler as EventListener);
  return () => window.removeEventListener('message', handler as EventListener);
}

export function applyHostCapabilitiesMessage(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'hostCapabilitiesLoaded') {
    return false;
  }

  const nextSnapshot: HostCapabilitiesSnapshot = {
    backendCapabilities: {
      observe: true,
      launch: value.backendCapabilities?.launch !== false,
      select: value.backendCapabilities?.select !== false,
      close: value.backendCapabilities?.close !== false,
    },
    hostCapabilities: {
      revealTranscript: value.hostCapabilities?.revealTranscript !== false,
      revealSessionsRoot: value.hostCapabilities?.revealSessionsRoot !== false,
      importLayout: value.hostCapabilities?.importLayout !== false,
      exportLayout: value.hostCapabilities?.exportLayout !== false,
      pickAssetDirectory: value.hostCapabilities?.pickAssetDirectory !== false,
    },
  };

  if (hostCapabilitiesSnapshotsEqual(hostCapabilitiesSnapshot, nextSnapshot)) {
    return true;
  }

  hostCapabilitiesSnapshot = nextSnapshot;
  for (const listener of hostCapabilityListeners) {
    listener();
  }
  return true;
}

export function getHostCapabilitiesSnapshot(): HostCapabilitiesSnapshot {
  return {
    backendCapabilities: { ...hostCapabilitiesSnapshot.backendCapabilities },
    hostCapabilities: { ...hostCapabilitiesSnapshot.hostCapabilities },
  };
}

export function useHostCapabilities(): HostCapabilitiesSnapshot {
  return useSyncExternalStore(
    subscribeToHostCapabilities,
    getHostCapabilitiesSnapshot,
    getHostCapabilitiesSnapshot,
  );
}

function subscribeToHostCapabilities(listener: () => void): () => void {
  hostCapabilityListeners.add(listener);
  return () => {
    hostCapabilityListeners.delete(listener);
  };
}

function hostCapabilitiesSnapshotsEqual(
  left: HostCapabilitiesSnapshot,
  right: HostCapabilitiesSnapshot,
): boolean {
  return (
    left.backendCapabilities.observe === right.backendCapabilities.observe &&
    left.backendCapabilities.launch === right.backendCapabilities.launch &&
    left.backendCapabilities.select === right.backendCapabilities.select &&
    left.backendCapabilities.close === right.backendCapabilities.close &&
    left.hostCapabilities.revealTranscript === right.hostCapabilities.revealTranscript &&
    left.hostCapabilities.revealSessionsRoot === right.hostCapabilities.revealSessionsRoot &&
    left.hostCapabilities.importLayout === right.hostCapabilities.importLayout &&
    left.hostCapabilities.exportLayout === right.hostCapabilities.exportLayout &&
    left.hostCapabilities.pickAssetDirectory === right.hostCapabilities.pickAssetDirectory
  );
}

function isRecord(value: unknown): value is Record<string, unknown> & {
  backendCapabilities?: Record<string, unknown>;
  hostCapabilities?: Record<string, unknown>;
} {
  return typeof value === 'object' && value !== null;
}

export const vscode: {
  postMessage(msg: unknown): void;
  onMessage<T = unknown>(listener: MessageListener<T>): () => void;
} = isBrowserRuntime
  ? {
      postMessage: () => {},
      onMessage: addWindowMessageListener,
    }
  : {
      ...(acquireVsCodeApi() as { postMessage(msg: unknown): void }),
      onMessage: addWindowMessageListener,
    };
