import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceScope {
  name: string;
  path: string;
}

export interface WorkspaceScopeStoreOptions {
  initialScopes?: WorkspaceScope[];
  filePath?: string;
}

export class WorkspaceScopeStore {
  private scopes: WorkspaceScope[];

  constructor(private readonly options: WorkspaceScopeStoreOptions = {}) {
    this.scopes = normalizeWorkspaceScopes(options.initialScopes ?? []);
  }

  async list(): Promise<WorkspaceScope[]> {
    const persistedScopes = await this.readPersistedScopes();
    if (persistedScopes) {
      this.scopes = persistedScopes;
    }

    return [...this.scopes];
  }

  async replace(scopes: WorkspaceScope[]): Promise<WorkspaceScope[]> {
    this.scopes = normalizeWorkspaceScopes(scopes);

    if (this.options.filePath) {
      await mkdir(path.dirname(this.options.filePath), { recursive: true });
      await writeFile(this.options.filePath, JSON.stringify(this.scopes, null, 2), 'utf8');
    }

    return [...this.scopes];
  }

  private async readPersistedScopes(): Promise<WorkspaceScope[] | null> {
    if (!this.options.filePath) {
      return null;
    }

    try {
      const raw = await readFile(this.options.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }

      return normalizeWorkspaceScopes(
        parsed.map((entry) => ({
          name:
            typeof entry === 'object' && entry && typeof entry.name === 'string' ? entry.name : '',
          path:
            typeof entry === 'object' && entry && typeof entry.path === 'string' ? entry.path : '',
        })),
      );
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }
}

export function normalizeWorkspaceScopes(scopes: WorkspaceScope[]): WorkspaceScope[] {
  const seenPaths = new Set<string>();
  const normalized: WorkspaceScope[] = [];

  for (const scope of scopes) {
    const normalizedPath = scope.path.trim();
    if (!normalizedPath) {
      continue;
    }

    const dedupeKey = normalizedPath.toLowerCase();
    if (seenPaths.has(dedupeKey)) {
      continue;
    }

    seenPaths.add(dedupeKey);
    normalized.push({
      name: scope.name.trim() || path.basename(normalizedPath),
      path: normalizedPath,
    });
  }

  return normalized;
}
