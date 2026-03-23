import {
  createCharacterSpritesLoadedMessage,
  createFloorTilesLoadedMessage,
  createFurnitureAssetsLoadedMessage,
  createWallTilesLoadedMessage,
  type LoadedAssets,
  type LoadedCharacterSprites,
  type LoadedFloorTiles,
  type LoadedWallTiles,
} from '../assetLoader.js';
import type { PixelAgentsEvent } from '../runtime/contracts.js';

export interface WorkspaceFolderMessage {
  name: string;
  path: string;
}

export interface SessionSnapshotEntry {
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  folderName?: string;
}

type AgentMetaRecord = Record<number, { palette?: number; hueShift?: number; seatId?: string }>;
type FolderNamesRecord = Record<number, string>;

export type HostToWebviewEvent =
  | {
      type: 'settings_changed';
      soundEnabled: boolean;
      externalAssetDirectories: string[];
    }
  | {
      type: 'workspace_folders_loaded';
      folders: WorkspaceFolderMessage[];
    }
  | {
      type: 'external_asset_directories_changed';
      dirs: string[];
    }
  | {
      type: 'assets_loaded';
      characters?: LoadedCharacterSprites | null;
      floors?: LoadedFloorTiles | null;
      walls?: LoadedWallTiles | null;
      furniture?: LoadedAssets | null;
    }
  | {
      type: 'layout_changed';
      layout: Record<string, unknown> | null;
      wasReset?: boolean;
    }
  | {
      type: 'sessions_snapshot';
      sessions: SessionSnapshotEntry[];
    }
  | {
      type: 'session_discovered';
      id: number;
      folderName?: string;
    }
  | {
      type: 'session_closed';
      id: number;
    }
  | {
      type: 'session_selected';
      id: number;
    }
  | {
      type: 'status_changed';
      id: number;
      status: string;
    }
  | {
      type: 'tool_started';
      id: number;
      toolId: string;
      status: string;
      parentToolId?: string;
    }
  | {
      type: 'tool_finished';
      id: number;
      toolId: string;
      parentToolId?: string;
    }
  | {
      type: 'tools_cleared';
      id: number;
    }
  | {
      type: 'permission_requested';
      id: number;
      parentToolId?: string;
    }
  | {
      type: 'permission_cleared';
      id: number;
    }
  | {
      type: 'subagent_finished';
      id: number;
      parentToolId: string;
    };

export function bridgeHostEventToWebviewMessages(
  event: HostToWebviewEvent,
): Array<Record<string, unknown>> {
  switch (event.type) {
    case 'settings_changed':
      return [
        {
          type: 'settingsLoaded',
          soundEnabled: event.soundEnabled,
          externalAssetDirectories: event.externalAssetDirectories,
        },
      ];
    case 'workspace_folders_loaded':
      return [
        {
          type: 'workspaceFolders',
          folders: event.folders,
        },
      ];
    case 'external_asset_directories_changed':
      return [
        {
          type: 'externalAssetDirectoriesUpdated',
          dirs: event.dirs,
        },
      ];
    case 'assets_loaded': {
      const messages: Array<Record<string, unknown>> = [];
      if (event.characters) {
        messages.push(createCharacterSpritesLoadedMessage(event.characters));
      }
      if (event.floors) {
        messages.push(createFloorTilesLoadedMessage(event.floors));
      }
      if (event.walls) {
        messages.push(createWallTilesLoadedMessage(event.walls));
      }
      if (event.furniture) {
        messages.push(createFurnitureAssetsLoadedMessage(event.furniture));
      }
      return messages;
    }
    case 'layout_changed':
      return [
        {
          type: 'layoutLoaded',
          layout: event.layout,
          wasReset: event.wasReset ?? false,
        },
      ];
    case 'sessions_snapshot':
      return [createExistingAgentsMessage(event.sessions)];
    case 'session_discovered':
      return [
        {
          type: 'agentCreated',
          id: event.id,
          ...(event.folderName ? { folderName: event.folderName } : {}),
        },
      ];
    case 'session_closed':
      return [{ type: 'agentClosed', id: event.id }];
    case 'session_selected':
      return [{ type: 'agentSelected', id: event.id }];
    case 'status_changed':
      return [{ type: 'agentStatus', id: event.id, status: event.status }];
    case 'tool_started':
      if (event.parentToolId) {
        return [
          {
            type: 'subagentToolStart',
            id: event.id,
            parentToolId: event.parentToolId,
            toolId: event.toolId,
            status: event.status,
          },
        ];
      }
      return [
        {
          type: 'agentToolStart',
          id: event.id,
          toolId: event.toolId,
          status: event.status,
        },
      ];
    case 'tool_finished':
      if (event.parentToolId) {
        return [
          {
            type: 'subagentToolDone',
            id: event.id,
            parentToolId: event.parentToolId,
            toolId: event.toolId,
          },
        ];
      }
      return [{ type: 'agentToolDone', id: event.id, toolId: event.toolId }];
    case 'tools_cleared':
      return [{ type: 'agentToolsClear', id: event.id }];
    case 'permission_requested':
      if (event.parentToolId) {
        return [
          {
            type: 'subagentToolPermission',
            id: event.id,
            parentToolId: event.parentToolId,
          },
        ];
      }
      return [{ type: 'agentToolPermission', id: event.id }];
    case 'permission_cleared':
      return [{ type: 'agentToolPermissionClear', id: event.id }];
    case 'subagent_finished':
      return [{ type: 'subagentClear', id: event.id, parentToolId: event.parentToolId }];
  }
}

export function normalizeRuntimeEventToHostEvents(event: PixelAgentsEvent): HostToWebviewEvent[] {
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
      throw new Error(`Unsupported runtime event type: ${event.type}`);
  }
}

export function renderBootstrapAndRuntimeMessages({
  bootstrapEvents,
  runtimeEvents,
}: {
  bootstrapEvents: HostToWebviewEvent[];
  runtimeEvents: PixelAgentsEvent[];
}): Array<Record<string, unknown>> {
  return [
    ...renderHostEventsToWebviewMessages(bootstrapEvents),
    ...renderHostEventsToWebviewMessages(
      runtimeEvents.flatMap((event) => normalizeRuntimeEventToHostEvents(event)),
    ),
  ];
}

export function renderHostEventsToWebviewMessages(
  events: HostToWebviewEvent[],
): Array<Record<string, unknown>> {
  return events.flatMap((event) => bridgeHostEventToWebviewMessages(event));
}

function createExistingAgentsMessage(sessions: SessionSnapshotEntry[]): Record<string, unknown> {
  const sortedSessions = [...sessions].sort((left, right) => left.id - right.id);
  const agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
  const folderNames: Record<number, string> = {};

  for (const session of sortedSessions) {
    const meta = pickAgentMeta(session);
    if (meta) {
      agentMeta[session.id] = meta;
    }
    if (session.folderName) {
      folderNames[session.id] = session.folderName;
    }
  }

  return {
    type: 'existingAgents',
    agents: sortedSessions.map((session) => session.id),
    agentMeta,
    folderNames,
  };
}

function normalizeSessionsSnapshot(
  agentIds: number[],
  agentMeta: AgentMetaRecord,
  folderNames: FolderNamesRecord,
): SessionSnapshotEntry[] {
  return agentIds.map((id) => ({
    id,
    ...agentMeta[id],
    ...(folderNames[id] ? { folderName: folderNames[id] } : {}),
  }));
}

function pickAgentMeta(
  session: SessionSnapshotEntry,
): { palette?: number; hueShift?: number; seatId?: string } | null {
  const meta = {
    ...(typeof session.palette === 'number' ? { palette: session.palette } : {}),
    ...(typeof session.hueShift === 'number' ? { hueShift: session.hueShift } : {}),
    ...(typeof session.seatId === 'string' ? { seatId: session.seatId } : {}),
  };

  return Object.keys(meta).length > 0 ? meta : null;
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : [];
}

function readAgentMeta(value: unknown): AgentMetaRecord {
  if (!isRecord(value)) {
    return {};
  }

  const result: AgentMetaRecord = {};
  for (const [rawId, metaValue] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || !isRecord(metaValue)) {
      continue;
    }
    result[id] = {
      ...(typeof metaValue.palette === 'number' ? { palette: metaValue.palette } : {}),
      ...(typeof metaValue.hueShift === 'number' ? { hueShift: metaValue.hueShift } : {}),
      ...(typeof metaValue.seatId === 'string' ? { seatId: metaValue.seatId } : {}),
    };
  }
  return result;
}

function readFolderNames(value: unknown): FolderNamesRecord {
  if (!isRecord(value)) {
    return {};
  }

  const result: FolderNamesRecord = {};
  for (const [rawId, folderName] of Object.entries(value)) {
    const id = Number(rawId);
    if (Number.isFinite(id) && typeof folderName === 'string') {
      result[id] = folderName;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
