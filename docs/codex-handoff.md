# Codex Handoff

Last updated: 2026-03-23

## Repo

- Upstream/reference repo path: `C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex`
- Active development worktree: `C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first`
- Development branch: `codex/openclaw-dev`
- Development HEAD: `f5a205f` (`fix: restore standalone vscode parity`)
- `main` stays clean and tracks upstream/reference work

## Current Branch Layout

- `main`
  - clean upstream/reference branch
  - current local repo root is checked out here
- `codex/openclaw-dev`
  - clean development branch in the dedicated worktree
  - this is the branch to continue building on

Old local branches/worktrees were retired. A local exclude entry was added for `.worktrees/` in `.git/info/exclude` so the root repo stays clean.

## What Is Implemented

- Codex-native session watching and panel behavior
- Shared runtime boundary between host/runtime/webview
- Standalone browser host in `standalone/`
- Standalone bootstrap ordering and host bridge
- Auto-open browser on `standalone\npm start`
- Standalone layout persistence using `C:\Users\Moham\.pixel-agents\layout.json`
- Standalone bundled asset bootstrap parity with VS Code host
  - characters
  - floors
  - walls
  - furniture
- Standalone external asset directory settings parity with VS Code host
- Capability-aware host/UI behavior already wired for the standalone path

## Important Current Behavior

- Standalone discovers Codex sessions from:
  - `C:\Users\Moham\.codex\session_index.jsonl`
  - `C:\Users\Moham\.codex\sessions\...`
- Sessions are filtered by exact `cwd` match against `PIXEL_AGENTS_WORKSPACES`
- If you see unexpected agents, the first thing to check is the workspace env var you launched standalone with

## What Is Not Yet Done

- OpenClaw runtime adapter is not implemented yet
- Standalone is still Codex-backed today
- The older local-branch `+ Session` multi-folder picker UX was reviewed but not ported into `codex/openclaw-dev`
  - if resumed, reimplement it against the current capability model and `cwd` message shape
- The interrupted security-review request was not executed

## Important Files

- `src/runtime/contracts.ts`
- `src/runtime/CodexRuntimeAdapter.ts`
- `src/host/productServices.ts`
- `src/host/vscodeHostChrome.ts`
- `src/host/webviewMessageBridge.ts`
- `src/CodexSessionWatcher.ts`
- `standalone/src/server.ts`
- `standalone/src/standaloneHostChrome.ts`
- `standalone/src/workspaceScopeStore.ts`
- `standalone/public/host-bridge.js`
- `webview-ui/src/vscodeApi.ts`
- `webview-ui/src/hooks/useExtensionMessages.ts`

## Recent Commits

- `f5a205f` `fix: restore standalone vscode parity`
- `13e9c2a` `feat: auto-open standalone browser`
- `199c82d` `fix: stabilize host capability snapshots`
- `7086142` `fix: align standalone watcher test double`
- `a228db3` `fix: restore transcript reveal on focus`
- `e467131` `docs: clarify openclaw-first standalone seam`
- `88c52d5` `fix: gate primary ui actions by capability`
- `fcd95bf` `feat: add capability-aware host ui`

## Verification Commands

Run from the development worktree unless noted:

```powershell
cd C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first
npm.cmd run build

cd standalone
npm.cmd test

cd ..\webview-ui
npm.cmd run build
```

## How To Run Standalone

From the development worktree:

```powershell
cd C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first
npm.cmd run build
$env:PIXEL_AGENTS_WORKSPACES='C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex;C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first'
cd standalone
npm.cmd start
```

Notes:

- Browser auto-opens by default
- Disable auto-open with:

```powershell
$env:PIXEL_AGENTS_NO_BROWSER='1'
```

- Hard-refresh the page with `Ctrl+Shift+R` after rebuilding

## How To Test In VS Code

Open the development worktree in VS Code:

`C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first`

Then:

1. Run `npm.cmd run build`
2. Press `F5`
3. Open the `PIXEL AGENTS` panel in the Extension Development Host
4. Start or continue a Codex session in the same workspace

## Preserved Local Notes

The old local handoff/plan notes were backed up outside the repo here:

`C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex-local-notes-backup\2026-03-23`

## Suggested Resume Prompt

Use this in a fresh chat:

```text
Open C:\Users\Moham\Documents\Docker\codex-office\pixel-agents-codex\.worktrees\codex-standalone-openclaw-first.
Use the skills and agents.
Read docs/codex-handoff.md first, then check git status and continue.
```
