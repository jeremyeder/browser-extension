# Runner

**Date:** 2026-04-05
**Last Updated:** 2026-07-17 — added immutable Enterprise Agent launch snapshots, reserved managed-memory MCP assembly, and exact-Session Vertex/OpenShell authority boundaries
**Status:** Living desired-state contract
**Related:** `control-plane.spec.md` — CP provisioning, token endpoint, start context assembly

---

## Purpose

This specification defines the observable Runner lifecycle for selecting an immutable per-Session runtime, consuming one authoritative startup input, processing later human turns, refreshing exact-Session authority, and preventing privileged startup or provider artifacts from reaching unauthorized agents or models.

## Requirements

### Requirement: Mutually Exclusive Startup State

The Runner SHALL accept exactly one valid resume, authoritative-bootstrap, trusted operator/CreateSession fallback, or proven-empty-history state and MUST fail before opening its message watch or reporting ready for every ambiguous or ineligible combination.

#### Scenario: Consume an authoritative bootstrap sequence

- GIVEN fresh startup provides one positive `INITIAL_BOOTSTRAP_SEQ=B`, mode-appropriate runtime authentication, and no resume, fallback, history-empty, prompt, or ensure carrier
- WHEN the Runner opens its Session message stream
- THEN it watches from `B - 1`, accepts the exact bootstrap at `B` once, and advances its reconnect cursor before model invocation
- AND a reconnect does not invoke that bootstrap again during the Runner lifetime

#### Scenario: Publish only an authorized operator fallback

- GIVEN trusted operator/CreateSession launch configuration provides the explicit fallback marker, one non-empty prompt, an exact-Session ensure capability, and refresh credential
- AND the API revalidates `Pending` or `Creating`, no `start_time`, and no `sdk_session_id`
- WHEN the Runner conditionally ensures the prompt
- THEN at most two identical total requests obtain one positive sequence and the watch opens from that sequence minus one
- AND the prompt is persisted as `bootstrap`, never `user`

#### Scenario: Reject ambiguous fresh or resume carriers

- GIVEN resume or fresh startup contains mutually inconsistent selectors, an unproved empty history, an unauthorized prompt, an invalid sequence, or fallback after execution began
- WHEN the Runner validates startup state
- THEN it opens no watch, reports no readiness, publishes no bootstrap, and invokes no model

### Requirement: Supervisor-Private Exact-Session Credentials

The Runner supervisor SHALL capture and remove Direct/Operator refresh, service, ensure, projected-identity, and launch-snapshot-path artifacts before bridge construction, SHALL reread the kubelet-rotated Direct/Operator token immediately before authentication, and MUST prevent agent/model access to those artifacts. Every supervisor-only path, descriptor, socket, capability, credential, lease handle, provider handle, and renewal handle SHALL be absent from the environment inherited by a bridge, MCP server, tool, hook, shell, CLI, SDK, Agent, model, or other child process. Gateway Runner receives no workload-identity path, SPIFFE Workload API socket, projected ServiceAccount token, OpenShell gateway JWT, JWT-SVID, private key, ACP attestation, refresh credential, or ensure capability. A dedicated runtime-auth helper outside the agent/model Landlock and process allowlists sends only the fixed runtime-only body through the exact OpenShell v0.0.82 Providers v2 HTTPS HTTP/1.1 `/token` binding; the supervisor injects the 60-second ACP attestation outside Runner. Runner input SHALL NOT select workload mode, origin, service-identity audience, scope, endpoint, trust domain, or Session.

#### Scenario: Refresh runtime authority on reconnect

- GIVEN an authenticated Runner reconnect requires a replacement service credential after its prior mode-specific workload proof may have expired
- WHEN Direct/Operator rereads the current kubelet-rotated token and presents its refresh credential, or the Gateway runtime-auth helper sends HTTPS HTTP/1.1 `POST /token` through Providers v2 with only wire body `{ "grant": "runtime-only" }`
- THEN it validates and atomically installs only the returned exact-Session service credential
- AND it rejects any unsolicited ensure capability, cross-Session credential, redirect, plaintext fallback, or invalid TLS peer

#### Scenario: Keep authorization artifacts outside the agent boundary

- GIVEN Runner startup or refresh has loaded privileged artifacts
- WHEN the bridge, SDK, CLI, MCP servers, tools, hooks, shells, or model subprocesses are constructed
- THEN their allowlisted environments and readable paths contain none of the launch-snapshot path, workload token, service credential, refresh credential, ensure capability, injected ACP attestation, SPIFFE socket, JWT-SVID, JWT key rings, or any other supervisor-only handle
- AND Gateway network/process policy denies ACP `/token` to every agent/model-invocable binary and hides the dedicated runtime-auth helper from child Landlock views
- AND the only permitted public trust material is mode-specific TLS trust: ACP serving CA for Direct/Operator or the per-Sandbox OpenShell proxy CA for Gateway, while the supervisor independently validates ACP upstream

### Requirement: Runtime-Selected Persistent Bridges

The Runner SHALL select the exact bridge named by immutable `Session.runner_type`, SHALL provide every supported persistent bridge the same generic pod-lifetime gRPC Session-message transport, and MUST fail closed without another-provider fallback when the runtime, executable, image, transport, or allowed credential mode is unavailable.

#### Scenario: Select the immutable Session runtime

- GIVEN the control plane provides a supported Session `runner_type` as `RUNNER_TYPE`
- WHEN the Runner starts
- THEN it loads only the matching registered `PlatformBridge`
- AND verifies the selected executable and required bridge capabilities before reporting ready
- AND an unknown or unavailable selector produces an actionable terminal failure without loading the default bridge

### Requirement: Immutable Enterprise Agent Launch Snapshot

For an Enterprise Agent Session, the Runner SHALL consume only the immutable
launch snapshot committed with that Session. The control plane SHALL project one
bounded, schema-versioned snapshot to a supervisor-owned read-only path before
constructing a bridge, MCP server, tool, hook, or Agent process. The Runner SHALL
require the snapshot Session, canonical User, Project, and Agent IDs to match its
exact workload and SHALL require `RUNNER_TYPE`, model, `system_instructions`,
`user_instruction_context`, provider context, and managed-memory state to equal
the snapshot.

The process entrypoint supervisor SHALL read and validate that projection before
importing or constructing any bridge or MCP implementation, retain only the
validated bounded values in private Runner state, and unset
`SESSION_LAUNCH_SNAPSHOT_PATH` before creating any child environment. The path and
projection SHALL not be inherited by, mounted into a readable child path for, or
otherwise exposed to any bridge, MCP server, tool, hook, shell, CLI, SDK, Agent,
model, or other child process.

The Runner SHALL NOT reread the mutable Agent, customization, template, provider,
attachment desired state, browser state, or repository configuration to reinterpret
the Session. Environment variables may carry transport locations and non-secret
compatibility values, but they SHALL NOT override snapshot authority. A missing,
malformed, unsupported, cross-Session, or inconsistent snapshot SHALL fail the
existing Session before bridge construction or model invocation.

For a provenanced Enterprise Agent Session, the Runner SHALL pass snapshot
`system_instructions` byte-for-byte and unchanged only through Gemini CLI's
privileged system-prompt input. It SHALL pass snapshot
`user_instruction_context` separately through the lower-priority
`session-user-instruction-context` channel. The Runner SHALL NOT concatenate,
reorder, re-render, normalize, promote, demote, or copy either field into the
other channel, a SessionMessage, bootstrap payload, MCP prompt, environment
variable, file payload, CLI argument visible to the Agent, or ordinary workspace
context.

The generic `Agent.prompt` compatibility carrier SHALL be excluded from
Enterprise bootstrap assembly even when its bytes equal `system_instructions`.
Project, Agent, Inbox, and Session compatibility prompt composition remains
unchanged only for ordinary Sessions. An Enterprise bootstrap contains only the
separately authorized user task/message content defined by the lifecycle
contract; it never transports either standing instruction field.

#### Scenario: Pending Session keeps its start-time state

- GIVEN an Enterprise Agent Session and launch snapshot committed successfully
- AND the Agent is customized before control-plane workload reconciliation
- WHEN the Runner starts
- THEN it uses the snapshot's original system instructions, lower-priority user
  instruction context, runtime, model, provider context, and managed-memory
  configuration
- AND it does not gain or lose a provider or memory capability from current Agent
  state

#### Scenario: Snapshot mismatch is terminal

- GIVEN the projected snapshot does not match the exact Session workload
- WHEN Runner startup validates it
- THEN no bridge, MCP server, tool, Agent process, or model is constructed
- AND the existing Session becomes terminal `Failed` with a bounded error

#### Scenario: Generic model mutation rejects Enterprise Sessions

- GIVEN the validated launch snapshot identifies a provenanced Enterprise Agent
  Session and fixes its model
- WHEN any caller invokes Runner `POST /model`, API
  `POST /sessions/{id}/model`, SDK/CLI model switching, or an equivalent generic
  mutation
- THEN the operation returns HTTP 409 protected-resource conflict without changing
  Runner or Session state
- AND only a future owner-authorized Agent Start may use a different model after
  an approved template contract changes it

#### Scenario: Gemini processes persistent Session turns

- GIVEN `RUNNER_TYPE=gemini-cli` and gRPC Session messaging is enabled
- WHEN bootstrap and later human messages arrive
- THEN `GeminiCLIBridge` uses the same bridge-neutral `start_grpc_listener` lifecycle, readiness gate, reconnect cursor, message writer, and shutdown semantics as every persistent bridge
- AND bootstrap executes once while later turns execute in the same Session workload
- AND neither bootstrap nor a later turn carries, reconstructs, or overrides the
  privileged system instructions or lower-priority user-instruction context
- AND the implementation does not copy a Claude-owned listener into Gemini or fall back to one-shot execution

#### Scenario: OpenShell image supports the selected runtime

- GIVEN a Gateway Session selects `gemini-cli`
- WHEN the control plane resolves the compatible Runner image and policy
- THEN ACP's owned derived OpenShell Runner image contains a pinned supported Gemini CLI executable
- AND its layered policy permits only the required Gemini or Vertex endpoints, executable path, and ACP MCP access without weakening ACP-reserved token/API rules
- AND a standard-image-only installation is insufficient evidence for OpenShell availability

#### Scenario: Enterprise Agent uses managed paid Vertex credentials

- GIVEN the Enterprise Agent launch snapshot selects `gemini-cli`
- WHEN ACP prepares Gemini authentication
- THEN this product path accepts only the ACP/OpenShell-managed paid Vertex AI
  Credential
- AND prohibits Gemini CLI Google-account or Code Assist OAuth and cached interactive login state, consistent with the [official third-party guidance](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md#why-cant-i-use-third-party-software-like-claude-code-openclaw-or-opencode-with-gemini-cli)
- AND provider injection supplies only the selected mode's required runtime values without persisting credentials in Agent or Session fields, logs, transcripts, or retained evidence
- AND it does not require a long-lived GCP service-account key file inside the sandbox
- AND missing or invalid provider injection fails closed before the model or any fallback authentication starts and terminalizes the already committed Session
- AND child specialist Sessions resolve their bridge and credentials independently from their own Agents

#### Scenario: Provider readiness and creation have distinct phases

- GIVEN synchronous Start preflight proved compatible gateway and proxy readiness
- WHEN the API commits the Session and immutable launch snapshot
- THEN the control plane idempotently creates the exact-Session Vertex provider
  from that snapshot before starting Runner
- AND provider creation failure marks the existing Session `Failed`, cleans
  partial authority, and starts no Runner or model

## Overview

The Ambient Runner is a Python FastAPI application that runs inside each session pod. It is the execution engine for one session: it owns the Claude Code subprocess lifecycle, bridges between the AG-UI HTTP protocol and the gRPC message store, streams results in real time, and exposes a local SSE tap for live event observation.

One runner pod runs per session. The pod is ephemeral — created by the CP when a session starts, deleted when the session ends.

```
CP creates runner pod
    │  env vars (SESSION_ID, INITIAL_PROMPT, AMBIENT_GRPC_URL, ...)
    ▼
Runner Pod (FastAPI + uvicorn)
    │
    ├── gRPC listener ←── WatchSessionMessages (api-server)
    │        │
    │        └──► bridge.run() ──► Claude Code subprocess
    │                    │
    │                    ├──► PushSessionMessage (api-server)       ← durable record
    │                    └──► _active_streams[thread_id] queue      ← SSE tap
    │
    └── HTTP endpoints
          ├── GET /events/{thread_id}      ← live SSE tap (drained by backend proxy)
          ├── POST /                       ← AG-UI run (HTTP path, backup)
          ├── POST /model                  ← runtime LLM model switch
          ├── POST /interrupt
          └── GET /health
```

---

## What the Runner Is

The runner is a **bridge**. It translates between three different message-passing systems:

| System | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| api-server gRPC | `WatchSessionMessages` | inbound | Authoritative bootstrap input and later human turns that trigger Claude runs |
| Claude Agent SDK | subprocess stdin/stdout | bidirectional | Drives Claude Code execution |
| api-server gRPC | `PushSessionMessage` | outbound | Durable conversation record (assistant turns) |
| SSE tap | `GET /events/{thread_id}` | outbound | Live event stream for the frontend and CLI |

The runner has no database. All persistent state (session messages, session phase) lives in the api-server.

---

## Source Layout

```
ambient_runner/
  app.py                          ← FastAPI application factory + lifespan
  bridge.py                       ← PlatformBridge ABC (integration contract)
  _grpc_client.py                 ← AmbientGRPCClient (service-authenticated exact-Session refresh, channel build)
  _session_messages_api.py        ← SessionMessagesAPI (hand-rolled proto codec)
  _inbox_messages_api.py          ← InboxMessagesAPI
  observability.py                ← ObservabilityManager (Langfuse)
  observability_config.py         ← Observability configuration
  observability_models.py         ← Langfuse event model types
  observability_privacy.py        ← Privacy-aware observability filtering
  mlflow_observability.py         ← MLflow observability integration

  platform/
    context.py                    ← RunnerContext dataclass (shared runtime state)
    config.py                     ← Config loaders (.ambient/ambient.json, payload .mcp.json, REPOS_JSON)
    auth.py                       ← Credential fetching + git identity + env population
    workspace.py                  ← Working directory resolution (workflow / multi-repo / default)
    prompts.py                    ← System prompt constants + workspace context builder
    utils.py                      ← Pure helpers (redact_secrets, get_bot_token, url_with_token)
    security_utils.py             ← Input validation helpers
    feedback.py                   ← User feedback storage

  bridges/claude/
    bridge.py                     ← ClaudeBridge (PlatformBridge impl)
    session.py                    ← SessionManager + SessionWorker (Claude subprocess isolation)
    grpc_transport.py             ← GRPCSessionListener + GRPCMessageWriter
    auth.py                       ← Vertex AI setup + model resolution
    mcp.py                        ← MCP server assembly
    tools.py                      ← In-process MCP tools (refresh_credentials, evaluate_rubric)
    backend_tools.py              ← acp_* MCP tools (backend API access for Claude)
    prompts.py                    ← SDK system prompt builder
    corrections.py                ← Correction detection and logging
    operational_events.py         ← Operational event emission (session lifecycle, errors)
    mock_client.py                ← Local dev mock (no Claude subprocess)
    fixtures/                     ← JSONL fixtures for local dev mock

  bridges/gemini_cli/             ← Gemini CLI bridge (separate impl, same ABC)
  bridges/langgraph/              ← LangGraph bridge (stub)

  # Baked-in config files (copied into runner image at build time)
  claude.json                     ← Claude Code onboarding state + trusted folders
  claude-settings.json            ← Tool permissions (allow/deny lists) for standard mode
  claude-settings-local.json      ← Tool permissions for local dev mode
  mcp.json                        ← Baked-in MCP servers (e.g. mcp-atlassian with env var refs)

  endpoints/
    run.py                        ← POST / (AG-UI run endpoint)
    events.py                     ← GET /events/{thread_id} (SSE tap)
    interrupt.py                  ← POST /interrupt
    health.py                     ← GET /health
    capabilities.py               ← GET /capabilities
    repos.py                      ← GET /repos
    workflow.py                   ← GET /workflow
    mcp_status.py                 ← GET /mcp-status
    content.py                    ← GET /content
    tasks.py                      ← GET /tasks
    feedback.py                   ← POST /feedback
    model.py                      ← POST /model (runtime LLM model switch)

  middleware/
    grpc_push.py                  ← grpc_push_middleware (HTTP-path event fan-out)
    developer_events.py           ← Dev-mode event logging
    secret_redaction.py           ← Token scrubbing from event payloads
    tracing.py                    ← Langfuse span injection

  tools/
    backend_api.py                ← BackendAPIClient (sync HTTP client for api-server REST)
```

---

## Startup Sequence

**Desired state — bootstrap sequencing:**

```
1. The process entrypoint supervisor captures every supervisor-only startup
   artifact into private state, including `SESSION_LAUNCH_SNAPSHOT_PATH`, the
   projected workload-identity path, refresh credential, and any startup ensure
   capability. It removes their environment variables before importing or
   constructing a bridge, agent SDK/CLI, MCP server, tool, hook, shell, or child.
   In Gateway mode the Runner receives none of the identity, refresh, ensure,
   capability, lease, provider, or renewal handles owned by OpenShell.
2. For an Enterprise Agent Session, the entrypoint loads and validates the
   supervisor-owned read-only launch snapshot before accepting configuration from
   any other source. It retains only validated bounded values and makes neither
   the projection nor its path available to children. An ordinary non-Enterprise
   Session has no Enterprise snapshot requirement.
3. RunnerContext is created from the immutable launch snapshot plus non-authoritative
   transport env vars:
     SESSION_ID, WORKSPACE_PATH, BACKEND_API_URL, ...
4. For a repository payload, inspect every effective MCP configuration in the
   already-cloned repository before importing or constructing a bridge or MCP
   implementation. A reserved-name collision terminalizes the committed Session
   and triggers exact-Session cleanup without launching a child.
5. main.py selects and constructs the exact bridge from the validated context,
   calls run_ambient_app(bridge), and then bridge.set_context(context).
6. uvicorn starts; FastAPI lifespan() runs.
7. If AMBIENT_GRPC_ENABLED=true:
     a. AmbientGRPCClient.from_env() called:
          - Direct/Operator → exchange current pod-bound identity plus exact-Session refresh at CP /token
          - Gateway → send the fixed runtime-only request through Providers v2; no refresh or identity carrier
          - set_bot_token(token) — wires into get_bot_token() for all HTTP calls
          - Build gRPC channel with token
     b. Pre-register SSE queue for SESSION_ID (prevents race with backend)
     c. Select startup state, with resume taking precedence:
          - IS_RESUME=true: all fresh selectors, prompts, and ensure capability MUST be absent;
            obtain the Session-scoped service token through the mode-appropriate exchange and open
            WatchSessionMessages after RESUME_AFTER_SEQ; Gateway still receives no refresh carrier.
          - Fresh with positive INITIAL_BOOTSTRAP_SEQ=B: do not publish fallback;
            obtain the service token through the mode-appropriate exchange, then open
            WatchSessionMessages after B - 1. Gateway/control-plane starts always use this
            path after CP has sealed any non-empty compatibility bootstrap.
          - Operator/CreateSession fallback with INITIAL_BOOTSTRAP_FALLBACK_ALLOWED=true:
            require no B or history-empty proof, read the non-empty compatibility input from
            /tmp/initial_prompt.txt, falling back to INITIAL_PROMPT on OS read error;
            require AMBIENT_SESSION_CAPABILITY and AMBIENT_CAPABILITY_REFRESH_CREDENTIAL;
            synchronously conditionally ensure PushSessionMessage("bootstrap", prompt).
            The API atomically revalidates exact Runner identity and signed fallback capability,
            phase Pending/Creating, absent start_time, and absent sdk_session_id.
            At most two total identical ensure requests are allowed: the second only after an
            indeterminate acknowledgement, with finite per-attempt and overall deadlines and
            no nested transport retry. Require the existing/new positive sequence F, then open
            WatchSessionMessages after F - 1.
          - INITIAL_HISTORY_EMPTY=true: require literal true, mode-appropriate service exchange, and no B,
            resume, fallback permission, prompt, or ensure capability; obtain the exact-Session
            service token, open WatchSessionMessages after 0, and wait for a human turn.
          - Every other combination, including a prompt without explicit fallback permission,
            is invalid and MUST fail before watch/readiness.
     d. await listener.ready.wait()  ← blocks until selected stream confirmed open

8. A definitive application failure, conflicting payload, multiple rows, invalid sequence,
   mismatched/malformed response, capability failure, ineligible phase/origin, or exhausted
   acknowledgement-recovery attempt fails closed. The Runner does not change the payload,
   switch to HTTP, open the watch, or report ready. It never infers fallback permission from
   missing B, `Running`, `start_time`, message/pod age, elapsed time, or a time heuristic.

9. In non-gRPC compatibility deployments, the existing HTTP/operator startup path is unchanged.

10. Report ready only after the selected message watch is open. That registration opens the
   REST human-message write gate; in Gateway mode the Session may already be `Running` because
   the control plane persists its startup cutoff immediately before `ExecSandbox`.

11. yield (app ready, uvicorn serving on AGUI_HOST:AGUI_PORT)

12. On shutdown: bridge.shutdown() → GRPCSessionListener.stop()
```

### First-Run Platform Setup (deferred, on first `bridge.run()` call)

```
bridge._setup_platform():
  1. validate_prerequisites(context)         ← phase-based slash command gating
  2. setup_sdk_authentication(context)       ← Vertex AI or Anthropic API key
  3. populate_runtime_credentials(context)   ← GitHub, GitLab, Google, Jira from backend
  4. resolve_workspace_paths(context)        ← CWD: workflow / multi-repo / artifacts
  5. setup_workspace(context)                ← log workspace state
  6. ObservabilityManager init               ← Langfuse (best-effort, no-op on failure)
  6a. MLflow autologging activation           ← if MLFLOW_TRACKING_URI is set and MLFLOW_TRACING_ENABLED is not false:
                                                 mlflow.set_tracking_uri(), mlflow.set_experiment(), mlflow.autolog(...),
                                                 and configured GenAI autolog integrations
                                                 Best-effort: log warning on failure, continue the session
  7. build_mcp_servers(context, cwd_path)    ← external + platform MCP servers
  8. build_sdk_system_prompt(...)            ← preset + workspace context string
```

---

## Token Authentication

**Desired state — exact-Session service/capability exchange:**

The Runner has distinct service and bootstrap authorization artifacts:

| Token | Source | Used for |
|-------|--------|----------|
| **Exact-Session service token** | `POST AMBIENT_CP_TOKEN_URL` over pinned HTTPS after mode-specific authentication | Two-minute RS256 `aud=ambient-api-server`, `purpose=session-runtime` API/gRPC calls for only `SESSION_ID`; never global authority |
| **Ensure capability** | Direct/Operator fallback-only `AMBIENT_SESSION_CAPABILITY` / `x-ambient-session-capability` | Conditional bootstrap ensure for only `SESSION_ID` and `session-bootstrap-ensure`; absent in Gateway |
| **Direct/Operator refresh credential** | `AMBIENT_CAPABILITY_REFRESH_CREDENTIAL` / `x-ambient-capability-refresh` | Direct/Operator CP exchange for a replacement runtime token and, when eligible, ensure capability; absent in Gateway |
| **Gateway workload attestation** | ACP `/oauth2/sandbox-attestation`, requested and injected by OpenShell v0.0.82 Providers v2 | Gateway-mode service authentication to CP only; at most 60 seconds and never visible to Runner |
| **Caller token** | `x-caller-token` header on each run request | Backend HTTP credential fetches (`GET /credentials/{id}/token`) — scoped to the requesting user |

### CP Token Flow

```python
## _grpc_client.py
service_identity = acquire_direct_or_operator_identity_if_required()  # None in Gateway
refresh = direct_or_operator_refresh_if_required()                    # None in Gateway
response = post_to_cp_token_endpoint_over_pinned_https(
    service_identity,
    refresh,
    grant="runtime-only",
    expected_session_id=session_id,  # local response assertion; never serialized
)
set_bot_token(response.exact_session_token)
reject_if(response.ensure_capability is not None)
```

In Gateway mode `post_to_cp_token_endpoint_over_pinned_https` delegates the network operation to the dedicated runtime-auth helper; agent/model children cannot read or execute that helper or reach ACP port 8443.

The client requires TLS 1.2 or newer and forbids redirects, plaintext fallback, and downgrade. Direct/Operator pins ACP serving CA and exact service DNS. Gateway validates the OpenShell per-Sandbox proxy CA presented on the intercepted connection; the supervisor separately pins ACP serving CA and exact upstream DNS. The client caps request/response sizes, enforces a five-second deadline, and requires `Cache-Control: no-store`. The wire JSON contains only `grant`; `expected_session_id` is local and never serialized. Direct/Operator presents the current projected token plus signed refresh. Gateway sends HTTPS HTTP/1.1 `POST /token` through the exact Providers v2 binding; Runner handles only the runtime-only body, while the proxy injects the ACP bearer attestation. Gateway Runner sends no refresh, Authorization, Session selector, workload mode, origin, audience, or ensure request. CP repeats live Sandbox/Pod/ServiceAccount/owner/session/generation/deletion validation and returns no cross-Session or global bearer. `get_bot_token()` uses only the returned exact-Session token; a `BOT_TOKEN` fallback SHALL NOT bypass this contract.

On gRPC `UNAUTHENTICATED` or reconnect, the listener repeats HTTPS HTTP/1.1 `/token` and atomically replaces only the returned runtime credential. Providers v2 does not inject into h2 or gRPC; the channel authenticates only with the returned token. Only eligible Direct/Operator fallback may request `runtime-and-bootstrap-ensure` within signed scope. Gateway, resume, authoritative-bootstrap, history-empty, and ordinary reconnect cannot request or retain ensure authority. Wrong/expired/revoked Direct/Operator refresh, invalid/expired Gateway attestation, live-binding mismatch, cross-mode credential, or global-token response fails closed without opening or resuming the stream.

### Supervisor-Only Credential Handling

At process start, the Runner supervisor SHALL ingest Direct/Operator projected-identity, service-token, ensure, and refresh artifacts into private memory and remove their environment variables before constructing any bridge, agent SDK/CLI, MCP server, tool, hook, shell, or subprocess. Immediately before every Direct/Operator exchange it rereads the kubelet-rotated token and erases the request copy. In Gateway mode the OpenShell supervisor sidecar, not Runner, owns the SPIFFE Workload API socket, requests the JWT-SVID, performs RFC 7523 `/oauth2/sandbox-attestation`, caches the returned attestation for no more than 30 seconds, and injects it into exact HTTPS HTTP/1.1 `/token` traffic. Gateway Runner cannot read the socket, projected token, OpenShell gateway JWT, JWT-SVID, SPIFFE private key, injected attestation, refresh credential, or ensure capability. Child environments use an explicit allowlist and exclude all authorization artifacts. No HMAC secret, JWT verification ring, asymmetric private key, SPIFFE key, or per-Session mTLS key may exist in Runner. Public trust is limited to ACP serving CA in Direct/Operator or the per-Sandbox proxy CA in Gateway; the supervisor separately holds ACP upstream trust. JWT verification occurs at CP or API.

The Runner SHALL value-redact current and superseded artifacts from logs, trace attributes, exceptions, HTTP/gRPC metadata diagnostics, status, prompts, config files, SessionMessages, screenshots, and retained evidence. Refresh atomically replaces private values and erases superseded copies. The agent/model and model-invoked code never receive either capability, the refresh credential, a service token, HMAC key, or RSA key.

### AGUI_TOKEN Session Authentication

When the `AGUI_TOKEN` env var is set (injected by the Operator), the runner registers an HTTP middleware that requires all non-health requests to include an `X-Ambient-Session-Token` header matching the token. Comparison uses `secrets.compare_digest()` to prevent timing attacks.

This prevents cross-session attacks where an attacker who discovers a runner's in-cluster URL could send requests to another session's runner. Health endpoints (`/health`, `/healthz`) are exempted so liveness/readiness probes continue to work.

---

## Bridge Layer

`PlatformBridge` (bridge.py) defines the integration contract:

| Method | Required | Purpose |
|--------|----------|---------|
| `capabilities()` | yes | Declare feature support to `/capabilities` endpoint |
| `run(input_data)` | yes | Async generator — execute one turn, yield AG-UI events |
| `interrupt(thread_id)` | yes | Halt the active run for a thread |
| `set_context(ctx)` | no | Receive `RunnerContext` before first run |
| `_setup_platform()` | no | Deferred first-run initialization |
| `shutdown()` | no | Graceful teardown |
| `mark_dirty()` | no | Force full re-setup on next run |
| `start_grpc_listener(url)` | yes for persistent Sessions | Start the generic pod-lifetime Session-message listener and readiness gate |
| `inject_message(msg)` | yes for persistent Sessions | gRPC path — listener injects parsed `RunnerInput` |

`ClaudeBridge` and `GeminiCLIBridge` are supported persistent implementations. `LangGraphBridge` remains an alternate implementation using the same ABC and MUST fail capability validation when a requested lifecycle is unsupported.

---

## Claude Bridge Internals

### Session Isolation

Each `thread_id` (= session ID) gets one `SessionWorker`. The worker owns a single `ClaudeSDKClient` in a background `asyncio.Task` with a long-running stdin/stdout connection to the Claude Code subprocess.

```
SessionManager
  └── SessionWorker(thread_id)
        ├── _client: ClaudeSDKClient  ← Claude subprocess connection
        ├── _active_output_queue      ← yields events during a turn
        └── _between_run_queue        ← background messages between turns
```

`SessionWorker.query(prompt, session_id)` enqueues the request and yields SDK messages until the `None` sentinel. Worker death is detected on the next `query()` call — dead workers are replaced automatically.

`SessionManager` persists `thread_id → sdk_session_id` to `{state_dir}/claude_session_ids.json` on every new session. This enables `--resume` on pod restart.

### Per-Turn Lifecycle

```
bridge.run(input_data):
  1. _initialize_run(): set user context, refresh credentials if stale
  2. session_manager.get_or_create_worker(thread_id)
  3. worker.acquire_lock()                            ← prevent concurrent turns
  4. worker.query(prompt, session_id)
  5. wrap stream: tracing_middleware → secret_redaction_middleware
  6. yield events
  7. Detect HITL halt: _halted_by_thread[thread_id] = True → interrupt worker
```

For ordinary Sessions, credentials are populated before step 1 and persist
across turns within the same pod lifetime; credential isolation is enforced by
sidecar containers, not by per-turn cleanup. Enterprise Agent inference uses no
Runner credential population and remains supervisor-proxy-only.

### Adapter Rebuild (`mark_dirty()`)

`mark_dirty()` is called when the MCP configuration changes (e.g. different user context). It:
1. Snapshots all `thread_id → sdk_session_id` mappings
2. Tears down the existing `SessionManager` (async, non-blocking)
3. Clears `_adapter` and `_ready` → next `run()` triggers full `_setup_platform()`
4. Restores saved session IDs after rebuild so `--resume` still works

---

## gRPC Transport Layer

### `GRPCSessionListener` (pod-lifetime)

```
WatchSessionMessages(session_id, last_seq)
    │
    │  [thread pool — blocking gRPC iterator]
    │
    ▼
  asyncio bridge (run_coroutine_threadsafe)
    │
    │  expected event_type == "bootstrap" at bootstrap_seq
    ├──► claim seq + initial-run guard → parse RunnerInput → bridge.run()
    │         │
    │         ├──► _active_streams[thread_id].put_nowait(event)   ← SSE tap
    │         └──► GRPCMessageWriter.consume(event)               ← durable record
    │
    │  later event_type == "user"
    ├──► parse human turn → bridge.run()
    │
    │  duplicate/mismatched bootstrap
    └──► fail closed without another model invocation
```

- Sets `self.ready` asyncio.Event once the stream is confirmed open
- Reconnects with exponential backoff (1s → 30s) on stream failure
- On `UNAUTHENTICATED`: calls `grpc_client.reconnect()` before retry
- For a fresh authoritative sequence `B`, requires the first executable row at `B`; rows below `B`, including the separately displayed human task, are startup history only
- Claims `B` in `last_seq` and an in-memory initial-run guard before invoking `bridge.run()`; reconnect before receipt uses `B - 1`, while reconnect after acceptance uses `B`
- Treats `user` as a run trigger only for later human turns with sequence greater than the accepted bootstrap; on a genuinely empty startup, the first human row after watch cursor `0` is the first run
- Never executes or reclassifies a legacy startup-context row encoded as `user`; those rows remain history below the newly ensured bootstrap cursor
- Rejects invalid sequence, wrong Session, wrong type/payload, a gap before the expected bootstrap, or any unexpected second bootstrap without invoking the model for that row
- On session restart, `IS_RESUME` forbids bootstrap publication and execution; `RESUME_AFTER_SEQ` initializes `last_seq` and skips all historical messages

### Delivery Guarantee and Crash Boundary

The sequence handoff and in-memory guard provide one initial model invocation during uninterrupted processing and ordinary gRPC reconnects. `bootstrap_seq - 1` is a replay cursor, not a durable processing acknowledgement. There is no transaction spanning SessionMessage acceptance, model or external effects, and assistant persistence. A process or pod crash after bootstrap acceptance can lose the run or leave partial effects; a crash after effects but before durable completion cannot be distinguished from an unfinished run. Crash-proof effect-level exactly-once execution requires a durable consumed-message checkpoint and idempotent run identity and is explicitly out of scope.

### `GRPCMessageWriter` (per-turn)

Accumulates `MESSAGES_SNAPSHOT` events (keeping only the latest — each snapshot is a full replacement). On `RUN_FINISHED` or `RUN_ERROR`, calls:

```python
PushSessionMessage(
    session_id=session_id,
    event_type="assistant",
    payload=assistant_text,   # extracted from last MESSAGES_SNAPSHOT
)
```

Push is synchronous gRPC; runs in a `ThreadPoolExecutor` to avoid blocking the event loop.

**Payload contract:**
- `event_type=bootstrap`: plain string (trusted platform-composed initial model input)
- `event_type=user`: plain string (a human-authored task or later turn)
- `event_type=assistant`: plain string (Claude's reply text only — no reasoning, no user echo)

---

## SSE Tap: `GET /events/{thread_id}`

The SSE tap endpoint in `endpoints/events.py` is a pure observer. It never calls `bridge.run()`.

```
Sequence:
  1. Backend registers GET /events/{thread_id} (before POST /sessions/{id}/messages)
  2. endpoints/events.py registers asyncio.Queue in bridge._active_streams[thread_id]
  3. User POST /sessions/{id}/messages → PushSessionMessage("user", text)
  4. GRPCSessionListener receives its own push → bridge.run()
  5. bridge.run() yields events → put_nowait into _active_streams[thread_id]
  6. GET /events stream reads from queue → SSE to client
  7. On RUN_FINISHED or RUN_ERROR: close stream
```

- Queue size: 100 (events dropped silently if consumer is slow)
- Heartbeat: `: keepalive` comment every 30s
- `MESSAGES_SNAPSHOT` events are filtered out (internal accumulator state, not for clients)
- Queue is removed from `_active_streams` on client disconnect or run end

---

## Credential Management

Integration credentials are **isolated in sidecar containers**. The runner container
has no integration tokens in its environment or filesystem. Each credential-bearing
MCP sidecar holds only its own credentials and exposes tools via SSE on a localhost
port.

For ordinary direct-mode Sessions only, LLM provider credentials such as an
Anthropic API key or Vertex AI service account may remain in the Runner container
under the legacy contract.

The Enterprise Assistant managed Vertex Credential is excluded from that legacy
rule. Its key, access tokens, provider capability, and renewal material SHALL
remain in the OpenShell supervisor-private proxy and SHALL never enter Runner,
Agent, model, MCP configuration, environment, files, arguments, logs, or retained
evidence. The Runner consumes only the immutable snapshot's non-secret provider
context and local inference route.

### Sidecar Credential Flow

```
CP resolves CREDENTIAL_IDS for the Project
  → For each bound credential:
      CP adds a sidecar container to the pod spec
      Sidecar environment contains only its own credential
      Sidecar exposes MCP tools on localhost:{port}/sse
  → Runner connects to sidecars as SSE MCP clients
  → Agent calls MCP tools — never sees raw tokens
```

Credential sidecars manage their own token refresh cycles. The `refresh_credentials`
MCP tool (registered under the `session` MCP server) signals sidecars to re-fetch
tokens from the backend API. Rate-limited to once per 30 seconds.

The credential-free fallback: Projects with no bound credentials get no credential
sidecars. The runner operates without integration credentials.

### Git Operations

The runner container has no git credential helper and no GitHub/GitLab tokens.
Git write operations use MCP tools exclusively:

- **Push commits**: `github-mcp` → `PushFiles` tool (commits and pushes via GitHub API)
- **Create PRs**: `github-mcp` → `CreatePullRequest` tool
- **Clone repos**: Init container (runs before the agent, credential-isolated)

Direct `git push` and `gh pr create` from the runner container are not supported
— they require tokens in the runner environment, which violates the isolation
model. System prompts instruct the agent to use MCP tools for all git write
operations. See the [MCP server spec](#mcp-servers) for
sidecar details.

---

## MCP Servers

The runner assembles the full MCP server configuration at setup time. Claude sees these servers as tools:

The server name `managed-memory` is reserved to the platform. Before committing a
Session, Agent Start SHALL collect and parse every MCP candidate source available
without provisioning: baked `mcp.json`, inline payload
`PAYLOAD_MCP_CONFIG_FILE`, external user configuration, bridge additions,
in-process tools, and other Runner-generated entries. Parsing SHALL reject
duplicate JSON members, malformed or oversized objects, and every occurrence of
`managed-memory`. A collision in any source available at this gate SHALL reject
Agent Start before a Session, lease, provider, proxy, sandbox, or workload exists.

Repository MCP content that is knowable only after clone SHALL be inspected after
the Session and immutable snapshot commit but before any MCP merge, candidate
server, bridge, or Agent/model process is constructed. The same validation SHALL
run before every `mark_dirty()` rebuild. A repository collision SHALL mark the
existing Session terminal `Failed`, revoke its lease and exact-Session provider,
stop and remove its proxy, and idempotently clean the sandbox and payload. Source
order, later precedence, equality with the expected entry, and platform policy
text SHALL never permit replacement, shadowing, extension, or merge.

Only after every candidate source passes validation MAY the Runner add exactly
one platform-owned `managed-memory` entry, and only when the immutable Enterprise
Agent launch snapshot enables memory and OpenShell has supplied the exact local
proxy connection. The entry SHALL contain no capability, attachment, identity,
provider endpoint, audience, or renewal material. OpenShell, not Runner, owns
capability acquisition and renewal. A memory-disabled or ordinary Session SHALL
receive no managed-memory entry or memory-specific prompt.

The control plane SHALL reject every precommit-visible collision before Session
creation. Only a collision in repository content that was unavailable until the
post-commit clone uses the terminalize-and-clean path; it SHALL not be reported as
if no Session row committed.

| Server | Transport | Tools | Source |
|--------|-----------|-------|--------|
| External (`.mcp.json`) | stdio / SSE | whatever the server exposes | user config |
| `ambient` | SSE (`AMBIENT_MCP_URL`) | 16 platform tools (sessions, agents, projects) | CP-injected sidecar |
| `github-mcp` | SSE (`:8091`) | GitHub API tools (repos, issues, PRs, actions) | CP-injected sidecar, only if `github` credential bound |
| `jira-mcp` | SSE (`:8092`) | Jira API tools (issues, search, transitions) | CP-injected sidecar, only if `jira` credential bound |
| `k8s-mcp` | SSE (`:8093`) | Kubernetes tools (kubectl via MCP) | CP-injected sidecar, only if `kubeconfig` credential bound |
| `google-mcp` | SSE (`:8094`) | Google Workspace tools (Gmail, Drive) | CP-injected sidecar, only if `google` credential bound |
| `session` | in-process | `refresh_credentials` | always registered |
| `rubric` | in-process | `evaluate_rubric` | registered if `.ambient/rubric.md` found |
| `corrections` | in-process | `log_correction` | always registered |
| `managed-memory` | local OpenShell proxy | snapshot-enabled managed memory tools | platform-owned, only for an exact memory-enabled Enterprise Agent Session |

#### Scenario: Precommit-visible collision rejects Agent Start

- GIVEN a baked, inline payload, external, bridge, in-process, or generated
  MCP candidate defines `managed-memory`
- WHEN Agent Start validates sources available without provisioning
- THEN Agent Start fails before committing a Session or creating a lease,
  provider, proxy, sandbox, or workload

#### Scenario: Repository collision terminalizes the committed Session

- GIVEN Agent Start committed a Session and immutable snapshot
- WHEN repository content knowable only after clone defines `managed-memory`
  during initial assembly or a later adapter rebuild
- THEN the Runner rejects the complete assembly before launching any candidate
  server, bridge, or Agent/model process
- AND the existing Session becomes terminal `Failed`
- AND its lease, exact-Session provider, proxy, sandbox, and payload are revoked
  or removed idempotently

#### Scenario: Platform entry comes only from the launch snapshot

- GIVEN the immutable launch snapshot enables managed memory and OpenShell has
  created the exact Session-local proxy
- WHEN all untrusted MCP candidates pass collision validation
- THEN Runner adds one local `managed-memory` entry
- AND the Agent receives no capability, attachment selector, endpoint selector,
  or renewal authority

### Migration: `acp` In-Process MCP Server Removed

The previous `acp` in-process MCP server (9 tools: `acp_list_sessions`,
`acp_get_session`, `acp_create_session`, `acp_stop_session`, `acp_send_message`,
`acp_get_session_status`, `acp_restart_session`, `acp_list_workflows`,
`acp_get_api_reference`) is replaced by the `ambient` SSE sidecar on `:8090`.

The `ambient-mcp` sidecar exposes the same platform tools (sessions, agents,
projects) via the MCP protocol over SSE. Tool names change from `acp_*` prefix
to unprefixed (`list_sessions`, `get_session`, etc.). Existing agent prompts
referencing `acp_*` tool names must be updated.

---

## System Prompt Construction

For ordinary Claude Sessions, the system prompt is assembled once during
`_setup_platform()` and passed to the Claude SDK:

```python
{
  "type": "preset",
  "preset": "claude_code",
  "append": f"{DEFAULT_AGENT_PREAMBLE}\n\n{workspace_context}"
}
```

`DEFAULT_AGENT_PREAMBLE` establishes Ambient platform identity and behavioral guidelines.

`workspace_context` is built by `build_workspace_context_prompt()` and includes:
- Fixed workspace paths (`/workspace/artifacts`, `/workspace/file-uploads`)
- Active workflow CWD and name
- List of uploaded files
- Repository list with URLs and branches
- Git push instructions (for auto-push repos)
- HITL interrupt instructions
- MCP integration-specific instructions (Google, Jira, GitLab, GitHub)
- Token presence hints
- Workflow-specific system prompt (from `ambient.json` `systemPrompt` field)
- Rubric evaluation section (if `rubric.md` found)
- Corrections feedback instructions

This ordinary construction path SHALL NOT run for a provenanced Enterprise Agent
Session. Its Gemini bridge receives only byte-identical snapshot
`system_instructions` through the privileged system channel and separately
receives snapshot `user_instruction_context` through the lower-priority user
context channel. `DEFAULT_AGENT_PREAMBLE`, workspace context, generic
`Agent.prompt`, bootstrap composition, MCP additions, payloads, and repository
content SHALL NOT alter or wrap the Enterprise system bytes.

---

## Environment Variables

All env vars are injected by the CP at pod creation time. The bootstrap selectors and capability/refresh rows below are desired state pending Todo11 implementation.

| Var | Purpose |
|-----|---------|
| `SESSION_ID` | Primary session identifier; also the `thread_id` for AG-UI |
| `PROJECT_NAME` | Project context |
| `WORKSPACE_PATH` | Claude Code working directory root (`/workspace`) |
| `AGUI_HOST` / `AGUI_PORT` | Runner HTTP listener (default `0.0.0.0:8001`) |
| `BACKEND_API_URL` | api-server base URL (cluster-local) |
| `AMBIENT_GRPC_URL` | api-server gRPC address |
| `AMBIENT_GRPC_USE_TLS` | TLS flag for gRPC channel |
| `AMBIENT_CP_TOKEN_URL` | Exact HTTPS CP endpoint (e.g. `https://ambient-control-plane.{ns}.svc:8443/token`); POST only, with no redirect/plaintext/downgrade fallback |
| `AMBIENT_CP_CA_PATH` | Direct/Operator ACP serving CA or Gateway per-Sandbox proxy CA; Gateway supervisor separately pins ACP serving CA upstream |
| `AMBIENT_WORKLOAD_IDENTITY_PATH` | Direct/Operator-only supervisor path to the fixed `ambient-control-plane-tokenserver` projected identity. Gateway receives no identity path, SPIFFE socket, JWT-SVID, private key, or ACP attestation |
| `AMBIENT_GRPC_ENABLED` | Enables gRPC listener path (default: `true` when `AMBIENT_GRPC_URL` set) |
| `INITIAL_BOOTSTRAP_SEQ` | Positive authoritative bootstrap SessionMessage sequence for a fresh start; watch begins at this value minus one |
| `INITIAL_HISTORY_EMPTY` | Literal `true` proof from one valid metadata snapshot plus successful empty context assembly; permits watch from zero only when all other fresh selectors/prompts are absent |
| `INITIAL_BOOTSTRAP_FALLBACK_ALLOWED` | Literal `true` from trusted operator/CreateSession launch configuration; valid only with exact-Session signed capability and API revalidation of `Pending`/`Creating`, no `start_time`, and no `sdk_session_id` |
| `INITIAL_PROMPT` | Operator/CreateSession fallback payload only; invalid without explicit fallback permission and never published as `user` |
| `AMBIENT_SESSION_CAPABILITY` | Direct/Operator fallback-only HS256 exact-Session `session-bootstrap-ensure` capability; absent in Gateway |
| `AMBIENT_CAPABILITY_REFRESH_CREDENTIAL` | Direct/Operator supervisor-only RS256 exact-Session `session-capability-refresh`; absent in Gateway |
| `IS_RESUME` | Set to `"true"` on pod restart; dominates fresh-start state and forbids bootstrap publication or execution |
| `RESUME_AFTER_SEQ` | Maximum message `seq` from the previous run; gRPC listener starts watching from this seq to skip historical messages |
| `USE_VERTEX` | Ordinary direct-mode only: enable Vertex AI instead of Anthropic; forbidden for Enterprise Agents |
| `ANTHROPIC_VERTEX_PROJECT_ID` / `CLOUD_ML_REGION` | Ordinary direct-mode Vertex configuration; forbidden for Enterprise Agents |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ordinary direct-mode Vertex service account path; forbidden for the Enterprise Assistant managed Credential |
| `LLM_MODEL` / `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | Per-session model config |
| `LLM_MODEL_VERTEX_ID` | Explicit Vertex model ID (overrides static map) |
| `CREDENTIAL_IDS` | JSON map `{provider: id}` for ordinary integrations; excludes the Enterprise Assistant managed Vertex Credential and managed memory |
| `AMBIENT_MCP_URL` | Ambient MCP sidecar URL (SSE transport) |
| `REPOS_JSON` | JSON array of `{url, branch, autoPush}` repo configs |
| `ACTIVE_WORKFLOW_GIT_URL` | Active workflow repo URL (overrides REPOS_JSON workspace setup) |
| `SESSION_CONFIG_PATH` | Existing absolute path to a mounted session-config harness repo; appended to Claude SDK `add_dirs` and enables SDK skills |
| `AGUI_TOKEN` | Session-scoped bearer token; when set, all non-health endpoints require `X-Ambient-Session-Token` header (constant-time comparison) |
| `PAYLOAD_MCP_CONFIG_FILE` | Path to payload `.mcp.json` (default `/sandbox/.mcp.json`); validated as an untrusted MCP candidate before ordinary-name merge |
| `SESSION_LAUNCH_SNAPSHOT_PATH` | Enterprise Agent entrypoint only: supervisor-owned read-only projection of the immutable Session launch snapshot; captured, validated, and unset before bridge import/construction, and never inherited by any child/model environment or overridden by payload or repository state |
| `SDK_OPTIONS` | JSON string of additional Claude SDK options |
| `MLFLOW_TRACKING_URI` | MLflow tracking server URL (HTTPS); platform-owned global default from control-plane env |
| `MLFLOW_TRACKING_TOKEN` | MLflow tracking server auth token (secret — must not appear in logs); injected via `mlflow` credential provider |
| `MLFLOW_EXPERIMENT_NAME` | MLflow experiment name for trace logging; global default from control-plane env, overridable per-agent |
| `MLFLOW_CREDENTIAL_SECRET_NAME` | Control-plane-only source secret name for the global MLflow credential; defaults to `mlflow` |
| `MLFLOW_CREDENTIAL_SECRET_NAMESPACE` | Control-plane-only source namespace for the global MLflow credential; defaults to the control-plane runtime namespace |
| `MLFLOW_TRACING_ENABLED` | Optional kill switch; only `false` / `0` / `no` / `off` disables MLflow when a tracking URI is present |
| `MLFLOW_AUTOLOG_EXCLUDE_FLAVORS` | Optional comma-separated generic MLflow autolog flavor exclusions |
| `MLFLOW_GENAI_AUTOLOG_INTEGRATIONS` | Optional comma-separated provider autolog integrations; default `anthropic,openai` |

---

## Two Message Paths

| Path | Trigger | Fan-out | Persistence |
|------|---------|---------|-------------|
| **gRPC listener** | `WatchSessionMessages` receives the authoritative `bootstrap` or a later human `user` turn | SSE tap queue + `GRPCMessageWriter` | Bootstrap/human input and assistant turn persisted in api-server DB |
| **HTTP POST `/`** | Direct HTTP AG-UI run request | `grpc_push_middleware` fire-and-forget | Each event pushed individually |

The gRPC listener path is the primary path in standard deployment. The HTTP POST path is the backup path and is used in local dev environments without a CP.

---

## Workspace Resolution

`resolve_workspace_paths(context)` determines the Claude working directory:

```
Priority order:
1. ACTIVE_WORKFLOW_GIT_URL set  →  /workspace/workflows/<name>
                                    add_dirs: all repos, artifacts, file-uploads
2. REPOS_JSON set               →  /workspace/<primary_repo>
                                    add_dirs: remaining repos
3. Default                      →  /workspace/artifacts
```

The resolved `(cwd_path, add_dirs)` tuple is passed to the Claude SDK via `ClaudeAgentAdapter`. Claude Code sees `cwd_path` as its working directory and `add_dirs` as additional indexed directories.

If `SESSION_CONFIG_PATH` is set to an existing absolute directory, the runner
SHALL append it to `add_dirs` without replacing `cwd_path`. This supports
Git-backed session-config harness repositories mounted by sandbox payloads:

```yaml
payloads:
  - sandbox_path: /sandbox/session-config
    repo_url: https://github.com/example/team-session-config
    ref: main
environment:
  SESSION_CONFIG_PATH: /sandbox/session-config
```

For Claude sessions, the bridge SHALL also enable SDK skills when
`SESSION_CONFIG_PATH` resolves successfully so skills in the mounted harness can
be discovered and activated by semantic prompt intent.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Bridge ABC over direct Claude dependency | Enables Gemini CLI, LangGraph, and future bridges without changing app or platform layer |
| `SessionWorker` isolates Claude subprocess | Claude SDK uses anyio internally — running it in a background asyncio.Task with queue-based API prevents anyio/asyncio event loop conflicts |
| `_setup_platform()` deferred to first run | App startup must be fast; credential fetching, MCP server loading, and system prompt construction are I/O-heavy and done once per pod lifetime |
| Credentials isolated in sidecar containers | Prevents token exfiltration by the agent via Bash/Read tools; each sidecar holds only its own credential |
| Mode-separated exact-Session exchange | Direct/Operator uses pod-bound TokenReview plus refresh; Gateway uses only Providers v2 SPIFFE attestation. Neither accepts caller-selected Session or global authority, and Gateway has no refresh/ensure carrier |
| Supervisor-private authorization artifacts | Direct/Operator secrets are removed from the environment; Gateway identity and attestation remain exclusively in the OpenShell sidecar. Neither reaches agent, CLI, MCP, tool, hook, or shell subprocesses |
| `GRPCMessageWriter` stores only last `MESSAGES_SNAPSHOT` | Each snapshot is a complete replacement; accumulating all would waste memory for long turns |
| Assistant payload = plain string | Symmetric with user payload; reasoning content is observability data not durable conversation record; payload size reduction is dramatic (reasoning can be 10x longer than reply) |
| Gateway bootstrap sealed by CP | Gateway/control-plane starts never delegate compatibility publication; CP ensures before payload/Running/Exec and Runner receives only the authoritative sequence |
| Runner fallback limited to operator/CreateSession | Trusted launch marker plus signed exact-Session capability prove the lane without a new Session field; API-side phase/start/SDK validation prevents fallback after execution or from time heuristics |
| In-memory bootstrap guard before model invocation | Advancing the accepted sequence before `bridge.run()` prevents ordinary gRPC reconnect from invoking the initial run twice during one Runner lifetime |
| Resume never republishes bootstrap | `IS_RESUME` uses `RESUME_AFTER_SEQ` only; startup carriers and `INITIAL_BOOTSTRAP_SEQ` are invalid in resume state |
| `--resume` via persisted session IDs | Claude Code saves state to `.claude/` on graceful subprocess shutdown; session IDs survive `mark_dirty()` rebuilds via JSON file and `_saved_session_ids` snapshot |
| Credential URL validated to cluster-local hostname | Prevents exfiltration of user tokens to external hosts if `BACKEND_API_URL` is tampered with |
| Ordinary direct-mode LLM credentials may remain in Runner | This legacy rule applies only to ordinary non-Enterprise Sessions. Enterprise Assistant Vertex material is supervisor-private and proxy-only. |
| `AGUI_TOKEN` session auth middleware | Prevents cross-session attacks where an attacker uses another session's runner URL; uses `secrets.compare_digest()` for constant-time comparison |
| Runtime model switching via `POST /model` | Available only to ordinary Sessions; provenanced Enterprise Sessions reject generic model mutation because their model is fixed by the immutable launch snapshot. |

---

## OpenShell Sandbox Isolation

> **Status:** Implemented — validated end-to-end on ROSA OpenShift (kernel 5.14+)
> **Companion docs:** `docs/internal/agents/openshell-runner-adaptation.md` (implementation details), `docs/internal/agents/openshell-security-analysis.md` (threat model)
> **Formal requirements:** `specs/security/openshell-sandbox.spec.md`

The runner wraps the Claude Code subprocess inside NVIDIA OpenShell's Supervisor
binary (`openshell-sandbox` v0.0.56), applying five defense-in-depth isolation
layers. The Supervisor operates in **file mode** — policy is provided via local
Rego + YAML files mounted from a ConfigMap. No OpenShell Gateway is required.

### Architecture

```
Runner Pod (FastAPI + uvicorn) — runs UNSANDBOXED
  │
  └── bridge.py sets cli_path = /app/standard-claude-wrapper.sh
        │
        └── Claude Agent SDK spawns wrapper as subprocess
              │
              └── standard-claude-wrapper.sh
                    │
                    └── exec /openshell-sandbox \
                          --policy-rules /etc/openshell/policy.rego \
                          --policy-data /etc/openshell/policy.yaml \
                          -- /usr/local/bin/claude "$@"
                              │
                              ├── fork()
                              │     pre_exec closure (in child, before exec):
                              │       1. setns(CLONE_NEWNET) → enter sandbox network namespace
                              │       2. drop_privileges(setgroups/setgid/setuid → sandbox:sandbox)
                              │       3. harden_child_process(RLIMIT_CORE=0, PR_SET_DUMPABLE=0, PR_SET_NO_NEW_PRIVS=1)
                              │       4. landlock::enforce(restrict_self) → filesystem allowlist
                              │       5. seccomp::apply(bpf_filter) → syscall blocklist
                              │
                              └── exec(/usr/local/bin/claude) ← runs as sandbox user in isolated netns
```

The runner process (FastAPI, gRPC client, credential fetching) runs outside the
sandbox boundary. Only the Claude CLI subprocess is sandboxed. This means the
gRPC client, SSE tap, and health endpoints are unaffected.

### Five Isolation Layers (All Verified Working)

| Layer | Mechanism | Verified Evidence |
|-------|-----------|-------------------|
| **1. Network namespace** | `ip netns add` + veth pair (`10.200.0.1`↔`10.200.0.2`), default route via proxy | `OCSF CONFIG:CREATED [INFO] Network namespace created [ns:sandbox-* host_ip:10.200.0.1 sandbox_ip:10.200.0.2]` |
| **2. TLS proxy (L7)** | HTTP CONNECT proxy at `10.200.0.1:3128`, ephemeral per-sandbox CA, `HTTPS_PROXY`/`SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS` injected | `HTTP/1.1 200 Connection Established` for policy-allowed hosts; `000` (refused) for blocked hosts |
| **3. Landlock LSM** | Filesystem allowlist via `landlock_restrict_self` (12 rules: 8 read-only, 4 read-write) | `OCSF CONFIG:BUILT [INFO] Landlock ruleset built [rules_applied:12 skipped:0]` |
| **4. seccomp-BPF** | Three-layer filter: supervisor prelude → clone3 ENOSYS → main runtime (blocks `ptrace`, `memfd_create`, raw sockets) | `Blocking socket domain via seccomp` (3 domains blocked) |
| **5. OPA policy enforcement** | Per-binary network ACLs via Rego rules; binary identity checked per-request | Allowed endpoints return HTTP status; blocked hosts return connection refused |

### Policy Files

Policy is stored in a ConfigMap (`openshell-policy`) in the CP namespace and
propagated to each runner namespace by the reconciler's `ensureOpenShellPolicy()`.

**Filesystem policy** (`policy.yaml`):

| Access | Paths |
|--------|-------|
| Read-only | `/usr`, `/lib`, `/proc`, `/dev/urandom`, `/app`, `/runner`, `/etc`, `/var/log`, `/home/sandbox` |
| Read-write | `/workspace`, `/tmp`, `/dev/null`, `/app/.claude` |

**Network policy** (`policy.yaml`):

| Policy | Endpoints | Allowed Binaries |
|--------|-----------|-----------------|
| `anthropic-api` | `api.anthropic.com:443`, `statsig.anthropic.com:443` | `claude`, `node`, `curl` |
| `vertex-ai` | `us-east5-aiplatform.googleapis.com:443`, `europe-west1-aiplatform.googleapis.com:443`, `us-central1-aiplatform.googleapis.com:443`, `oauth2.googleapis.com:443` | `claude`, `node`, `curl` |
| `github` | `github.com:443`, `api.github.com:443` | `git`, `gh`, `curl` |
| `npm-registry` | `registry.npmjs.org:443` | `npm`, `node`, `npx` |
| `pypi` | `pypi.org:443`, `files.pythonhosted.org:443` | `pip3`, `python3` |
| `gitlab` | `gitlab.com:443` | `git`, `glab` |
| `atlassian` | `*.atlassian.net:443`, `*.atlassian.com:443`, `auth.atlassian.com:443`, `api.atlassian.com:443` | `/sandbox/.venv/bin/python`, `/sandbox/.venv/bin/python3`, `/sandbox/.uv/python/cpython-*/bin/python*` |

**Rego rules** (`policy.rego`): Official policy from the OpenShell repository
(`package openshell.sandbox`). Evaluates `allow_network`, `network_action`,
`deny_reason`, and `allow_request` based on host, port, binary path, HTTP method,
and canonicalized request path.

### Required Linux Capabilities

The Supervisor needs elevated capabilities for sandbox setup. These are granted
only when `OPENSHELL_ENABLED=true` in the CP config:

| Capability | Required For |
|------------|-------------|
| `NET_ADMIN` | Create network namespace (`ip netns add`), configure veth pair and routing |
| `SYS_ADMIN` | Mount propagation for `/var/run/netns`, `nsenter` for in-namespace commands |
| `SYS_PTRACE` | Process tracing for binary identity verification |
| `SETUID` | `drop_privileges()`: switch from root to `sandbox` user via `setuid` |
| `SETGID` | `drop_privileges()`: switch group via `setgid`/`setgroups` |
| `CHOWN` | Set ownership on sandbox directories (`/workspace`, `/tmp`) |
| `DAC_OVERRIDE` | Access directories during privilege transition |

The container also requires:
- `allowPrivilegeEscalation: true` (needed for `setuid`/`setns` in the pre_exec closure)
- `runAsUser: 0` (Supervisor must start as root to set up netns and drop privileges)
- `seccompProfile: Unconfined` at the pod level (Supervisor applies its own seccomp filter)

### OpenShift SCC

On OpenShift clusters, a custom SecurityContextConstraints object (`openshell-sandbox`)
MUST be created and bound to the runner service account. The SCC allows the seven
capabilities listed above, `allowPrivilegeEscalation: true`, `runAsUser: RunAsAny`,
and all seccomp profiles.

### Control Plane Integration

The CP reconciler (`kube_reconciler.go`) conditionally enables OpenShell via the
`OPENSHELL_ENABLED` environment variable:

| CP Config | Env Var | Default | Purpose |
|-----------|---------|---------|---------|
| `OpenShellEnabled` | `OPENSHELL_ENABLED` | `false` | Master toggle for sandbox isolation |
| `OpenShellPolicyName` | `OPENSHELL_POLICY_CONFIGMAP` | `openshell-policy` | ConfigMap name for policy files |

When enabled, the reconciler:
1. Copies the policy ConfigMap from the CP namespace to the runner namespace (`ensureOpenShellPolicy`)
2. Adds the policy ConfigMap as a volume + mount at `/etc/openshell`
3. Injects `OPENSHELL_ENABLED=true`, `OPENSHELL_POLICY_RULES`, `OPENSHELL_POLICY_DATA` env vars
4. Overrides the runner security context with elevated capabilities and root UID
5. Sets pod-level seccomp profile to `Unconfined`

### Gateway Mode (OpenShell Gateway)

When `OPENSHELL_USE_GATEWAY=true`, the runner operates inside an OpenShell gateway-managed sandbox instead of a file-mode sandbox. The runner image is built from `Dockerfile.openshell` and uses a separate image (`OPENSHELL_RUNNER_IMAGE`, default `quay.io/ambient_code/acp_runner_openshell:latest`).

Key differences from file mode:

| Aspect | File Mode | Gateway Mode |
|--------|-----------|--------------|
| Image | `Dockerfile` (`RUNNER_IMAGE`) | `Dockerfile.openshell` (`OPENSHELL_RUNNER_IMAGE`) |
| Runner path | `/app/ambient-runner` | `/runner/ambient-runner` |
| Process start | Container `CMD` | `ExecSandbox` gRPC after sandbox reaches Ready |
| Credentials | Sidecar containers | Gateway providers (egress proxy injection) |
| Sandbox isolation | In-container Supervisor (file mode) | Gateway-managed Supervisor |
| Inference routing | Runner env vars (`USE_VERTEX`, `CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_VERTEX_PROJECT_ID`) | Gateway `SetClusterInference` + `providers_v2_enabled` setting; `USE_VERTEX` and `CLAUDE_CODE_USE_VERTEX` are NOT set |

#### Inference Configuration

In gateway mode, the control plane configures the gateway's [inference routing](https://docs.nvidia.com/openshell/sandboxes/inference-routing) after creating credential providers. The gateway exposes an `inference.local` HTTPS endpoint inside each sandbox that strips sandbox credentials, injects backend credentials, and forwards requests to the configured LLM provider.

Before configuring providers or inference, the control plane verifies and pins the latest stable supported release, OpenShell v0.0.82, and enables `providers_v2_enabled=true` on the gateway via `UpdateConfig`. Older or unverified versions fail Gateway startup because the runtime-authentication contract depends on the released SPIFFE `token_grant` behavior. For an ordinary Session, the control plane then iterates authorized bound credentials and configures inference routing for every inference-capable provider type (e.g., `google-vertex-ai`, `claude`, `anthropic`, `nvidia`, `openai`, `aws-bedrock`). For each qualifying provider, it calls `SetClusterInference` with `provider_name`, `model_id` (derived from `session.LlmModel`, defaulting to `claude-sonnet-4-6`), and `no_verify=true`.

For a provenanced Enterprise Agent Session, that generic iteration and
project-provider fanout are forbidden. The control plane SHALL use only the
immutable snapshot's exact logical Provider `enterprise-agent-default`, validate
that it resolves through the one Agent-specific `credential:consumer` entitlement
to the designated managed `vertex` Credential, and create only its unguessable
exact-Session private provider. Any additional inference Provider, hierarchical
fallback result, project-scoped provider, global provider, duplicate Vertex
mapping, or mismatch SHALL terminalize the committed Session before Runner or
model execution and clean partial exact-Session authority.

The gateway's privacy router uses these settings to route inference requests
through the configured provider, injecting credentials transparently. For an
ordinary gateway Session, the control plane sets
`ACP_OPENSHELL_INFERENCE=true` for every authorized provider type, not only
Vertex. For an Enterprise Agent Session, it sets inference routing only for the
one exact-Session managed Vertex provider; no other provider is configured or
attached. The control plane does NOT set `USE_VERTEX`,
`CLAUDE_CODE_USE_VERTEX`, or `ANTHROPIC_VERTEX_PROJECT_ID` in any gateway sandbox
environment. Per the [OpenShell Vertex AI docs](https://docs.nvidia.com/openshell/providers/google-vertex-ai),
those flags cause direct credential discovery and bypass the gateway proxy.

See `openshell-sandbox-provisioning.spec.md` § Inference Configuration via SetClusterInference and § Providers V2 Enablement for the full requirements.

#### Runner-Side Inference Routing (`ACP_OPENSHELL_INFERENCE`)

For an ordinary Claude gateway Session, when the control plane sets
`ACP_OPENSHELL_INFERENCE=true`, the Runner's `setup_sdk_authentication()`
(`bridges/claude/auth.py`) activates inference routing mode instead of direct
Vertex AI or Anthropic API-key authentication. Enterprise Gemini Sessions use
their exact managed proxy route and do not enter this Claude authentication path.

In inference routing mode, the runner sets:

| Env Var | Value | Purpose |
|---------|-------|---------|
| `ANTHROPIC_API_KEY` | `"inference-routing"` | Placeholder — Claude SDK requires a non-empty key |
| `ANTHROPIC_BASE_URL` | `https://inference.local` | Virtual hostname intercepted by the supervisor proxy |
| `HTTPS_PROXY` | `http://10.200.0.1:3128` | Route all HTTPS through the supervisor's CONNECT proxy |
| `SSL_CERT_FILE` | `/etc/openshell-tls/openshell-ca.pem` | Trust the sandbox's ephemeral CA (Python `ssl` module) |
| `REQUESTS_CA_BUNDLE` | `/etc/openshell-tls/openshell-ca.pem` | Trust the sandbox's ephemeral CA (`requests` library) |
| `NODE_EXTRA_CA_CERTS` | `/etc/openshell-tls/openshell-ca.pem` | Trust the sandbox's ephemeral CA (Node.js / Claude Code CLI) |

The runner also clears `USE_VERTEX` and `CLAUDE_CODE_USE_VERTEX` — inference routing replaces direct Vertex API access with the proxy-mediated path. The model is set from `LLM_MODEL` env var or defaults to `claude-sonnet-4-6`.

`inference.local` has no DNS entry. The supervisor proxy intercepts the CONNECT request by hostname and routes it to the upstream inference provider configured via `UpdateConfig`. The proxy terminates TLS using the sandbox's ephemeral self-signed CA.

#### Sandbox Network Namespace and Proxy Routing

In gateway mode, the runner process runs inside a sandbox network namespace with no direct route to cluster IPs or DNS. All traffic MUST traverse the supervisor's HTTP CONNECT proxy at `10.200.0.1:3128`.

**Critical constraint — `NO_PROXY`:** The control plane sets `NO_PROXY=127.0.0.1,localhost` for gateway-mode sandboxes. `NO_PROXY` MUST NOT include `.svc.cluster.local` or any cluster-internal domain suffix. If it does, the runner's HTTP/gRPC clients will attempt direct connections to cluster services that fail because the sandbox namespace has no route to those IPs. This is different from non-gateway modes where the pod has direct cluster connectivity.

**Automatic proxy/TLS injection:** The supervisor's SSH path (used by `ExecSandbox`) calls `env_clear()` on the child process and rebuilds the environment from:
- `child_env::proxy_env_vars()` — 9 vars: `ALL_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, lowercase variants, `grpc_proxy`, `NODE_USE_ENV_PROXY=1`
- `child_env::tls_env_vars()` — 6 vars: `NODE_EXTRA_CA_CERTS`, `DENO_CERT`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`
- `user_environment` from the `CreateSandboxRequest`

The runner does not need to set proxy or TLS CA vars for general cluster traffic — the supervisor handles this. The runner only sets inference-specific vars (`ANTHROPIC_BASE_URL`, `HTTPS_PROXY` for inference.local routing) via `setup_sdk_authentication()`.

#### OPA Network Policy for ACP Internal Traffic

The sandbox's OPA network policy MUST separate `_acp_token_exchange` from `_acp_api`. Only the dedicated non-agent-visible runtime-auth helper may reach the control plane on 8443; Runner Python may reach API-server ports 8000/9000 but MUST be denied the CP token endpoint. Without these rules, the supervisor proxy denies cluster-internal traffic with `DENIED FORWARD`.

The control plane additively reconciles `_acp_token_exchange` and `_acp_api` after sandbox creation using OpenShell `UpdateConfig` merge operations, preserving all unrelated default-policy rules. The token rule contains only the configured exact CP DNS name, port 8443, and helper process; the API rule contains only the exact API DNS name, required ports, and Runner processes. This token isolation is a non-overridable platform minimum: CP reads back the effective policy and blocks startup if a tenant rule or wildcard also exposes CP port 8443. See `agent-sandbox-config.spec.md` and `openshell-sandbox-provisioning.spec.md` for the injection mechanism.

Required endpoints (namespace varies by deployment):

| Host | Port | Purpose |
|------|------|---------|
| `ambient-control-plane.{namespace}.svc[.cluster.local]` | 8443 | Pinned-HTTPS CP token endpoint |
| `ambient-api-server.{namespace}.svc[.cluster.local]` | 8000 | API server HTTP |
| `ambient-api-server.{namespace}.svc[.cluster.local]` | 9000 | API server gRPC |

Allowed binaries: `/sandbox/.venv/bin/python`, `/sandbox/.venv/bin/python3`, `/sandbox/.venv/bin/uvicorn`, `/sandbox/.uv/python/cpython-*/bin/python*`

Both short (`svc`) and fully-qualified (`svc.cluster.local`) hostnames must be listed because the proxy matches on the exact hostname in the CONNECT request.

### Environment Variables (OpenShell-specific)

| Var | Injected By | Purpose |
|-----|-------------|---------|
| `OPENSHELL_ENABLED` | CP reconciler | Enables sandbox wrapper in `bridge.py` |
| `OPENSHELL_POLICY_RULES` | CP reconciler | Path to Rego policy file (`/etc/openshell/policy.rego`) |
| `OPENSHELL_POLICY_DATA` | CP reconciler | Path to YAML policy data (`/etc/openshell/policy.yaml`) |
| `OPENSHELL_LOG_LEVEL` | Wrapper script default | Supervisor log level (`warn` default) |
| `ACP_OPENSHELL_INFERENCE` | CP reconciler (gateway mode) | When `true`, activates runner-side inference routing via `inference.local` proxy instead of direct Vertex/Anthropic API |

### Files Modified

| File | Component | Change |
|------|-----------|--------|
| `Dockerfile` | Runner | Added `openshell-sandbox` v0.0.56 binary, `sandbox` user, `/workspace` dir, `/usr/local/bin/claude` symlink, `iproute` package |
| `standard-claude-wrapper.sh` | Runner | Wrapper script: dispatches to supervisor or direct claude based on `OPENSHELL_ENABLED` |
| `bridges/claude/bridge.py` | Runner | `cli_path = "/app/standard-claude-wrapper.sh"` when OpenShell enabled |
| `.openshell-ref/policy.rego` | Runner | Official OPA Rego policy from OpenShell repository |
| `.openshell-ref/policy.yaml` | Runner | Network + filesystem + process policy data |
| `internal/reconciler/kube_reconciler.go` | Control Plane | `buildRunnerSecurityContext`, `buildVolumes`, `buildVolumeMounts`, `buildEnv`, `ensureOpenShellPolicy` |
| `internal/config/config.go` | Control Plane | `OpenShellEnabled`, `OpenShellPolicyName` config fields |
| `internal/kubeclient/kubeclient.go` | Control Plane | `ConfigMapGVR`, `GetConfigMap`, `CreateConfigMap` methods |
| `cmd/ambient-control-plane/main.go` | Control Plane | Thread OpenShell config into reconciler |

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| `nftables` not installed in runner image | Bypass detection iptables rules not installed; supervisor logs `DEGRADED` warning | Network namespace still enforces proxy routing via default route; add `nftables` package to Dockerfile in a future iteration |
| `cgroup pids.max` unlimited | Supervisor warns about missing PID limit | Configure pod resource limits or cgroup constraints at the node level |
| Network namespace cleanup on crash | If the supervisor crashes, leftover netns/veth pairs may cause `Address in use` on next start | Pod restart cleans up; the supervisor's cleanup logic handles most cases |
| Ordinary file-mode credential proxy pattern not yet implemented | An ordinary non-Enterprise Agent may still have LLM credentials in its environment | Enterprise Assistant is excluded and requires the supervisor-private exact-Session proxy path |
| Kernel 5.14+ required for Landlock ABI v2+ | Landlock `restrict_self` with flags requires kernel 6.10+; v0.0.56 uses flags=0 on older kernels | `best_effort` compatibility mode ensures graceful degradation |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| File mode (no Gateway) | Eliminates operational dependency on OpenShell Gateway; policy is static per-deployment and distributed via ConfigMap |
| Wrapper script instead of direct SDK modification | Minimal change surface in bridge.py (1 line); wrapper handles supervisor dispatch vs. direct execution |
| Supervisor v0.0.56 pinned | Reproducible builds; version tested end-to-end on ROSA |
| Root UID for runner when sandbox enabled | Supervisor must create network namespaces and drop privileges to sandbox user; running as non-root prevents netns setup |
| ConfigMap propagation from CP namespace | Runner namespace may not exist when the CP starts; propagation on session provision ensures policy availability |
| `/usr/local/bin/claude` symlink | Claude SDK bundles its CLI at a version-dependent path; symlink provides a stable path for the policy's `binaries` list |

---
