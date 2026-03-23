# Standalone Pixel Agents With OpenClaw-First Backend Architecture

Date: 2026-03-23

## Goal

Turn this Codex-focused fork into a host-agnostic agent visualization system that:

- keeps Codex working now for local testing
- adds a standalone browser host outside VS Code
- treats OpenClaw as the long-term primary integration target
- avoids locking the UI or host runtime to Codex-specific or Claude-specific assumptions

The first shipped standalone milestone should work with Codex, but the architecture must be designed so OpenClaw can become the primary runtime adapter without another structural rewrite.

## Product Direction

The product should no longer be modeled as a VS Code extension with a one-off Codex patch. It should be modeled as:

1. a reusable visualization UI
2. a host runtime
3. pluggable backend adapters

Codex is the first proving runtime because it is available now. OpenClaw is the eventual primary runtime because the long-term product intent is to visualize OpenClaw agents and future OpenClaw-oriented features.

## Scope

### In Scope

- define a standalone host architecture
- define a backend adapter boundary
- preserve current VS Code + Codex behavior during migration
- enable a standalone browser host powered by a Codex backend first
- design the future OpenClaw backend around official OpenClaw Gateway concepts

### Out of Scope For The First Milestone

- implementing the OpenClaw adapter itself
- redesigning the office UI
- changing the current visual interaction model
- introducing backend-specific UI behavior beyond capability gating
- rewriting the current event-driven office state machine

## Current Constraints

### Current State Of This Fork

- The current production host is still VS Code via `PixelAgentsViewProvider`.
- The current backend logic is effectively embedded inside the VS Code host shell.
- The current Codex integration already has a working session watcher and launch flow.
- The web UI can render in browser mode for development, but it does not yet have a real standalone backend.

### OpenClaw Constraint

OpenClaw documentation indicates a Gateway-based architecture with operator clients using documented protocols and session APIs. That makes Gateway integration a better long-term source of truth than log parsing. Transcript files remain useful as fallback, but should not be the primary design center if Gateway events are sufficient.

## Approaches Considered

### Approach 1: Capability-Based Standalone Host With Pluggable Backends

Build one standalone server, one browser bridge, and one neutral event model. Implement Codex first and OpenClaw second.

Pros:

- aligns with the long-term OpenClaw goal
- preserves Codex as a practical short-term backend
- avoids a second rewrite later
- keeps launch/select/close optional by backend capability

Cons:

- more upfront architecture work than a direct Codex-only port

### Approach 2: Port PR #166 And Swap In Codex

Reuse the standalone PR structure but replace the Claude scanner with Codex logic.

Pros:

- fastest route to a browser demo

Cons:

- architecture remains shaped by an older Claude-specific branch
- likely requires another restructuring when OpenClaw becomes primary
- message contract drift and asset/runtime drift already exist

### Approach 3: OpenClaw-First Immediately

Design everything around OpenClaw first and defer Codex.

Pros:

- purest alignment with the long-term target

Cons:

- weaker near-term testing story because OpenClaw is not set up yet
- higher implementation risk with less feedback

## Decision

Adopt Approach 1.

Build a capability-based standalone host with pluggable backends. Implement Codex first, but shape the backend boundary and standalone protocol around future OpenClaw integration.

## Architecture

The system is split into four layers.

### 1. Presentation Layer: `webview-ui`

The current React/canvas office remains the presentation layer. It should continue consuming high-level office events such as:

- agents appearing and disappearing
- tool activity starting and finishing
- waiting and active states
- settings/layout/assets updates
- subagent activity

The goal is to minimize UI churn in the first migration slices.

### 2. Host Layer: Standalone Server

A new `standalone/` application becomes the non-VS-Code runtime shell. It is responsible for:

- serving the web application
- exposing a typed WebSocket protocol
- holding a projection/cache of runtime state for connected browser clients
- routing commands to the active runtime adapter or host/product services
- broadcasting normalized backend events to all connected clients

This host becomes the long-term runtime for OpenClaw visualization outside VS Code.

### 3. Product Services Layer

These services are backend-agnostic and must not be owned by any runtime adapter:

- asset loading and catalog preparation
- layout persistence
- agent seat persistence
- sound/settings persistence
- external asset directory persistence
- workspace scope configuration for standalone

These services are shared by both VS Code and standalone hosts.

### 4. Backend Adapter Layer

Runtime adapters translate runtime-specific activity into a normalized event stream.

Initial runtime adapters:

- `CodexRuntimeAdapter`
- `OpenClawRuntimeAdapter` (future)

The UI and standalone host must not depend on Codex transcript structure, Claude transcript structure, or OpenClaw Gateway specifics directly.

## Backend Capability Model

Every runtime adapter exposes its supported runtime actions through capabilities instead of forcing one behavior across all runtimes.

Example capability shape:

```ts
type BackendCapabilities = {
  observe: true;
  launch: boolean;
  select: boolean;
  close: boolean;
};
```

Rationale:

- Codex can support launch now
- OpenClaw may start as observe-only
- future runtimes may support some actions but not others
- UI behavior can be gated instead of hardcoded

This is less limiting than an observe-only architecture and safer than assuming every backend can launch or select sessions.

Capabilities must come from an explicit adapter method and are assumed static for the lifetime of an adapter instance. If a runtime ever needs dynamic capabilities, that should be added as a separate explicit event.

### Host Capabilities

The host also exposes host-local capabilities for actions that are not runtime features, such as:

- revealing transcripts
- opening a sessions root
- import/export dialogs
- asset directory picking

The UI must gate these separately from runtime capabilities because they differ between VS Code and standalone for host reasons, not backend reasons.

## Normalized Event Model

The host should normalize runtime and product-service activity into a common event bus.

Core normalized events:

- `sessions_snapshot`
- `session_discovered`
- `session_closed`
- `status_changed`
- `tool_started`
- `tool_finished`
- `tools_cleared`
- `permission_requested`
- `permission_cleared`
- `subagent_started`
- `subagent_finished`
- `layout_changed`
- `settings_changed`
- `assets_loaded`

These normalized events are richer than the current webview message protocol. The standalone bridge or VS Code host adapter can translate them into the current UI-facing messages during migration.

Session selection should be treated as client-local UI state, not as a shared cross-client event. A host may still translate local selection into the current UI contract when needed, but it should not broadcast selection globally across browser clients.

## Command Model

The command model is split in two.

### Backend Commands

These target runtime adapters:

- `launch_session`
- `close_session`
- `select_session`

### Host/Product Commands

These target host or product services:

- `save_layout`
- `save_agent_seats`
- `set_sound_enabled`
- `add_asset_directory`
- `remove_asset_directory`
- `reveal_transcript`
- `reveal_sessions_root`
- `import_layout`
- `export_layout`

The host checks runtime capabilities before dispatching backend commands. Unsupported commands fail explicitly instead of silently degrading.

## Data Flow

### Standalone Startup Flow

1. Browser loads the app from `standalone/`.
2. Browser bridge opens a WebSocket connection.
3. Host attaches to the runtime adapter before exposing live events to the browser.
4. Host sends bootstrap payloads in a fixed order:
   - backend capabilities
   - settings
   - workspace scopes if available
   - assets
   - layout
   - current sessions snapshot
5. Browser bridge translates bootstrap payloads into the existing UI message sequence.

Ordering guarantee:

- the runtime adapter must not emit externally visible live events before attachment completes
- the host must not forward live runtime events to the browser before bootstrap delivery completes
- after bootstrap completion, all live events are delivered in host transport order

### Live Flow

1. Runtime adapter emits normalized events.
2. Host updates its cached runtime projection if needed.
3. Host broadcasts normalized events to all connected clients.
4. Browser bridge converts them into the current `window.message` shape expected by the React app.
5. UI updates without needing backend-specific logic.

### Command Flow

1. UI sends a command through the browser bridge.
2. Host validates command shape and routes the command either to a runtime adapter or to host/product services.
3. The runtime adapter or host/product service performs the action or rejects it.
4. Resulting state changes come back as events.

The important rule is that commands do not mutate UI state directly. Events remain the source of truth.

## Interface Boundary

The runtime boundary should be minimal and explicit.

```ts
export interface Disposable {
  dispose(): void;
}

export interface PixelAgentsRuntimeAdapter {
  getCapabilities(): BackendCapabilities;
  connect(listener: (event: PixelAgentsEvent) => void): Promise<PixelAgentsRuntimeBootstrap>;
  dispatch(command: PixelAgentsBackendCommand): Promise<void>;
  dispose(): void;
}
```

The concrete TypeScript types can evolve, but the core responsibilities should remain:

- capability reporting
- ordered bootstrap connection
- runtime command dispatch
- cleanup

`PixelAgentsRuntimeBootstrap` must contain runtime-owned bootstrap data only, such as sessions snapshot, runtime capabilities, and runtime-discovered folder names. Assets, layout, settings, and external asset directories come from product services, not from the runtime adapter.

## Codex Backend Strategy

Codex is the first implementation because it is already available and testable.

The first runtime adapter should be created by extracting current logic behind one reusable `CodexRuntimeAdapter` that can be hosted by both VS Code and standalone.

Codex modules to move behind the runtime boundary:

- `CodexSessionWatcher.ts`
- `codexTerminal.ts`
- `sessionDisplayName.ts`

Host/product services that stay outside the runtime adapter:

- `layoutPersistence.ts`
- `configPersistence.ts`
- asset loading logic from `assetLoader.ts`

The watcher core is already strong enough to become the first reusable Codex runtime nucleus. The remaining work is separation of VS Code UI actions from runtime observation and launch support.

### Workspace Scope For Standalone Codex

Unlike VS Code, a standalone browser host does not automatically know which workspace roots to watch. The standalone host must therefore own workspace scope configuration explicitly. The first standalone Codex milestone should support at least one configured workspace root through host config, with room to extend to multiple roots later.

Without explicit workspace scope, Codex discovery is underspecified because the current watcher filters sessions against known workspace paths.

## OpenClaw Backend Strategy

OpenClaw should be designed as the future primary runtime adapter.

### Primary Integration Surface

Use OpenClaw Gateway/WebSocket or documented session APIs as the preferred source of truth.

Reasons:

- it matches OpenClaw’s documented architecture
- it is the intended control plane for operator clients
- it should be more stable than relying on transcript file internals
- it supports future richer features beyond passive visualization

### Fallback Integration Surface

If Gateway events are insufficient for some visualization detail, use transcript parsing only as a targeted fallback.

### Explicit Non-Goal

Do not center the OpenClaw design on log-tail parsing first. That would recreate the same maintenance problem this architecture is trying to avoid.

## Standalone Host Design

The standalone host should adapt ideas from upstream PR `#166`, but not copy it directly.

### Pieces To Adapt

- standalone package layout
- Express/static host pattern
- WebSocket bridge
- `acquireVsCodeApi()` browser shim concept
- bootstrap ordering idea

### Pieces To Rewrite

- Claude-specific scanner
- duplicated asset decoding logic
- old message payload shapes
- hardcoded build paths
- old command names and no-op action semantics

The current fork’s message contract must be preserved during migration, including:

- split wall payloads using `solidSets` and `glassSets`
- current settings payload shape
- current agent naming/folder naming behavior
- current buffered bootstrap expectations in the UI
- current external asset directory behavior

## Browser Bridge Design

The browser bridge should:

- emulate `acquireVsCodeApi()`
- keep a reconnect-safe WebSocket connection
- queue outbound messages while disconnected
- translate host protocol frames into current webview messages
- persist UI-only browser state if needed

It must not:

- parse transcripts
- infer session truth
- own backend logic
- become a second runtime controller

The browser bridge is intentionally thin.

## Migration Plan

### Slice 1: Extract Runtime Boundary In VS Code

Create a `PixelAgentsRuntimeAdapter` interface and a reusable `CodexRuntimeAdapter`.

Goal:

- preserve current behavior
- make `PixelAgentsViewProvider` thinner
- isolate runtime observation and launch behavior behind one adapter

At the end of this slice, the current VS Code extension should still work exactly as it does today.

VS Code-only actions such as revealing transcripts, opening folders, and file dialogs stay in host chrome services.

### Slice 2: Add Standalone Host

Create `standalone/` with:

- HTTP/WebSocket server
- browser bridge
- typed host protocol
- protocol translation layer

This slice should reuse the extracted runtime boundary instead of duplicating logic.

### Slice 3: Implement `StandaloneCodexHost` Using `CodexRuntimeAdapter`

Reuse the extracted Codex runtime adapter so the standalone host can be tested immediately with Codex.

This is the first end-to-end browser milestone.

### Slice 4: Capability-Aware UI Integration

Expose backend and host capabilities through the host so launch/select/close actions and host-local reveal/import/export actions can be enabled or disabled cleanly.

The current UI contract can remain stable during this slice, but the host must already understand capabilities.

### Slice 5: Implement `OpenClawRuntimeAdapter`

Build an OpenClaw adapter around Gateway/session APIs first. Add transcript fallback only where required.

This becomes the main long-term backend for the product.

## Testing Strategy

### Runtime Adapter Tests

- normalized event translation tests
- command dispatch tests
- capability reporting tests
- bootstrap generation tests

### Standalone Host Tests

- WebSocket connection and bootstrap ordering
- command routing
- reconnect behavior
- multiple client fanout

### UI Regression Tests

- existing UI contract remains valid when driven through the bridge
- current office state behavior remains unchanged

### Integration Tests

- VS Code + Codex still works after the backend extraction
- standalone + Codex works end-to-end
- future OpenClaw adapter can be tested against Gateway mock fixtures

## Risks

### Risk: Message Contract Drift

The current UI message protocol and the future normalized backend protocol may diverge.

Mitigation:

- keep a dedicated translation layer
- test bootstrap ordering and live event mappings explicitly

### Risk: Codex Extraction Adds Regressions

The current VS Code behavior is embedded in one host class.

Mitigation:

- make extraction the first slice
- preserve the existing UI contract and verification steps

### Risk: OpenClaw Gateway May Not Expose Every Visualization Signal

Mitigation:

- keep transcript fallback as a targeted secondary path
- do not force the whole design around transcript parsing

### Risk: Standalone Host Repeats Upstream PR Drift

Mitigation:

- adapt the standalone concept
- do not copy the old Claude-specific implementation wholesale

## Final Recommendation

Proceed with a capability-based standalone host and pluggable backend architecture.

The first shipped standalone milestone should be:

- standalone browser host
- Codex backend
- OpenClaw-ready backend boundary

That gives immediate testability while keeping the architecture aligned with the actual long-term goal: OpenClaw-first agent visualization.
