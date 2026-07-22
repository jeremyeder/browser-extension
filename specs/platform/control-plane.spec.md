# Control Plane

**Date:** 2026-03-22
**Last Updated:** 2026-07-14 — defined CP-owned Gateway bootstrap sealing and OpenShell v0.0.82 Providers v2 SPIFFE token-grant authentication
**Status:** Living desired-state contract
**Skill:** `skills/build/full-stack-pipeline/` — wave-based implementation pipeline

---

## Purpose

This specification defines how the Ambient Control Plane converts persisted Session intent into one safely provisioned Runner workload, including authoritative bootstrap selection, failure ordering, and exact-Session credential exchange.

## Requirements

### Requirement: Deterministic Fresh-Session Bootstrap Selection

The control plane SHALL select exactly one authoritative fresh-start state from one validated metadata snapshot. It SHALL require successful context assembly only when evaluating a compatibility prompt or proving empty history; an already-authoritative bootstrap sequence does not depend on those context reads. It MUST complete any Gateway bootstrap ensure before payload delivery, readiness, `Running`, `start_time`, or `ExecSandbox`.

#### Scenario: Seal a Gateway compatibility bootstrap

- GIVEN a fresh Gateway/control-plane Session has zero bootstrap rows and a non-empty compatibility prompt
- WHEN the control plane prepares the workload
- THEN it conditionally ensures the exact payload with exact-Session service authentication and ensure capability
- AND it passes only the returned positive `INITIAL_BOOTSTRAP_SEQ` to the Runner before execution

#### Scenario: Prove genuinely empty history

- GIVEN one valid snapshot reports `bootstrap_count=0`, `max_seq=0`, and empty `bootstrap_seqs`
- AND every applicable context read succeeds and composes an empty prompt for an eligible pre-execution Session
- WHEN the control plane selects startup state
- THEN it sets only `INITIAL_HISTORY_EMPTY=true`
- AND it does not infer emptiness from a query error, missing field, elapsed time, or nonzero history

#### Scenario: Persist terminal startup failure

- GIVEN metadata, context, capability, eligibility, or conditional ensure validation fails
- WHEN the control plane handles the failure
- THEN it persists `Failed`, `completion_time`, and a content-free `BootstrapStartupFailed` condition before execution
- AND a failed terminal patch may retry only that patch while payload delivery and execution remain barred

### Requirement: Bound Runner Workload Identity and Exchange

The control plane SHALL enforce two non-interchangeable workload-authentication modes. Direct/Operator workloads disable automatic ServiceAccount token mounting and use one explicit short-lived pod-bound token for audience `ambient-control-plane-tokenserver`, which ACP TokenReviews together with the exact-Session refresh credential. Gateway workloads use only OpenShell v0.0.82 Providers v2 and SPIFFE `token_grant`: ACP validates the supervisor's RS256 JWT-SVID only at `/oauth2/sandbox-attestation`, returns a 60-second ACP bearer attestation, and the OpenShell HTTP proxy injects it into exact HTTPS HTTP/1.1 `POST /token` without exposing identity material or refresh authority to Runner. Gateway MUST NOT fall back to HMAC workload authentication, TokenReview, an OpenShell gateway JWT, caller-provided bearer, or per-Session mTLS private-key upload.

#### Scenario: Authenticate a runtime-only exchange

- GIVEN a Direct/Operator Runner presents its projected token plus exact-Session refresh credential, or a Gateway request arrives with only a Providers v2-injected ACP attestation over pinned HTTPS
- WHEN the server either TokenReviews and live-validates the Direct/Operator Pod or verifies the Gateway attestation and repeats the live Sandbox UUID, Pod UID, ServiceAccount, controlling owner UID, Session, generation, and deletion-state checks
- THEN a `runtime-only` grant returns only a bounded RS256 `session-runtime` credential for that Session
- AND it returns no global bearer or bootstrap ensure capability

#### Scenario: Reject implicit or mismatched workload identity

- GIVEN automatic token mounting is requested for Direct/Operator, its explicit projection is absent, TokenReview omits the required audience or pod binding, or the refresh Session differs
- WHEN the workload or exchange is reconciled
- THEN the control plane fails closed without falling back to a default-mounted token, caller-selected Session, plaintext endpoint, or prefix match

#### Scenario: Reject cross-mode, cross-audience, or stale-generation replay

- GIVEN a Gateway attestation binds one exact Session, Sandbox UUID and UID, Pod UID, ServiceAccount, owner UID, and active workload generation
- WHEN a caller presents a Direct/Operator token, refresh credential, projected ServiceAccount token, OpenShell gateway JWT, raw SPIFFE JWT-SVID, HMAC token, or client mTLS key in Gateway mode, or presents a prior-generation attestation after live state changed
- THEN the server rejects the exchange as an RFC 8725 audience, origin, or generation mismatch
- AND neither the request body nor provider profile can select, override, or relax the authentication branch, endpoint, audience, scope, or trust domain

## Overview

The Ambient Control Plane (CP) and the Runner are two cooperating runtime components that sit between the api-server and the actual Claude Code execution. Together they implement the execution half of the session lifecycle: provisioning Kubernetes resources, starting Claude, delivering messages in both directions, and persisting the conversation record.

```
User / CLI
    │  REST / gRPC
    ▼
ambient-api-server          ← data model, auth, RBAC, DB
    │  operation-scoped desired-work snapshot + exact hydration
    ▼
ambient-control-plane (CP)  ← K8s provisioner + desired-work reconciler
    │  K8s API + env vars
    ▼
Runner Pod                  ← FastAPI + ClaudeBridge + gRPC client
    │  Claude Agent SDK
    ▼
Claude Code CLI (subprocess)
```

The api-server is the source of truth for all persistent state. The CP and Runner have no databases of their own. They read from the api-server via the Go SDK and write back via `PushSessionMessage` gRPC and `UpdateStatus` REST.

---

## Control Plane (CP)

### What It Is

The CP is a standalone Go service (`ambient-control-plane`) that:

1. **Polls** the fixed operation-scoped desired-work snapshot and hydrates each row through an exact target projection
2. **Provisions** Kubernetes resources for each session (namespace, secret, service account, pod, service)
3. **Resolves** the Session's authoritative bootstrap sequence and supplies a compatibility start-context carrier only when no rich bootstrap has been persisted
4. **Updates** Session phase through generation-fenced `internal:session-status-reconcile`

The CP does not proxy traffic. It does not fan out events. It does not hold any
persistent authority. It is a Kubernetes reconciler driven by the closed
desired-work feed. Generic service-token list/watch/CRUD is forbidden.

### Components

#### `internal/informer/informer.go` — Informer

Polls the fixed `control-plane-desired-work` snapshot, diffs exact
resource/action/generation rows, hydrates Sessions and Projects through their
registered operation-scoped projections, and dispatches buffered events to
reconcilers. A feed row grants no generic read or mutation authority.

#### `internal/reconciler/kube_reconciler.go` — KubeReconciler

Handles `session ADDED` and `session MODIFIED (phase=Pending)` events by provisioning:

1. Namespace (named `{project_id}`)
2. External key references plus exact-Session Runner service/capability artifacts
3. Direct/Operator ServiceAccount with automount disabled plus one explicit short-lived, `ambient-control-plane-tokenserver`-audience projection available only to the Runner supervisor credential boundary; Gateway uses the OpenShell v0.0.82 Providers v2 SPIFFE supervisor-sidecar path and gives Runner no workload identity
4. Pod (runner image + env vars)
5. Service (ClusterIP on port 8001 pointing at the pod)
6. RoleBinding granting `system:image-builder` ClusterRole to `session-{id}-sa` (registry RBAC authorization only; workload credential delivery is separate)

On `phase=Stopping` → calls `deprovisionSession` (deletes pods).
On `DELETED` → calls `cleanupSession` (deletes pod, secret, service account, service, namespace).

#### `internal/reconciler/project_reconciler.go` — ProjectReconciler

Consumes exact Project desired-work rows using the distinct `ambient-operator`
OIDC identity and generation-fenced Project runtime projection. It creates
Kubernetes namespaces via `ensureNamespace()` and sets up runtime RBAC. Project
= Namespace; the ProjectReconciler is the sole owner of namespace lifecycle.

#### `internal/reconciler/gateway_reconciler.go` — GatewayReconciler

Consumes the complete sorted declared Gateway set from the exact Project runtime
projection, reconciles it into Kubernetes workloads, then sends an idempotent
generation-fenced acknowledgement containing only control-plane-owned runtime
status. It has no generic Gateway list/update authority. See
[gateway-provisioning.spec.md](./gateway-provisioning.spec.md) for the full
specification.

#### `internal/reconciler/application_reconciler.go` — ApplicationReconciler

Git-based GitOps reconciler that syncs agent fleet definitions from git repositories. Uses the shared kustomize library (extracted from `acpctl apply`) to render manifests. Supports `kind: Gateway` documents in rendered manifests, applying them to the API server alongside Project, Agent, Credential, and RoleBinding resources.

#### `internal/reconciler/shared.go` — SDKClientFactory

Mints and caches per-project SDK clients. Each project uses the same bearer token but different project context. Also provides `namespaceForSession`, phase constants, and label helpers.

#### `internal/kubeclient/kubeclient.go` — KubeClient

Thin wrapper over `k8s.io/client-go` dynamic client. Provides typed `Create/Get/Delete` methods for Pod, Service, Secret, ServiceAccount, Namespace, RoleBinding. Eliminates raw unstructured map construction from reconciler code.

### Pod Provisioning

The CP creates a Pod (not a Job) for each session. Key pod attributes:

| Attribute | Value | Reason |
|---|---|---|
| `restartPolicy` | `Never` | Sessions are single-run; no automatic restart |
| `imagePullPolicy` | `IfNotPresent` for `localhost/` images, `Always` otherwise | kind uses local containerd — `Always` breaks `localhost/` image pulls |
| `serviceAccountName` | `session-{id}-sa` | Session-scoped; no cross-session access |
| `automountServiceAccountToken` | `false` | Direct/Operator default API credentials are unavailable; only the explicit pod-bound token projected at `AMBIENT_WORKLOAD_IDENTITY_PATH` may authenticate. Gateway Runner receives no ServiceAccount projection or configurable identity audience |
| CPU request/limit | 500m / 2000m | Generous for Claude Code |
| Memory request/limit | 512Mi / 4Gi | Claude Code is memory-intensive |

The CP binds the `system:image-builder` ClusterRole to `session-{id}-sa` via a namespace-scoped RoleBinding at provision time. This authorizes the ServiceAccount at the Kubernetes RBAC layer for the OpenShift internal image registry (`image-registry.openshift-image-registry.svc:5000`) but does not expose registry authentication to the Runner, agent, or model. With automatic token mounting disabled and the projected identity restricted to its mode-specific control-plane trust domain, this RoleBinding alone does not enable `crane` or other agent-initiated pushes. Any such workflow requires a separate scoped credential broker and observable contract outside Todo11. Pull authorization remains an OpenShift namespace policy concern and likewise does not alter the projected-token boundary.

### Bootstrap Resolution and Compatibility Start Context

**Desired state — bootstrap sequencing:**

Rich Agent-start producers SHALL persist a human-authored task as `event_type=user` when present, followed by exactly one full `event_type=bootstrap` SessionMessage. The control plane SHALL call `ResolveSessionMessageMetadata` with normal service authentication plus a short-lived `session-bootstrap-resolve` capability for the exact Session before fresh execution. It SHALL validate the required metadata snapshot before selecting or creating startup input.

For producer paths that have not yet persisted rich bootstrap input, `assembleInitialPrompt` remains a compatibility assembler. It builds the fallback payload from four sources in order:

```
1. Project.prompt        — workspace-level context (shared by all agents in this project)
2. Agent.prompt          — who this agent is (if session has AgentID)
3. Inbox messages        — unread InboxMessage.Body items addressed to this agent
4. Session.prompt        — what this specific run should do
```

Each section is joined with `\n\n`. Empty sections are omitted only after every applicable Project, Agent, Inbox, and Session context read succeeds. Assembly SHALL return `(prompt, error)` semantics; a source/read/assembly failure is not an empty prompt and enters the terminal failure path below.

The control plane resolves fresh startup state as follows:

| Persisted metadata and runtime path | Control-plane action | Required outcome |
|---|---|---|
| `bootstrap_count=1`, one valid positive `B`, and `B <= max_seq` | Set `INITIAL_BOOTSTRAP_SEQ=B` | Runner watches from `B - 1`; no compatibility payload is delivered |
| `bootstrap_count=0` and non-empty compatibility prompt on a Gateway/control-plane fresh path | Idempotently ensure the exact payload through the internal API using a `session-bootstrap-ensure` capability; on an ambiguous response make at most one same-Session, same-payload retry | Require the existing/new positive sequence `B`, set `INITIAL_BOOTSTRAP_SEQ=B`, and do not upload the prompt |
| `bootstrap_count=0` and non-empty compatibility prompt on a trusted operator/CreateSession launch currently `Pending` or `Creating` with no `start_time` or `sdk_session_id` | Set `INITIAL_BOOTSTRAP_FALLBACK_ALLOWED=true`; hand the prompt, exact-Session ensure capability, and separate refresh credential to the Runner | Signed capability issuance plus the CP-injected marker prove the launch path without a new Session field; API revalidates persisted eligibility before returning `B` |
| `bootstrap_count=0`, `max_seq=0`, empty `bootstrap_seqs`, successful empty context assembly, and Session `Pending`/`Creating` with no `start_time` or `sdk_session_id` | Set only `INITIAL_HISTORY_EMPTY=true` for fresh startup selection | Runner may watch from sequence `0` and wait for the first human turn |
| `bootstrap_count=0`, empty prompt, and `max_seq>0` | Fail the Session before Runner execution | Watch-from-zero is forbidden because it would replay historical rows as fresh work |
| `bootstrap_count>1`, missing metadata, inconsistent count/list, non-positive sequence, duplicate/unordered sequence, or any sequence greater than `max_seq` | Fail the Session before Runner execution | Ambiguous or malformed startup state never reaches the model |

For the CP-owned Gateway ensure, the control plane SHALL complete the ensure and obtain `B` before uploading any payload, setting `Running` or `start_time`, invoking `ExecSandbox`, or exposing Runner readiness. CP and Runner each have one end-to-end ensure budget of at most two identical requests: the second only after an indeterminate acknowledgement, each attempt no longer than five seconds, total operation no longer than 12 seconds, and no nested HTTP/gRPC/library retry. Definitive application errors are never retried.

A context assembly failure, definitive conflict, multiple bootstrap rows, exhausted retry/deadline, metadata/ensure query error, capability error, missing/inconsistent field, count mismatch, or sequence greater than `max_seq` SHALL persist Session phase `Failed`, `completion_time`, and a content-free `BootstrapStartupFailed` condition before returning. The condition may identify only a stable reason code such as `metadata_invalid`, `authorization_failed`, `ensure_failed`, or `context_unavailable`; it MUST NOT include prompt text, payload digest, SessionMessage content, raw upstream error text, bearer tokens, capabilities, claim values, signatures, or key material. If the terminal patch itself fails, reconciliation may retry only that same terminal patch and remains barred from payload upload, `Running`, `start_time`, readiness, and `ExecSandbox`.

**Compatibility payload delivery varies by runtime:**
- **Gateway (OpenShell) sandboxes:** The control plane owns the ensure and hands only `INITIAL_BOOTSTRAP_SEQ`; it SHALL NOT upload `/tmp/initial_prompt.txt` for a non-empty compatibility prompt.
- **Operator/CreateSession pods:** The prompt MAY use `/tmp/initial_prompt.txt` or `INITIAL_PROMPT` only together with `INITIAL_BOOTSTRAP_FALLBACK_ALLOWED=true` after persisted `Pending`/`Creating` phase and absent `start_time` are revalidated. Absence of `INITIAL_BOOTSTRAP_SEQ`, elapsed time, or a time-based freshness heuristic is never fallback authorization.

### Environment Variables Injected into Runner Pod

| Var | Value | Purpose |
|---|---|---|
| `SESSION_ID` | session.ID | Primary session identifier |
| `PROJECT_NAME` | session.ProjectID | Project context |
| `WORKSPACE_PATH` | `/workspace` | Claude Code working directory |
| `AGUI_PORT` | `8001` | Runner HTTP listener port |
| `BACKEND_API_URL` | CP config | api-server base URL |
| `AMBIENT_GRPC_URL` | CP config | api-server gRPC address |
| `AMBIENT_GRPC_USE_TLS` | CP config | TLS flag for gRPC |
| `AMBIENT_CP_TOKEN_URL` | CP config | Exact HTTPS CP exchange URL (e.g. `https://ambient-control-plane.{ns}.svc:8443/token`); plaintext, redirect, and downgrade are forbidden |
| `AMBIENT_CP_CA_PATH` | mode-specific trust bundle | Direct/Operator uses ACP serving CA; Gateway Runner trusts the OpenShell per-Sandbox proxy CA while the supervisor separately validates ACP serving CA upstream |
| `AMBIENT_WORKLOAD_IDENTITY_PATH` | Direct/Operator projected bound SA token | Supervisor-only `ambient-control-plane-tokenserver` identity for Direct/Operator. Gateway receives no identity path, SPIFFE socket, JWT-SVID, or injected attestation |
| `INITIAL_BOOTSTRAP_SEQ` | one positive SessionMessage `seq` | Authoritative persisted bootstrap for fresh start; mutually exclusive with resume, fallback permission, and `INITIAL_HISTORY_EMPTY` |
| `INITIAL_HISTORY_EMPTY` | `"true"` only | CP proof of one successful snapshot with `bootstrap_count=0`, `max_seq=0`, empty `bootstrap_seqs`, successful empty context assembly, and eligible pre-execution Session; mutually exclusive with all other startup selectors |
| `INITIAL_BOOTSTRAP_FALLBACK_ALLOWED` | `"true"` only | Operator/CreateSession-only fallback permission after persisted `Pending`/`Creating` and absent `start_time` revalidation; never set for Gateway |
| `INITIAL_PROMPT` | compatibility assembled context | Operator/CreateSession fallback input only; valid only with explicit fallback permission and never attributed as `user` |
| `AMBIENT_SESSION_CAPABILITY` | short-lived signed token | Direct/Operator fallback-only exact-Session `session-bootstrap-ensure` capability; never set for Gateway |
| `AMBIENT_CAPABILITY_REFRESH_CREDENTIAL` | CP-signed refresh JWT | Direct/Operator supervisor-only `session-capability-refresh` credential; never set for Gateway |
| `IS_RESUME` | `"true"` | Set when `session.StartTime != nil`; forbids bootstrap lookup, validation, or publication in the Runner |
| `RESUME_AFTER_SEQ` | max `seq` from session_messages | Set alongside `IS_RESUME` when messages exist; runner's gRPC listener starts watching from this seq to prevent replay of historical messages |
| `USE_VERTEX` / `ANTHROPIC_VERTEX_PROJECT_ID` / `CLOUD_ML_REGION` | CP config | Vertex AI config (when enabled) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/app/vertex/ambient-code-key.json` | Vertex service account path |
| `LLM_MODEL` / `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | session fields | Per-session model config |
| `CREDENTIAL_IDS` | JSON map `{provider: credential_id}` | Resolved credentials for this session; runner calls `/credentials/{id}/token` per provider |

### Session Bootstrap Capability Issuance and Rotation

The control plane SHALL mint separate resolve and ensure access capabilities under the data-model contract. CP-internal metadata calls use HS256 `purpose=session-bootstrap-resolve`; CP-owned ensures use HS256 `purpose=session-bootstrap-ensure`. Only an eligible Direct/Operator Runner fallback receives an exact-Session ensure capability plus RS256 `purpose=session-capability-refresh`; Gateway receives neither. No Runner receives a resolve capability, current/previous HMAC/RSA key, Secret reference, or cross-Session token.

For Direct/Operator initial acquisition, reconnect, or ensure expiry, each trusted platform consumer presents `x-ambient-capability-refresh` plus the current pod-bound projected identity and requests exactly one signed-scope grant. Runner may request `runtime-and-bootstrap-ensure` only for an API-revalidated eligible operator/CreateSession fallback; MCP and credential sidecars hard-code `runtime-only`, receive no ensure capability, and refresh before the two-minute runtime credential expires. The request cannot supply workload mode, origin, service-identity profile, or Session identity. The obsolete RSA-OAEP encrypted-Session `GET /token` protocol is forbidden.

The Direct/Operator branch SHALL validate `alg=RS256`, `iss=ambient-control-plane`, single audience `ambient-control-plane-tokenserver`, `purpose=session-capability-refresh`, exact `session_id`, immutable `workload_mode`, `origin`, `workload_generation`, `grant_scope`, current/overlap `kid`, and all required times before issuance. The signed generation MUST equal the live Pod annotation. Refresh reuse is limited to that same authenticated Pod, endpoint, Session, audience, purpose, mode, origin, generation, and grant scope until expiry or revocation.

Gateway initial acquisition and reconnect use a distinct branch. A dedicated runtime-auth helper outside the agent/model process and filesystem allowlists sends only the fixed runtime-only body through the OpenShell HTTP/1.1 proxy; it sends no Authorization, refresh credential, ensure capability, Session selector, workload mode, origin, audience, or trust-domain selector. Providers v2 injects the 60-second ACP attestation into only exact `/token` traffic. ACP verifies it and repeats the live Sandbox/Pod/ServiceAccount/owner/session/generation/deletion checks before returning only a two-minute RS256 `aud=ambient-api-server`, `purpose=session-runtime` credential. Gateway never receives or can request ensure authority. Neither branch may return a global service bearer.

The bootstrap-capability HMAC key ring and CP RSA Direct/Operator-refresh, service, and Gateway-attestation signing rings SHALL come from external Kubernetes Secrets or equivalent providers. HMAC keys contain at least 32 decoded random bytes and RSA keys are at least 2048 bits. The authoritative operator generator SHALL create distinct runtime, refresh, and TLS/exchange pairs plus the runtime JWKS, refuse to overwrite an existing Secret, and run the same validator used by production and PR-test preflight. Reconciliation SHALL be idempotent: it may update-or-create references and mounts but SHALL NOT write a default, replace a valid externally managed value, upload a per-Session private key, or copy key material into a Runner workload. API server and control plane configuration SHALL fail before serving/readiness when a required key set or SPIFFE trust bundle is invalid. Logs and status conditions report only stable content-free codes.

CP and API both mount/reload the symmetric bootstrap-capability HMAC ring; API uses it only through verifier code but has equivalent cryptographic signing power. CP alone mounts RSA private signing rings and SPIFFE verification trust, while API mounts RSA public verification rings. Runner receives no signing or verification key; Gateway Runner also receives no SPIFFE socket, JWT-SVID, attestation, refresh credential, or ensure capability. New artifacts use current `kid` values; optional previous keys are verification-only for no longer than the corresponding maximum lifetime. Unknown/retired keys fail closed. An invalid reload preserves the last valid rings and exposes a content-free unhealthy readiness state until corrected.

### Session Restart Behavior

When the CP provisions a runner pod for a session that has been started before (`session.StartTime != nil`), it SHALL use only resume state and SHALL NOT request bootstrap publication or set `INITIAL_BOOTSTRAP_SEQ`:

```
if session.StartTime != nil:
    1. Set IS_RESUME=true
    2. Use ResolveSessionMessageMetadata under exact-Session resolve capability
    3. Set RESUME_AFTER_SEQ from its max_seq, or 0 after a successful empty result
    4. Omit INITIAL_BOOTSTRAP_SEQ, INITIAL_HISTORY_EMPTY, fallback permission, compatibility prompt, and ensure capability
    5. For Direct/Operator only, include the supervisor-private exact-Session refresh credential; Gateway reacquires runtime authority only through Providers v2 attestation injection
```

The CP SHALL use the metadata-only resolver documented in `data-model.spec.md` and validate the entire envelope from one snapshot. It MUST NOT substitute an unrelated project identifier into the Session path. Missing metadata, count/list mismatch, sequence greater than `max_seq`, or capability failure persists the same content-free `Failed` condition before workload execution.

A resume-cursor query error MUST fail closed rather than being treated as an empty history. If the query succeeds with no messages, `RESUME_AFTER_SEQ=0` is explicit.

On the runner side:
- `IS_RESUME=true` causes all startup carriers to be ignored and bootstrap publication to be forbidden
- `RESUME_AFTER_SEQ=N` causes the gRPC listener to start `WatchSessionMessages` from `last_seq=N`, skipping all messages with `seq <= N`

This ensures a restarted session picks up from where it left off without republishing bootstrap or re-processing historical startup and human messages. A `start_time` or `Running` phase is a hard prohibition on fallback, never a reason to infer a fresh start. Neither CP nor Runner may admit fallback from elapsed time, message age, pod age, or any other time heuristic.

---

## Runner

### What It Is

The Runner is a Python FastAPI application (`ambient-runner`) that runs inside each session pod. It:

1. **Owns** the Claude Code execution lifecycle (start, run, interrupt, shutdown)
2. **Bridges** between the AG-UI protocol (HTTP SSE) and the gRPC message store
3. **Listens** to the api-server gRPC stream for inbound user messages
4. **Pushes** conversation records back to the api-server via `PushSessionMessage`
5. **Exposes** a local SSE endpoint for live AG-UI event observation

One runner pod runs per session. The pod is ephemeral — it exists only while the session is active.

### Internal Structure

```
app.py                          ← FastAPI application factory + lifespan
  │
  ├── endpoints/
  │     ├── run.py              ← POST / (AG-UI run endpoint)
  │     ├── events.py           ← GET /events/{thread_id} (SSE tap — NEW)
  │     ├── interrupt.py        ← POST /interrupt
  │     ├── health.py           ← GET /health
  │     └── ...                 (capabilities, repos, workflow, mcp_status, content)
  │
  ├── bridges/claude/
  │     ├── bridge.py           ← ClaudeBridge (PlatformBridge impl)
  │     ├── grpc_transport.py   ← GRPCSessionListener + GRPCMessageWriter
  │     ├── session.py          ← SessionManager + SessionWorker
  │     ├── auth.py             ← Vertex AI / Anthropic auth setup
  │     ├── mcp.py              ← MCP server config
  │     └── prompts.py          ← System prompt builder
  │
  ├── _grpc_client.py           ← AmbientGRPCClient (codegen)
  ├── _session_messages_api.py  ← SessionMessagesAPI (codegen, hand-rolled proto codec)
  │
  └── middleware/
        └── grpc_push.py        ← grpc_push_middleware (HTTP path fire-and-forget)
```

### Startup Sequence

When `AMBIENT_GRPC_URL` is set (standard deployment):

```
1. app.py lifespan() starts
2. RunnerContext created from env vars (SESSION_ID, WORKSPACE_PATH)
3. bridge.set_context(context)
4. bridge._setup_platform() called eagerly:
     - SessionManager initialized
     - Vertex AI / Anthropic auth configured
     - MCP servers loaded
     - System prompt built
     - GRPCSessionListener instantiated but not yet opened on a fresh fallback path
5. Select exactly one startup cursor:
     a. Resume: require IS_RESUME + RESUME_AFTER_SEQ and mode-appropriate runtime authentication;
        omit ensure capability and fallback; Gateway has no refresh carrier
     b. Fresh authoritative bootstrap B: obtain the exact-Session service token through the
        mode-appropriate Direct/Operator or Gateway exchange, then open WatchSessionMessages after B - 1
        (Gateway/control-plane paths always arrive here after CP-owned ensure)
     c. Fresh operator/CreateSession fallback explicitly allowed:
        → require non-empty prompt plus exact-Session ensure capability and refresh credential
        → API revalidates Pending/Creating and absent start_time during conditional ensure
        → on ambiguous acknowledgement, retry once with identical Session/payload
        → require positive F, then open WatchSessionMessages after F - 1
     d. INITIAL_HISTORY_EMPTY=true: require mode-appropriate runtime authentication and no other
        fresh selector, prompt, or ensure capability; obtain service token, then watch after 0
     e. Any other combination: fail closed without watch, readiness, Running, or model execution
6. await bridge._grpc_listener.ready.wait()
   (blocks until the selected WatchSessionMessages stream is confirmed open)
7. Expose Runner readiness; API human-message admission requires this registration even when
   Gateway has already persisted `Running` immediately before `ExecSandbox`
8. yield (app is ready, uvicorn serving)
9. On shutdown: bridge.shutdown() → GRPCSessionListener.stop()
```

### gRPC Transport Layer

#### `GRPCSessionListener` (pod-lifetime)

Subscribes to `WatchSessionMessages` for this session via a blocking iterator running in a `ThreadPoolExecutor`. The authoritative `bootstrap` at the selected sequence drives the one initial run; a later `user` row drives a later human turn. Legacy startup-context rows encoded as `user` remain non-executable history; presentation consumers may identify them only under the exact-digest compatibility rule in the data-model spec.

Before invoking `bridge.run()` for bootstrap, the listener claims the sequence in its in-memory cursor and bootstrap guard. Reconnect before receipt uses `B - 1`; reconnect after acceptance uses `B`, so ordinary stream reconnect cannot repeat the initial run. Any unexpected second or mismatched bootstrap indicates corrupt or pre-constraint state, is fatal, and MUST NOT invoke the model.

Fan-out during a turn:
```
bridge.run() yields events
  ├── bridge._active_streams[thread_id].put_nowait(event)   ← SSE tap queue
  └── writer.consume(event)                                 ← GRPCMessageWriter
```

#### `GRPCMessageWriter` (per-turn)

Accumulates `MESSAGES_SNAPSHOT` events during a turn. On `RUN_FINISHED` or `RUN_ERROR`, calls `PushSessionMessage(event_type="assistant")` with the assembled payload.

**Current payload format (proposed for change — see below):**

```json
{
  "run_id": "...",
  "status": "completed",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "reasoning", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

This payload includes the user echo and reasoning content, making it verbose and difficult to display in the CLI.

#### `grpc_push_middleware` (HTTP path, secondary)

Wraps the HTTP run endpoint event stream. Calls `PushSessionMessage` once per AG-UI event as events flow out of `bridge.run()`. Fire-and-forget. Active only on the HTTP POST `/` path, not the gRPC listener path.

**Note:** With the gRPC listener as the primary path, `grpc_push_middleware` fires only when a run is triggered via HTTP (external POST). This is a secondary path for backward compatibility; the gRPC listener path is preferred.

### Two Message Streams

| Stream | Source | Content | Persistence | Purpose |
|---|---|---|---|---|
| `WatchSessionMessages` (gRPC DB stream) | api-server DB | `event_type=bootstrap`, `event_type=user`, and result rows | Persisted; replay from an explicit cursor | Durable startup input and conversation record; CLI, history |
| `GET /events/{thread_id}` (SSE tap) | Runner in-memory queue | All AG-UI events: tokens, tool calls, reasoning chunks, status events | Ephemeral; runner-local; lost on reconnect | Live UI; streaming display; observability |

### `GET /events/{thread_id}` — SSE Tap Endpoint

Added to `endpoints/events.py`. Registered as a core (always-on) endpoint.

Behavior:
1. Registers `asyncio.Queue(maxsize=256)` into `bridge._active_streams[thread_id]`
2. Streams every AG-UI event as SSE until `RUN_FINISHED` / `RUN_ERROR` or client disconnect
3. Sends `: keepalive` pings every 30s to hold the connection
4. On exit (any reason), removes the queue from `_active_streams`

This endpoint is read-only. It never calls `bridge.run()` or modifies any state. It is a pure observer.

`thread_id` in the runner corresponds to the session ID (same value as `SESSION_ID` env var).

---

## SessionMessage Payload Contract

### Current State (as-built)

`event_type=user` payload: plain string — the user's message text.

`event_type=bootstrap` payload: plain string — trusted platform-composed initial model input, never attributed as a human turn.

`event_type=assistant` payload: JSON blob containing:
- `run_id` — the run that produced this turn
- `status` — `"completed"` or `"error"`
- `messages` — array of all MESSAGES_SNAPSHOT messages including:
  - `role=user` (echo of the input)
  - `role=reasoning` (extended thinking content)
  - `role=assistant` (Claude's reply)

This is verbose, inconsistent with the user payload format, and leaks reasoning content into the durable record.

### Proposed State

`event_type=user` payload: plain string — unchanged.

`event_type=bootstrap` payload: plain string — the complete trusted start context used for initial execution.

`event_type=assistant` payload: plain string — the assistant's reply text only.

Specifically: extract only the `role=assistant` message's `content` field from the final `MESSAGES_SNAPSHOT` and store that as the payload. Symmetric with `event_type=user`.

**What moves where:**
- `role=reasoning` content → flows through `GET /events/{thread_id}` SSE only (ephemeral, live)
- `role=assistant` content → stored as plain string in `event_type=assistant` DB row
- `role=user` echo → already in `event_type=user` DB row; no need to repeat

**Rationale:**
- CLI can display `event_type=user` and `event_type=assistant` identically — both are plain strings
- Reasoning is observability data, not conversation record data
- Payload size drops dramatically (reasoning can be 10x longer than the reply)
- Replay via `WatchSessionMessages` returns a clean conversation thread

### Implementation Target: `GRPCMessageWriter._write_message()`

Current:
```python
payload = json.dumps({
    "run_id": self._run_id,
    "status": status,
    "messages": self._accumulated_messages,
})
```

Proposed:
```python
assistant_text = next(
    (m.get("content", "") for m in self._accumulated_messages
     if m.get("role") == "assistant"),
    "",
)
payload = assistant_text
```

---

## API Server Proxy: `GET /sessions/{id}/events`

The runner's `GET /events/{thread_id}` is only accessible within the cluster (pod-to-pod via ClusterIP Service). External clients need a proxy through the api-server.

The CP creates a `session-{id}` Service (ClusterIP, port 8001) pointing at the runner pod. The api-server can reach it at:

```
http://session-{kube_cr_name}.{kube_namespace}.svc.cluster.local:8001/events/{kube_cr_name}
```

The proposed `GET /api/ambient/v1/sessions/{id}/events` endpoint on the api-server:

1. Looks up the session from DB — gets `kube_cr_name` and `kube_namespace`
2. Constructs the runner URL
3. Opens an HTTP GET with `Accept: text/event-stream`
4. Streams the runner's SSE body verbatim to the client response
5. Passes keepalive pings through unchanged
6. Closes the client stream when the runner closes or client disconnects

This endpoint is implemented in `plugins/sessions/plugin.go` as `GET /sessions/{id}/events` → `sessionHandler.StreamRunnerEvents` (status: ✅ implemented).

---

## Generic Backend Proxy

`plugins/proxy/plugin.go` (ambient-api-server) forwards every request whose path does NOT start with `/api/ambient/` verbatim to `BACKEND_URL` (default `http://localhost:8080`). Method, path, query string, headers (including `Authorization`), and body are forwarded unchanged. The response — headers, status code, body — is copied back unchanged.

Implementation: `pkgserver.RegisterPreAuthMiddleware` wraps the entire HTTP server before routing. Native paths (`/api/ambient/...`, `/metrics`, `/favicon.ico`) fall through to the next handler; all others are proxied.

Status: ✅ implemented — `plugins/proxy/plugin.go`; blank-imported in `cmd/ambient-api-server/main.go`.

---

## CLI: `acpctl session events`

Streams live AG-UI events for a session via `GET /sessions/{id}/events`.

```
acpctl session events <session-id>
```

Behavior:
- Opens SSE connection to api-server `/sessions/{id}/events`
- Renders each event type distinctly:
  - `TEXT_MESSAGE_CONTENT` → print token to stdout (no newline — streaming)
  - `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` → status line
  - `TOOL_CALL_START` / `TOOL_CALL_END` → tool name + status
  - `: keepalive` → ignored
- Exits on `RUN_FINISHED`, `RUN_ERROR`, or Ctrl+C

Status: 🔲 planned

---

## CP Token Endpoint

### Problem

Runner pods authenticate to the api-server gRPC interface using a `BOT_TOKEN` injected at pod start and refreshed by the CP every 4 minutes via a K8s Secret update. In OIDC environments (e.g. S0), `BOT_TOKEN` is an OIDC client-credentials JWT with a 15-minute TTL.

This creates a three-way async race:

1. CP ticker writes a fresh token to the Secret every 4 minutes
2. Kubelet propagates the Secret update to the pod's file mount (30–60s delay in busy clusters)
3. Runner reads the file mount on gRPC reconnect

When the CP writes a token that is already close to expiry — because its in-memory `OIDCTokenProvider` cache had a short buffer — the runner reconnects with an already-expired token and enters an `UNAUTHENTICATED` loop.

The fundamental issue is that the Secret-write model is an **async push** with no synchronization guarantee between when the token is written and when the runner reads it.

### Solution

**Desired state — Session-scoped token exchange:**

The CP exposes a lightweight authenticated HTTPS endpoint that runners call **synchronously on demand** to obtain a guaranteed-fresh, exact-Session service credential. This eliminates the async race without granting a global Runner identity.

```
POST /token
```

- Served by a dedicated TLS listener on the CP (port 8443, separate from any existing listener), with TLS 1.2 or newer and an externally provisioned certificate valid for the exact service DNS name
- Direct/Operator authenticates with an explicit projected, short-lived, pod-bound Kubernetes ServiceAccount token plus RS256 exact-Session refresh credential; Gateway arrives through the OpenShell Providers v2 HTTP proxy with only an injected ACP workload attestation
- Returned service authority is restricted to the verified Direct/Operator refresh or Gateway attestation Session; no caller-selected Session ID or global service bearer is accepted
- The request requires exact path `/token`, no query, `POST`, `Content-Type: application/json`, and a body of at most 1 KiB with exact schema `{ "grant": "runtime-only" | "runtime-and-bootstrap-ensure" }`; duplicate keys, unknown fields, trailing values, missing grant, and any serialized Session, workload mode, origin, or audience are rejected before credential issuance
- The authoritative Session comes only from the verified Direct/Operator refresh matched to TokenReview/live Pod, or the verified Gateway attestation matched to live Sandbox/Pod state; a caller-selected Session never participates in authorization
- Response fields are bounded to the Session-scoped service token, expiry, and any explicitly requested/eligible short-lived capability; maximum response body size is 16 KiB and values are never logged
- Responses set `Cache-Control: no-store` and `Pragma: no-cache`; clients forbid redirects, plaintext fallback, TLS downgrade, and a server name or CA mismatch
- Request headers are limited to 8 KiB; server read-header, whole-request-read, and write timeouts are five seconds, idle timeout is 30 seconds, and the client enforces one five-second total exchange deadline

### Authentication

Direct/Operator identity is a kubelet-rotated, pod-bound projected ServiceAccount token with a pod object reference, explicit `expirationSeconds <= 600`, `audience=ambient-control-plane-tokenserver`, and `automountServiceAccountToken=false`. Its projected volume is read-only and available only to the Direct/Operator Runner supervisor credential boundary. That supervisor SHALL reread the current token immediately before every initial, reconnect, or capability exchange, discard the request copy afterward, and never cache the startup token.

For Direct/Operator only, after validating the refresh signature and immutable workload pair, the CP selects `ambient-control-plane-tokenserver` and sends only that value in Kubernetes `authentication/v1` `TokenReview.spec.audiences`:

```
POST /apis/authentication.k8s.io/v1/tokenreviews
{
  "spec": {
    "token": "<runner SA token>",
    "audiences": ["ambient-control-plane-tokenserver"]
  }
}
```

A successful Direct/Operator `TokenReview` SHALL return `status.authenticated=true`, exactly `ambient-control-plane-tokenserver` in `status.audiences`, the exact namespace/ServiceAccount username, and the bound pod name/UID in authenticated extras. The CP SHALL GET that live Pod, require its UID and `spec.serviceAccountName` to match the reviewed identity and trusted exact-Session workload, and require the Session to equal the refresh credential's `session_id`.

Gateway mode SHALL use the released OpenShell v0.0.82 Providers v2 SPIFFE `token_grant` implementation. The Gateway deployment enables `providers_v2_enabled=true` and released SPIFFE provider-token-grant support. SPIRE or another compatible implementation provides a CSI Workload API socket plus `OPENSHELL_PROVIDER_SPIFFE_WORKLOAD_API_SOCKET` only to the OpenShell supervisor sidecar; Runner cannot mount or reach either. A `ClusterSPIFFEID` assigns exactly `spiffe://<trust-domain>/openshell/sandbox/<sandbox-uuid>/pod/<pod-uid>/generation/<workload-generation>/sa/<service-account>` from the sandbox annotation, immutable Pod UID, CP-owned workload generation annotation, and Pod ServiceAccount. The supervisor trust store contains the ACP serving CA before startup, validates the exact ACP service DNS SAN, and is restarted when that CA rotates because OpenShell v0.0.82 does not hot-reload per-profile CA trust. NetworkPolicy permits the sidecar path only to ACP port 8443. The control plane reads back and exactly validates the ClusterSPIFFEID class, selectors, template, JWT TTL, version, settings, socket/env, SPIFFE trust bundle/JWKS, CA, NetworkPolicy, and identity resources before execution; missing, older, disabled, ambiguous, drifted, or unready state fails closed.

CP SHALL update-or-create and resource-version reconcile one ACP runtime-only custom provider profile plus an empty provider instance on the target Gateway, then attach that exact instance before Runner execution. The fixed `token_grant` values use `token_endpoint=https://<configured-exact-cp-service-dns>:8443/oauth2/sandbox-attestation`, `jwt_svid_audience=ambient-control-plane-sandbox-attestor`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `audience=ambient-control-plane-tokenserver`, `scopes=[sandbox-attestation]`, `cache_ttl_seconds=30`, `auth_style=bearer`, `header_name=Authorization`, and no audience overrides. ACP returns `expires_in=60`, so v0.0.82's fixed cache TTL remains shorter than token lifetime. The configured DNS name SHALL be identical across URL, endpoint, certificate SAN validation, and policy. The instance has no static credential/config/env/query/path/refresh/private-key material. Its only protected endpoint is exact host/port/path `/token`, no query or fragment, `protocol=rest`, TLS termination/enforcement, and ACP server CA; wildcard, additional, equal-specificity, or more-specific bindings are forbidden.

The distinct ACP token endpoint `POST /oauth2/sandbox-attestation` accepts OpenShell v0.0.82's RFC 7523 client authentication with a body of at most 16 KiB only as `application/x-www-form-urlencoded` and exact singleton fields `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion=<JWT-SVID>`, `audience=ambient-control-plane-tokenserver`, and `scope=sandbox-attestation`. For this client profile, an optional OAuth `client_id` must equal the exact SPIFFE ID in JWT `sub`. ACP ignores unknown extension parameters as required by RFC 6749, rejects duplicate, missing, empty, folded, or oversized required fields, and does not accept the JWT-bearer grant type. It validates fixed RS256, SPIFFE `iss`, `aud=ambient-control-plane-sandbox-attestor` as the configured authorization-server identity, bounded times, and exact subject `spiffe://<trust-domain>/openshell/sandbox/<sandbox-uuid>/pod/<pod-uid>/generation/<workload-generation>/sa/<service-account>`. It resolves the UUID to one live Sandbox and Pod and requires the subject Pod UID, generation, and ServiceAccount to equal the live values plus immutable sandbox-ID annotation, `deletionTimestamp == nil`, and controlling Sandbox owner kind/name/UID. Success returns only JSON `access_token`, `token_type=Bearer`, `expires_in=60`, and exact `scope=sandbox-attestation` with `Cache-Control: no-store` and `Pragma: no-cache`; it returns no refresh token. Failure uses the RFC 6749 JSON error shape and no secret-bearing description: an invalid client assertion returns `invalid_client`, malformed or ambiguous form input returns `invalid_request`, an unsupported grant returns `unsupported_grant_type`, and a wrong scope returns `invalid_scope`; every response carries `Cache-Control: no-store` and `Pragma: no-cache`.

When the Gateway runtime-auth helper sends HTTPS HTTP/1.1 `POST /token`, it sends no `Authorization` or refresh credential. The OpenShell supervisor obtains or reuses the ACP attestation for at most 30 seconds and injects exactly one `Authorization: Bearer <gateway-workload-attestation>` only for the exact protected endpoint. Runner sees neither projected tokens, OpenShell gateway JWT, JWT-SVID, SPIFFE key/socket, attestation, refresh credential, nor ensure capability. `/token` rejects duplicate, folded, malformed, or multiple Authorization values, enforces the fixed attestation profile, and repeats the live Sandbox/Pod/ServiceAccount/owner/session/generation/deletion checks. Providers v2 injection applies only to inspectable HTTP/1.1; no h2 or gRPC injection is claimed. Because the released supervisor can transiently report an unavailable new-Pod SVID after Kubernetes readiness, the single helper process MAY retry only transport failure or HTTP 401/429/502/503/504 inside one five-second total deadline with bounded backoff; all other responses fail immediately. gRPC and model execution open only after `/token` returns a two-minute exact-Session runtime credential and authenticates with that credential.

The trusted mapping is the exact live Pod UID plus CP-owned annotations, not an inferred name or label. Before Gateway Pod creation, CP SHALL assign one random unpadded-base64url `workload_generation` and place `ambient-code.ai/session-id` plus `ambient-code.ai/workload-generation` in the operator-owned Sandbox Pod template. The first SPIRE registration therefore observes the complete identity; CP MUST NOT patch these identity inputs onto an already-Ready Pod. The generation is preserved across resume, re-exec, and controller replacement within that Sandbox lifecycle, while the immutable Pod UID in the subject invalidates every prior Pod's SVID. A new Sandbox lifecycle or workload-mode change requires a new generation. CP reads back the exact Pod annotations and UID before admitting `/oauth2/sandbox-attestation`. OpenShell, SPIRE, Runner, and agent identities cannot patch the bindings.

Every `/token` POST SHALL re-read the nonterminal Session and exact live workload state even on a reused TLS connection. It SHALL require `deletionTimestamp == nil` on the exact Pod and, for Gateway, Sandbox; recheck UID, ServiceAccount, owner reference, origin, annotations, and generation; and reject a terminal/stopping Session or terminating workload before issuance.

Missing/multiple audiences, wrong RFC 7523 grant/assertion type/resource audience/scope, wrong SPIFFE trust domain/issuer/subject, missing provider attachment, wrong mode/origin/generation/grant scope, direct Gateway `/token` use of a projected ServiceAccount token, refresh credential, HMAC workload token, OpenShell gateway JWT, raw JWT-SVID, or client mTLS key, invalid/expired attestation, terminal Session, deleting/replaced Pod or Sandbox, ServiceAccount mismatch, owner-reference mismatch, annotation mismatch, or prefix match fails closed.

The returned service credential uses the fixed RS256 `session-runtime` profile in `data-model.spec.md`. API REST/gRPC middleware validates its signature, current/overlap `kid`, issuer, single audience, purpose, times, and exact target Session on every Runner call. It is never accepted as a user, administrator, control-plane, project-global, or service-global credential.

### Token Lifecycle

The CP token endpoint is the **sole source** of the api-server bearer token for runner pods. There is no Secret write loop and no `BOT_TOKEN` env var or file mount. The token is exact-Session authority: every Runner API/gRPC operation validates that its target Session matches the service credential; bootstrap ensure additionally requires the matching ensure capability.

| Phase | Mechanism |
|---|---|
| Gateway initial startup/reconnect | HTTPS HTTP/1.1 `POST /token` through the exact Providers v2 binding; the supervisor injects the short ACP attestation and `/token` returns only the exact-Session runtime credential |
| Direct/Operator initial startup/reconnect | `POST /token` with the current pod-bound projected identity plus exact-Session refresh; atomically replace only the runtime credential |
| Eligible Direct/Operator fallback ensure | Request signed-scope `runtime-and-bootstrap-ensure`; install the returned ensure capability only for the bounded ensure operation |

The CP is critical infrastructure. If CP, SPIFFE verification, Providers v2 profile/attachment/injection, Direct/Operator TokenReview/refresh verification, or exact-Session binding is unavailable, the corresponding Runner fails closed. No global bearer, stale credential, caller-selected Session, upstream Gateway credential, or unauthenticated fallback is provided.

### CP HTTPS Server

The CP adds a minimal `net/http` server alongside its existing K8s controller loop:

```go
tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
mux := http.NewServeMux()
mux.Handle("/token", http.MaxBytesHandler(http.HandlerFunc(tokenHandler), 1024))
mux.Handle("/oauth2/sandbox-attestation", http.MaxBytesHandler(http.HandlerFunc(sandboxAttestationHandler), 16<<10))
mux.HandleFunc("/healthz", healthHandler)
server := &http.Server{
    Addr:              ":8443",
    Handler:           mux,
    TLSConfig:         tlsConfig,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       5 * time.Second,
    WriteTimeout:      5 * time.Second,
    IdleTimeout:       30 * time.Second,
    MaxHeaderBytes:    8 << 10,
}
server.ListenAndServeTLS(certFile, keyFile)
```

The server runs in a goroutine alongside `runKubeMode`. It shares the existing `tokenProvider` and `k8sClient` from the main CP config.

### Runner Changes

`_grpc_client.py` `reconnect()` calls the CP token endpoint instead of rereading the legacy `BOT_TOKEN` Secret. Direct/Operator rereads the current projected token. Gateway sends its HTTP/1.1 request through the OpenShell Providers v2 proxy, which injects the ACP attestation outside the Runner process:

```python
def reconnect(self) -> None:
    response = _post_token_exchange(
        workload_identity=acquire_direct_or_operator_identity_if_required(), # omitted in Gateway
        refresh=direct_or_operator_refresh_if_required(),                   # omitted in Gateway
        grant="runtime-only",
        expected_session_id=self.session_id,  # local response assertion; never serialized
        pinned_ca=cp_ca_path,
        deadline_seconds=5,
    )
    response.require_exact_session(self.session_id)
    response.reject_unsolicited_capability()
    self._replace_service_token_atomically(response.service_token)
```

`AMBIENT_CP_TOKEN_URL` is injected by the CP when creating the Runner. Local tests without CP MUST use an isolated exact-Session test issuer or the explicitly non-gRPC path; a direct global `BOT_TOKEN` fallback MUST NOT bypass the Session boundary.

### New CP Internal Packages

| Package | Purpose |
|---|---|
| `internal/tokenserver/server.go` | HTTP server setup and graceful shutdown |
| `internal/tokenserver/handler.go` | `POST /token` handler — pinned-TLS request limits, mode-separated TokenReview/refresh or Gateway-attestation validation, and exact-Session credential issuance |

Status: 🔲 planned — RHOAIENG-56711

---

## Runner Credential Fetch

The runner fetches provider credentials at session start before invoking Claude. Credentials are resolved by the CP and injected into the runner pod as `CREDENTIAL_IDS` — a JSON-encoded map of `provider → credential_id`:

```
CREDENTIAL_IDS={"gitlab": "01JX...", "github": "01JY...", "jira": "01JZ..."}
```

The CP builds this map from the Credential Kind RBAC resolver: for each provider, walk agent → project → global scope and take the most specific matching credential. Credentials not visible to this session are excluded.

The runner calls `GET /api/ambient/v1/credentials/{id}/token` for each provider present in `CREDENTIAL_IDS` using its exact-Session runtime credential. The API derives the Session from the verified credential and permits only credential IDs pre-bound to that Session; the URL's credential ID and any caller project value cannot widen access. Kubernetes ServiceAccount RoleBindings alone do not authorize this endpoint.

**Token response shape:**

```json
{ "provider": "gitlab", "token": "glpat-...",      "url": "https://gitlab.myco.com" }
{ "provider": "github", "token": "github_pat_...", "url": "https://github.com" }
{ "provider": "jira",   "token": "ATATT3x...",     "url": "https://myco.atlassian.net", "email": "bot@myco.com" }
{ "provider": "google", "token": "{\"type\":\"service_account\", ...}" }
```

`token` is always present. `url` and `email` are included when set on the Credential. The runner maps each response to environment variables and on-disk files consumed by Claude Code and its tools.

### Environment Variables Set by Runner After Credential Fetch

| Provider | Env vars set | Files written |
|----------|-------------|---------------|
| `google` | `USER_GOOGLE_EMAIL` | `credentials.json` (token value is full SA JSON) |
| `jira`   | `JIRA_URL`, `JIRA_API_TOKEN`, `JIRA_EMAIL` | — |
| `gitlab` | `GITLAB_TOKEN` | `/tmp/.ambient_gitlab_token` |
| `github` | `GITHUB_TOKEN` | `/tmp/.ambient_github_token` |

### Additional Environment Variable Injected by CP

| Var | Value | Purpose |
|-----|-------|---------|
| `CREDENTIAL_IDS` | JSON map `{provider: id}` | Resolved credential IDs for this session; runner uses to call `/credentials/{id}/token` |

Status: ✅ implemented — Credential Kind live (PR #1110); CP integration pending (Wave 5)

---

## Sandbox Snapshot Collection

The CP persists sandbox logs and policy to the API server's sessions table so they survive sandbox shutdown. This enables the UI to display historical sandbox data for stopped sessions, matching the pattern used for chat message history.

### Policy Extraction (every 15s — zero additional cost)

`PodStatusSyncer.syncSandboxStatus()` already calls `GetSandbox` on each 15s sync cycle. Policy is extracted from the existing response using exported helpers in `internal/openshell/sandbox_helpers.go`:

- `SandboxPhaseString(phase)` — converts proto phase enum to human-readable string
- `PolicyToMap(policy)` — converts proto policy to a JSON-serializable map

The policy envelope is JSON-marshaled and included in the `UpdateStatus` patch as `sandbox_policy_snapshot`. No additional network calls.

### Log Fetch (every 15s)

After policy extraction, the CP calls `GatewayClient.FetchSandboxLogs()` — a method that wraps `WatchSandbox` with `FollowLogs: false, LogTailLines: openshell.LogTailLines` (500). This returns a bounded snapshot of the most recent log entries as a JSON array matching the SSE log format. The result is included in the same `UpdateStatus` patch as `sandbox_logs_snapshot`.

The tail line count is defined as the exported constant `openshell.LogTailLines` to keep it consistent across the periodic syncer and pre-delete final snapshot.

### Pre-Delete Final Snapshot

In `deprovisionSessionSandbox()`, a final snapshot of both logs and policy is taken **before** `DeleteSandbox` is called. This guarantees the stored data matches the live SSE stream for normal stop flows:

```
deprovisionSessionSandbox():
    1. Resolve gateway namespace
    2. Compute sandbox name
    3. GetSandbox → extract policy snapshot     ← NEW
    4. FetchSandboxLogs → extract log snapshot   ← NEW
    5. UpdateStatus with both snapshots          ← NEW
    6. DeleteSandbox                             (existing)
    7. UpdateSessionPhase                        (existing)
```

For abnormal termination (sandbox crash without `deprovisionSessionSandbox`), the most recent periodic snapshot (at most 15s stale) serves as fallback.

### Error Handling

Snapshot errors (gateway unreachable, gRPC timeout, policy marshal failure) are logged at WARN/DEBUG level and never block the status sync or sandbox deletion. The periodic 15s snapshots provide redundancy — a failed final snapshot still has the recent periodic data as fallback.

`FetchSandboxLogs` returns both partial data AND the error when the stream fails mid-read. Callers log the error and persist whatever entries were collected, so partial snapshots are never silently dropped. When the stream errors before any entries are received, only the error is returned.

### Shared Helpers

`internal/openshell/sandbox_helpers.go` exports shared functions used by both the token server and the reconciler:

- `SandboxPhaseString(phase)` — converts proto phase enum to human-readable string
- `PolicyToMap(policy)` — converts proto policy to a JSON-serializable map
- `BuildSnapshotPatch(sbx)` — builds the complete `UpdateStatus` patch map from a `*pb.Sandbox`, including the policy envelope with version, hash, status, source, config_revision, and policy fields. Returns `(patch, error)`. Both `snapshotSandboxData` (periodic sync) and `finalSandboxSnapshot` (pre-delete) call this shared helper to keep the envelope structure and field names in one place.
- `LogTailLines` — exported constant (`500`) for the log tail line count

Both `tokenserver` and `reconciler` import `openshell`, so no import cycles are introduced.

Status: ✅ implemented

---

## Namespace Deletion RBAC Gap

The CP's `cleanupSession` calls `kube.DeleteNamespace()`. This currently fails in kind with:

```
namespaces "bond" is forbidden: User "system:serviceaccount:ambient-code:ambient-control-plane" cannot delete resource "namespaces" in API group "" in the namespace "bond"
```

The `ambient-control-plane` ServiceAccount does not have `delete` on `namespaces` at cluster scope. The namespace is left behind after session cleanup.

**Proposed fix:** Add a ClusterRole with `delete` on `namespaces` and bind it to `ambient-control-plane` SA in the deployment manifests.

---

## Design Decisions

| Decision | Rationale |
|---|---|
| CP provisions Pods, not Jobs | Sessions are single-run; operator-style Job retry semantics don't apply |
| Rich API producer owns bootstrap when available | The producer has the full Agent-start context and can persist the human task before one authoritative bootstrap; CP consumes its sequence instead of reconstructing a second input |
| CP seals Gateway compatibility bootstrap | For a Gateway fresh Session with zero bootstrap and non-empty prompt, CP conditionally ensures the singleton before payload upload, `Running`, or `ExecSandbox`, then hands the returned sequence to the Runner |
| Metadata snapshot is the startup authority | `bootstrap_count`, `max_seq`, and bounded `bootstrap_seqs` come from one database snapshot; missing or inconsistent metadata never degrades to zero history |
| Runner fallback is operator/CreateSession-only | Trusted launch configuration and signed exact-Session capability prove the lane without a new Session field; API revalidates `Pending`/`Creating`, absent `start_time`, and absent `sdk_session_id` |
| Exact-Session capabilities layer on service auth | Resolve, ensure, and refresh purposes are distinct; a token cannot cross Session, audience, purpose, or endpoint boundaries, and the Runner never receives signing material |
| `WatchSessionMessages` starts from `bootstrap_seq - 1` | The exclusive cursor delivers the bootstrap while excluding the earlier transcript-only task row; reconnect advances to the accepted sequence |
| Resume never republishes bootstrap | `IS_RESUME` plus `RESUME_AFTER_SEQ` skips historical startup input and keeps restart separate from fresh bootstrap selection |
| `MESSAGES_SNAPSHOT` as the assistant accumulator | Claude Agent SDK emits periodic full snapshots; last snapshot before RUN_FINISHED is the complete turn |
| SSE tap via `_active_streams` dict | Zero-copy fan-out from listener loop to any subscribed HTTP client; no additional gRPC round-trip |
| assistant payload → plain string | Symmetric with user payload; reasoning is observability data not conversation record |
| GET /events is runner-local | Runner has the event queue; api-server proxies it; no second fan-out layer needed |
| Namespace per project, not per session | Sessions within a project share a namespace; secrets and RBAC are project-scoped |
| CP token endpoint over Secret-write renewal | Secret writes are async push with no synchronization guarantee vs. token TTL; synchronous pull from CP eliminates the race entirely |
| Mode-separated Runner authentication | Direct/Operator uses pod-bound TokenReview plus refresh. Gateway uses only Providers v2 SPIFFE `token_grant`; ACP validates the JWT-SVID at `/oauth2/sandbox-attestation`, returns a short attestation, and OpenShell injects it only into HTTP/1.1 `/token`. Gateway Runner receives no identity, refresh, ensure, key, or attestation, and no request can relax the fixed mode boundary |
| CP is sole Session-scoped token source | No `BOT_TOKEN` Secret or global bearer fallback; initial startup and reconnect both use the exact-Session refresh exchange |
| `system:image-builder` bound to session SA at provision time | The binding establishes registry RBAC authorization only. Automount remains disabled for Direct/Operator and every mode's control-plane-trust-domain identity is never agent-visible or valid for registry authentication; agent-initiated pushes require a separate scoped credential broker outside Todo11 |
| 15-second grace period for sandbox `ERROR` during creation | Sandbox provisioning can hit transient errors that resolve on their own. Immediately failing the session on first `SANDBOX_PHASE_ERROR` causes unnecessary session failures. Both the provisioning poller and the status syncer enforce the same grace period to prevent one from short-circuiting the other |
| Sandbox snapshots in PostgreSQL, not a log store | Snapshots are bounded (500 lines), session-scoped, and low-frequency (15s writes). PostgreSQL handles this without a new dependency. A dedicated log store would be appropriate for unbounded historical search, not for session-scoped snapshots |
| Pre-delete final snapshot before `DeleteSandbox` | Periodic 15s snapshots provide good coverage, but the final state is most valuable for post-mortem. Fetching before delete guarantees stored data matches the live stream |
| Snapshot errors logged, partial data preserved | Snapshot collection must never block status sync or sandbox deletion — it is best-effort. `FetchSandboxLogs` returns partial data with the error so callers can persist whatever was collected. Periodic snapshots provide redundancy for failed final snapshots |
| Gateway as API resource, not ConfigMap | Gateway configuration lives in PostgreSQL as `kind: Gateway`, applied via `acpctl apply -k`. The complete sorted desired Gateway set is delivered only through the exact Project runtime projection selected by the desired-work feed; the operator acknowledges the same recomputed generation without generic list/update authority. |
| ProjectReconciler owns namespace lifecycle | Project = Namespace. The ProjectReconciler creates namespaces; the GatewayReconciler deploys gateways into existing namespaces. No ConfigMap needed to declare which namespaces exist |
| Shared kustomize library | The rendering engine from `acpctl apply` is extracted into a shared library consumed by both the CLI and the ApplicationReconciler, enabling unit testing without a running cluster |

---
