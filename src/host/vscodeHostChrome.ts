import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export class VsCodeHostChrome {
  private readonly codexSessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

  openCodexSessionsFolder(): void {
    if (!fs.existsSync(this.codexSessionsRoot)) {
      return;
    }

    void vscode.env.openExternal(vscode.Uri.file(this.codexSessionsRoot));
  }

  async revealTranscript(transcriptPath: string): Promise<void> {
    if (!fs.existsSync(transcriptPath)) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(transcriptPath));
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
  }

  async exportLayout(layout: Record<string, unknown> | null): Promise<void> {
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'JSON Files': ['json'] },
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
    });
    if (!uri) {
      return;
    }

    fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
    vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
  }

  async importLayout(): Promise<unknown | null> {
    const uris = await vscode.window.showOpenDialog({
      filters: { 'JSON Files': ['json'] },
      canSelectMany: false,
    });
    if (!uris || uris.length === 0) {
      return null;
    }

    try {
      const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
      return JSON.parse(raw) as unknown;
    } catch {
      vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
      return null;
    }
  }

  showInvalidLayoutError(): void {
    vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
  }

  showLayoutImportedSuccessfully(): void {
    vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
  }

  async pickExternalAssetDirectory(): Promise<string | null> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select Asset Directory',
    });

    return uris && uris.length > 0 ? uris[0].fsPath : null;
  }
}
