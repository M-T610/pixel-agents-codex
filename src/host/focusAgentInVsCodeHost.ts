export interface FocusableCodexRuntime {
  dispatch(command: { type: 'select_session'; id: number }): Promise<void>;
  getSessionTranscriptPath(agentId: number): string | null;
}

export interface TranscriptRevealHostChrome {
  revealTranscript(transcriptPath: string): Promise<void>;
}

export async function focusAgentInVsCodeHost(options: {
  agentId: number;
  runtime: FocusableCodexRuntime;
  hostChrome: TranscriptRevealHostChrome;
}): Promise<void> {
  await options.runtime.dispatch({
    type: 'select_session',
    id: options.agentId,
  });

  const transcriptPath = options.runtime.getSessionTranscriptPath(options.agentId);
  if (!transcriptPath) {
    return;
  }

  await options.hostChrome.revealTranscript(transcriptPath);
}
