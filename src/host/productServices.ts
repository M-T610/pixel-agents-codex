import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  loadCharacterSprites,
  loadDefaultLayout,
  type LoadedAssets,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeLoadedAssets,
} from '../assetLoader.js';
import { readConfig, writeConfig } from '../configPersistence.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from '../constants.js';
import type { LayoutWatcher } from '../layoutPersistence.js';
import {
  migrateAndLoadLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from '../layoutPersistence.js';
import type { PixelAgentsEvent, PixelAgentsRuntimeAdapter } from '../runtime/contracts.js';
import {
  type HostToWebviewEvent,
  normalizeRuntimeEventToHostEvents,
  renderBootstrapAndRuntimeMessages,
  renderHostEventsToWebviewMessages,
} from './webviewMessageBridge.js';

type SeatRecord = { palette?: number; hueShift?: number; seatId?: string };

export class ProductServices {
  private assetsRoot: string | null = null;
  private defaultLayout: Record<string, unknown> | null = null;
  private layoutWatcher: LayoutWatcher | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri,
    private readonly getCurrentWebview: () => vscode.Webview | undefined,
  ) {}

  getPersistedAgentMeta(): Record<string, SeatRecord> {
    return this.context.workspaceState.get<Record<string, SeatRecord>>(
      WORKSPACE_KEY_AGENT_SEATS,
      {},
    );
  }

  async connectRuntime(runtime: PixelAgentsRuntimeAdapter): Promise<void> {
    const bufferedRuntimeEvents: PixelAgentsEvent[] = [];
    let runtimeEventsUnlocked = false;

    await runtime.connect((event) => {
      if (runtimeEventsUnlocked) {
        this.postRuntimeEvent(event);
        return;
      }

      bufferedRuntimeEvents.push(event);
    });

    this.postMessages(
      renderBootstrapAndRuntimeMessages({
        bootstrapEvents: await this.loadBootstrapEvents(),
        runtimeEvents: bufferedRuntimeEvents,
      }),
    );

    runtimeEventsUnlocked = true;
  }

  saveAgentSeats(seats: Record<number, SeatRecord>): void {
    console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(seats));
    void this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, seats);
  }

  saveLayout(layout: Record<string, unknown>): void {
    this.layoutWatcher?.markOwnWrite();
    writeLayoutToFile(layout);
  }

  setSoundEnabled(enabled: boolean): void {
    void this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, enabled);
  }

  getSavedLayout(): Record<string, unknown> | null {
    return readLayoutFromFile();
  }

  async addExternalAssetDirectory(directoryPath: string): Promise<void> {
    const config = readConfig();
    if (!config.externalAssetDirectories.includes(directoryPath)) {
      config.externalAssetDirectories.push(directoryPath);
      writeConfig(config);
    }

    await this.reloadAndPostFurniture();
    this.postHostEvents([
      {
        type: 'external_asset_directories_changed',
        dirs: config.externalAssetDirectories,
      },
    ]);
  }

  async removeExternalAssetDirectory(directoryPath: string): Promise<void> {
    const config = readConfig();
    config.externalAssetDirectories = config.externalAssetDirectories.filter(
      (entry) => entry !== directoryPath,
    );
    writeConfig(config);

    await this.reloadAndPostFurniture();
    this.postHostEvents([
      {
        type: 'external_asset_directories_changed',
        dirs: config.externalAssetDirectories,
      },
    ]);
  }

  importLayout(importedLayout: unknown): boolean {
    if (!isValidLayout(importedLayout)) {
      return false;
    }

    this.layoutWatcher?.markOwnWrite();
    writeLayoutToFile(importedLayout);
    this.postHostEvents([
      {
        type: 'layout_changed',
        layout: importedLayout,
      },
    ]);
    return true;
  }

  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }

    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');
    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
        }
      }
    }

    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(layout, null, 2), 'utf-8');
    vscode.window.showInformationMessage(
      `Pixel Agents: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  dispose(): void {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
  }

  private async loadBootstrapEvents(): Promise<HostToWebviewEvent[]> {
    const events: HostToWebviewEvent[] = [this.createSettingsChangedEvent()];

    const workspaceFoldersEvent = this.createWorkspaceFoldersLoadedEvent();
    if (workspaceFoldersEvent) {
      events.push(workspaceFoldersEvent);
    }

    events.push(...(await this.createAssetBootstrapEvents()));

    const result = migrateAndLoadLayout(this.context, this.defaultLayout);
    events.push({
      type: 'layout_changed',
      layout: result?.layout ?? null,
      wasReset: result?.wasReset ?? false,
    });

    this.startLayoutWatcher();
    return events;
  }

  private createSettingsChangedEvent(): HostToWebviewEvent {
    const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
    const config = readConfig();
    return {
      type: 'settings_changed',
      soundEnabled,
      externalAssetDirectories: config.externalAssetDirectories,
    };
  }

  private createWorkspaceFoldersLoadedEvent(): HostToWebviewEvent | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length <= 1) {
      return null;
    }

    return {
      type: 'workspace_folders_loaded',
      folders: folders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
    };
  }

  private async createAssetBootstrapEvents(): Promise<HostToWebviewEvent[]> {
    try {
      const assetsRoot = this.resolveAssetsRoot();
      if (!assetsRoot) {
        return [];
      }

      this.assetsRoot = assetsRoot;
      this.defaultLayout = loadDefaultLayout(assetsRoot);
      return [
        {
          type: 'assets_loaded',
          characters: await loadCharacterSprites(assetsRoot),
          floors: await loadFloorTiles(assetsRoot),
          walls: await loadWallTiles(assetsRoot),
          furniture: await this.loadAllFurnitureAssets(),
        },
      ];
    } catch (err) {
      console.error('[Extension] Error loading assets:', err);
      return [];
    }
  }

  private resolveAssetsRoot(): string | null {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const extensionPath = this.extensionUri.fsPath;
    const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
    if (fs.existsSync(bundledAssetsDir)) {
      return path.join(extensionPath, 'dist');
    }
    return workspaceRoot ?? null;
  }

  private async loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!this.assetsRoot) {
      return null;
    }

    let assets = await loadFurnitureAssets(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external assets from:', extraDir);
      const extraAssets = await loadFurnitureAssets(extraDir);
      if (extraAssets) {
        assets = assets ? mergeLoadedAssets(assets, extraAssets) : extraAssets;
      }
    }

    return assets;
  }

  private async reloadAndPostFurniture(): Promise<void> {
    if (!this.assetsRoot) {
      return;
    }

    try {
      const assets = await this.loadAllFurnitureAssets();
      if (assets) {
        this.postHostEvents([
          {
            type: 'assets_loaded',
            furniture: assets,
          },
        ]);
      }
    } catch (err) {
      console.error('[Extension] Error reloading furniture assets:', err);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) {
      return;
    }

    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change - pushing to webview');
      this.postHostEvents([
        {
          type: 'layout_changed',
          layout,
        },
      ]);
    });
  }

  private postRuntimeEvent(event: PixelAgentsEvent): void {
    this.postHostEvents(normalizeRuntimeEventToHostEvents(event));
  }

  private postHostEvents(events: HostToWebviewEvent[]): void {
    this.postMessages(renderHostEventsToWebviewMessages(events));
  }

  private postMessages(messages: Array<Record<string, unknown>>): void {
    const webview = this.getCurrentWebview();
    if (!webview) {
      return;
    }

    for (const message of messages) {
      webview.postMessage(message);
    }
  }
}

function isValidLayout(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { tiles?: unknown }).tiles)
  );
}
