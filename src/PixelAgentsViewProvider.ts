import * as fs from 'fs';
import * as os from 'os';
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
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import type { CodexTerminalHost } from './codexTerminal.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import {
  migrateAndLoadLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from './layoutPersistence.js';
import { CodexRuntimeAdapter } from './runtime/CodexRuntimeAdapter.js';
import type { PixelAgentsEvent } from './runtime/contracts.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  webviewView: vscode.WebviewView | undefined;

  // Bundled default layout (loaded from assets/default-layout.json)
  defaultLayout: Record<string, unknown> | null = null;

  // Root path of bundled assets (set once on first load)
  private assetsRoot: string | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;
  codexRuntime: CodexRuntimeAdapter | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private get workspacePaths(): string[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  }

  private get codexSessionsRoot(): string {
    return path.join(os.homedir(), '.codex', 'sessions');
  }

  private get codexTerminalHost(): CodexTerminalHost {
    return {
      getTerminalNames: () => vscode.window.terminals.map((terminal) => terminal.name),
      createTerminal: (options) => {
        const terminal = vscode.window.createTerminal(options);
        return {
          show: () => terminal.show(),
          sendText: (command) => terminal.sendText(command),
        };
      },
    };
  }

  private ensureCodexRuntime(): CodexRuntimeAdapter {
    if (!this.codexRuntime) {
      this.codexRuntime = new CodexRuntimeAdapter({
        workspacePaths: this.workspacePaths,
        getAgentMeta: () => this.getPersistedAgentMeta(),
        terminalHost: this.codexTerminalHost,
      });
    }

    return this.codexRuntime;
  }

  private getPersistedAgentMeta(): Record<
    string,
    { palette?: number; hueShift?: number; seatId?: string }
  > {
    return this.context.workspaceState.get<
      Record<string, { palette?: number; hueShift?: number; seatId?: string }>
    >(WORKSPACE_KEY_AGENT_SEATS, {});
  }

  private async connectCodexRuntime(): Promise<void> {
    const bufferedEvents: PixelAgentsEvent[] = [];
    let runtimeEventsUnlocked = false;

    await this.ensureCodexRuntime().connect((event) => {
      if (runtimeEventsUnlocked) {
        this.webview?.postMessage(event);
        return;
      }

      bufferedEvents.push(event);
    });

    const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
    const config = readConfig();
    this.webview?.postMessage({
      type: 'settingsLoaded',
      soundEnabled,
      externalAssetDirectories: config.externalAssetDirectories,
    });

    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 1) {
      this.webview?.postMessage({
        type: 'workspaceFolders',
        folders: wsFolders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
      });
    }

    await this.loadAssetsAndLayout();

    runtimeEventsUnlocked = true;
    for (const event of bufferedEvents) {
      this.webview?.postMessage(event);
    }
  }

  private openCodexSessionsFolder(): void {
    if (!fs.existsSync(this.codexSessionsRoot)) {
      return;
    }

    void vscode.env.openExternal(vscode.Uri.file(this.codexSessionsRoot));
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openCodexSessions') {
        this.openCodexSessionsFolder();
      } else if (message.type === 'focusAgent') {
        await this.ensureCodexRuntime().dispatch({
          type: 'select_session',
          id: message.id as number,
        });
      } else if (message.type === 'closeAgent') {
        await this.ensureCodexRuntime().dispatch({
          type: 'close_session',
          id: message.id as number,
        });
      } else if (message.type === 'startCodexSession') {
        await this.ensureCodexRuntime().dispatch({
          type: 'launch_session',
          cwd: typeof message.cwd === 'string' ? message.cwd : undefined,
          bypassPermissions: message.bypassPermissions === true,
        });
      } else if (message.type === 'saveAgentSeats') {
        console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        await this.connectCodexRuntime();
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
        }
      } else if (message.type === 'addExternalAssetDirectory') {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Asset Directory',
        });
        if (!uris || uris.length === 0) return;
        const newPath = uris[0].fsPath;
        const cfg = readConfig();
        if (!cfg.externalAssetDirectories.includes(newPath)) {
          cfg.externalAssetDirectories.push(newPath);
          writeConfig(cfg);
        }
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: cfg.externalAssetDirectories,
        });
      } else if (message.type === 'removeExternalAssetDirectory') {
        const cfg = readConfig();
        cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter(
          (d) => d !== (message.path as string),
        );
        writeConfig(cfg);
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: cfg.externalAssetDirectories,
        });
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
        }
      }
    });
  }

  /** Export current saved layout as a versioned default-layout-{N}.json (dev utility) */
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
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(
      `Pixel Agents: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  private async loadAssetsAndLayout(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    try {
      const extensionPath = this.extensionUri.fsPath;
      const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
      let assetsRoot: string | null = null;
      if (fs.existsSync(bundledAssetsDir)) {
        assetsRoot = path.join(extensionPath, 'dist');
      } else if (workspaceRoot) {
        assetsRoot = workspaceRoot;
      }

      if (assetsRoot) {
        this.assetsRoot = assetsRoot;
        this.defaultLayout = loadDefaultLayout(assetsRoot);

        const charSprites = await loadCharacterSprites(assetsRoot);
        if (charSprites && this.webview) {
          sendCharacterSpritesToWebview(this.webview, charSprites);
        }

        const floorTiles = await loadFloorTiles(assetsRoot);
        if (floorTiles && this.webview) {
          sendFloorTilesToWebview(this.webview, floorTiles);
        }

        const wallTiles = await loadWallTiles(assetsRoot);
        if (wallTiles && this.webview) {
          sendWallTilesToWebview(this.webview, wallTiles);
        }

        const assets = await this.loadAllFurnitureAssets();
        if (assets && this.webview) {
          sendAssetsToWebview(this.webview, assets);
        }
      }
    } catch (err) {
      console.error('[Extension] Error loading assets:', err);
    }

    if (this.webview) {
      const result = migrateAndLoadLayout(this.context, this.defaultLayout);
      this.webview.postMessage({
        type: 'layoutLoaded',
        layout: result?.layout ?? null,
        wasReset: result?.wasReset ?? false,
      });
      this.startLayoutWatcher();
    }
  }

  private async loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!this.assetsRoot) return null;
    let assets = await loadFurnitureAssets(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external assets from:', extraDir);
      const extra = await loadFurnitureAssets(extraDir);
      if (extra) {
        assets = assets ? mergeLoadedAssets(assets, extra) : extra;
      }
    }
    return assets;
  }

  private async reloadAndSendFurniture(): Promise<void> {
    if (!this.assetsRoot || !this.webview) return;
    try {
      const assets = await this.loadAllFurnitureAssets();
      if (assets) {
        sendAssetsToWebview(this.webview, assets);
      }
    } catch (err) {
      console.error('[Extension] Error reloading furniture assets:', err);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change - pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.codexRuntime?.dispose();
    this.codexRuntime = null;
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
