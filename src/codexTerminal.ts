const CODEX_TERMINAL_PREFIX = 'Codex';
const CODEX_TERMINAL_PATTERN = /^Codex #(\d+)$/;
const CODEX_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';

export interface CodexTerminal {
  show(): void;
  sendText(command: string): void;
}

export interface CodexTerminalHost {
  getTerminalNames(): string[];
  createTerminal(options: { name: string; cwd?: string }): CodexTerminal;
}

export interface BuildCodexLaunchCommandOptions {
  bypassPermissions?: boolean;
}

export interface LaunchCodexTerminalOptions extends BuildCodexLaunchCommandOptions {
  cwd?: string;
  terminalHost: CodexTerminalHost;
}

export function buildCodexLaunchCommand(options: BuildCodexLaunchCommandOptions = {}): string {
  return options.bypassPermissions ? `codex ${CODEX_BYPASS_FLAG}` : 'codex';
}

export function getNextCodexTerminalName(existingTerminalNames: string[]): string {
  let maxTerminalIndex = 0;

  for (const terminalName of existingTerminalNames) {
    const match = CODEX_TERMINAL_PATTERN.exec(terminalName);
    if (!match) {
      continue;
    }

    const terminalIndex = Number.parseInt(match[1], 10);
    if (Number.isFinite(terminalIndex)) {
      maxTerminalIndex = Math.max(maxTerminalIndex, terminalIndex);
    }
  }

  return `${CODEX_TERMINAL_PREFIX} #${maxTerminalIndex + 1}`;
}

export function launchCodexTerminal(options: LaunchCodexTerminalOptions): CodexTerminal {
  const terminal = options.terminalHost.createTerminal({
    name: getNextCodexTerminalName(options.terminalHost.getTerminalNames()),
    cwd: options.cwd,
  });

  terminal.show();
  terminal.sendText(buildCodexLaunchCommand({ bypassPermissions: options.bypassPermissions }));

  return terminal;
}
