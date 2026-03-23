# Standalone Host

This package runs the existing Pixel Agents web UI outside VS Code.

## Current state

The first standalone release is **Codex-backed today**.

- The standalone HTTP/WebSocket host serves the built web app from `dist/webview`.
- The browser bridge emulates `acquireVsCodeApi()` so the existing UI can run unchanged.
- Runtime bootstrap and live session events currently come from `CodexRuntimeAdapter`.
- Session selection is intentionally client-local in standalone, even though the shared runtime contract still supports backend selection in VS Code.

## OpenClaw-ready seam

The standalone host is intentionally split so the frontend transport does not depend on Codex directly.

- `standalone/src/server.ts` owns HTTP serving, WebSocket transport, bootstrap ordering, and host-local actions.
- `src/runtime/CodexRuntimeAdapter.ts` is the current runtime implementation plugged into that host.
- `src/host/webviewMessageBridge.ts` remains the shared translation layer from runtime/host events into UI-facing webview messages.

That means the standalone release is **OpenClaw-ready in architecture**, but **not OpenClaw-powered yet**.

## Future direction

The next runtime adapter should be **OpenClaw Gateway-first**, not a direct standalone-only fork of the current transport.

The intended path is:

1. Keep the standalone host and browser bridge stable.
2. Add a reusable OpenClaw adapter behind the existing runtime contract.
3. Prefer Gateway-mediated OpenClaw integration so Codex and future runtimes can share the same host/message surface.

This README is a guardrail against overstating current support: standalone ships with Codex now, and the OpenClaw work follows the existing adapter seam rather than replacing the host shell.

## Local commands

From `standalone/`:

- `npm test` runs standalone typecheck plus standalone transport/runtime tests.
- `npm run build` runs standalone typecheck.
- `npm start` starts the standalone host entrypoint.
