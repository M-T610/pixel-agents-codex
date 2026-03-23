import { isBrowserRuntime } from './runtime';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export interface VsCodeMessageEvent<T = unknown> {
  data: T;
}

type MessageListener<T = unknown> = (event: VsCodeMessageEvent<T>) => void;

function addWindowMessageListener<T>(listener: MessageListener<T>): () => void {
  const handler = (event: MessageEvent<T>) => listener({ data: event.data });
  window.addEventListener('message', handler as EventListener);
  return () => window.removeEventListener('message', handler as EventListener);
}

export const vscode: {
  postMessage(msg: unknown): void;
  onMessage<T = unknown>(listener: MessageListener<T>): () => void;
} = isBrowserRuntime
  ? {
      postMessage: () => {},
      onMessage: addWindowMessageListener,
    }
  : {
      ...(acquireVsCodeApi() as { postMessage(msg: unknown): void }),
      onMessage: addWindowMessageListener,
    };
