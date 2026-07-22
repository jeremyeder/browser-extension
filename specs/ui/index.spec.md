# Ambient UI Specification

Operations dashboard and agent authoring workbench. Next.js BFF with OIDC authentication, React Query, and shadcn/ui.

## Sub-Specs

### [Architecture](architecture.spec.md)

Application architecture, BFF pattern, OIDC authentication, navigation, project scoping, cross-cutting concerns, migration plan, and design decisions.

### [Views](views.spec.md)

All UI views: dashboard, work (SDLC artifacts), sessions, agents, schedules, credentials, issues, and settings. Defines layout, data sources, and interactions.

### [Annotation System](annotations.spec.md)

Structured metadata on sessions, agents, and projects. Covers annotation schemas, display rules, and the annotation panel UI.

### [Live Preview and Real-Time Updates](live-preview.spec.md)

Visual feedback for running sessions including live preview, screenshot capture, real-time update streaming, and WebSocket integration.

### [Browser Extension](browser-extension.spec.md)

Canonical Chrome side panel that consumes the platform Enterprise Assistant contract, offers full onboarding or a memoryless Artoo starter through `Skip for now`, preserves persistent Agent-backed chat, imports token-free local Kind connection choices with a healthy-connection picker and `tenant-a` default, and exposes per-user opaque-identity-bound root-mediated Gemini Amber vTeam chat with runtime-independent children, bearer-token and public-client PKCE authentication modes, projected project Session loading, bootstrap-aware transcripts, deterministic packaging, exact extracted-artifact QA, and pre-tag release validation.
