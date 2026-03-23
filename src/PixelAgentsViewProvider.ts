import * as fs from 'fs';
import * as vscode from 'vscode';

import type { CodexTerminalHost } from './codexTerminal.js';
import { ProductServices } from './host/productServices.js';
import { VsCodeHostChrome } from './host/vscodeHostChrome.js';
import { CodexRuntimeAdapter } from './runtime/CodexRuntimeAdapter.js';

type WebviewCommandMessage = { type: string; [key: string]: unknown };

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  webviewView: vscode.WebviewView | undefined;

  private codexRuntime: CodexRuntimeAdapter | null = null;
  private readonly productServices: ProductServices;
  private readonly hostChrome = new VsCodeHostChrome();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.productServices = new ProductServices(context, context.extensionUri, () => this.webview);
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private get workspacePaths(): string[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
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
        getAgentMeta: () => this.productServices.getPersistedAgentMeta(),
        terminalHost: this.codexTerminalHost,
      });
    }

    return this.codexRuntime;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (rawMessage) => {
      const message = readWebviewCommandMessage(rawMessage);
      if (!message) {
        return;
      }

      switch (message.type) {
        case 'openCodexSessions':
          this.hostChrome.openCodexSessionsFolder();
          return;
        case 'focusAgent':
          await this.ensureCodexRuntime().dispatch({
            type: 'select_session',
            id: message.id as number,
          });
          return;
        case 'closeAgent':
          await this.ensureCodexRuntime().dispatch({
            type: 'close_session',
            id: message.id as number,
          });
          return;
        case 'startCodexSession':
          await this.ensureCodexRuntime().dispatch({
            type: 'launch_session',
            cwd: typeof message.cwd === 'string' ? message.cwd : undefined,
            bypassPermissions: message.bypassPermissions === true,
          });
          return;
        case 'saveAgentSeats':
          this.productServices.saveAgentSeats(
            message.seats as Record<
              number,
              { palette?: number; hueShift?: number; seatId?: string }
            >,
          );
          return;
        case 'saveLayout':
          this.productServices.saveLayout(message.layout as Record<string, unknown>);
          return;
        case 'setSoundEnabled':
          this.productServices.setSoundEnabled(message.enabled === true);
          return;
        case 'webviewReady':
          await this.productServices.connectRuntime(this.ensureCodexRuntime());
          return;
        case 'exportLayout':
          await this.hostChrome.exportLayout(this.productServices.getSavedLayout());
          return;
        case 'addExternalAssetDirectory': {
          const directoryPath = await this.hostChrome.pickExternalAssetDirectory();
          if (directoryPath) {
            await this.productServices.addExternalAssetDirectory(directoryPath);
          }
          return;
        }
        case 'removeExternalAssetDirectory':
          if (typeof message.path === 'string') {
            await this.productServices.removeExternalAssetDirectory(message.path);
          }
          return;
        case 'importLayout': {
          const importedLayout = await this.hostChrome.importLayout();
          if (!importedLayout) {
            return;
          }
          if (!this.productServices.importLayout(importedLayout)) {
            this.hostChrome.showInvalidLayoutError();
            return;
          }
          this.hostChrome.showLayoutImportedSuccessfully();
          return;
        }
      }
    });
  }

  exportDefaultLayout(): void {
    this.productServices.exportDefaultLayout();
  }

  dispose() {
    this.codexRuntime?.dispose();
    this.codexRuntime = null;
    this.productServices.dispose();
  }
}

function readWebviewCommandMessage(value: unknown): WebviewCommandMessage | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { type?: unknown }).type !== 'string'
  ) {
    return null;
  }

  return value as WebviewCommandMessage;
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
