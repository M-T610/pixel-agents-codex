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

export type HostToWebviewEvent =
  | PixelAgentsEvent
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
      type: 'subagent_started';
      id: number;
      parentToolId: string;
      label: string;
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
      const assetsEvent = event as Extract<HostToWebviewEvent, { type: 'assets_loaded' }>;
      const messages: Array<Record<string, unknown>> = [];
      if (assetsEvent.characters) {
        messages.push(createCharacterSpritesLoadedMessage(assetsEvent.characters));
      }
      if (assetsEvent.floors) {
        messages.push(createFloorTilesLoadedMessage(assetsEvent.floors));
      }
      if (assetsEvent.walls) {
        messages.push(createWallTilesLoadedMessage(assetsEvent.walls));
      }
      if (assetsEvent.furniture) {
        messages.push(createFurnitureAssetsLoadedMessage(assetsEvent.furniture));
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
      return [
        createExistingAgentsMessage(
          (event as Extract<HostToWebviewEvent, { type: 'sessions_snapshot' }>).sessions,
        ),
      ];
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
    case 'subagent_started':
      return [
        {
          type: 'agentToolStart',
          id: event.id,
          toolId: event.parentToolId,
          status: `Subtask: ${event.label}`,
        },
      ];
    case 'subagent_finished':
      return [{ type: 'subagentClear', id: event.id, parentToolId: event.parentToolId }];
    default:
      return [event];
  }
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
