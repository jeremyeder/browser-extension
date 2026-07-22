# Skills Directory and Reconciliation Checkpoint

<!-- markdownlint-disable MD013 MD060 -->

This file is the durable checkpoint for spec-to-code reconciliation. The
`/reconcile` skill reads it before discovery, updates it after each verified
wave, and uses the gap IDs below as the implementation ledger.

## Reconciliation State

- **Last analyzed:** 2026-07-18
- **Codebase commit:** `04c3f3849923a9681aba89254b1215834e30a1da` plus the
  explicitly reviewed dirty-worktree changes recorded below
- **Working tree:** intentionally dirty with the approved Enterprise Assistant
  spec, evidence, and Kind-tooling work; no commit or push is authorized
- **Registry:** 38 specs in `specs/index.spec.md`
- **Active scope:** the five specs under
  `specs/platform/enterprise-assistant/`, `specs/ui/browser-extension.spec.md`,
  and their direct platform/security/runtime dependencies
- **Active requirement count:** 64 (`45` Enterprise Assistant and `19` Browser
  Extension requirements)
- **Current milestone:** provisioning-only, memoryless Artoo; managed chat is the
  immediate next wave and Hindsight-backed managed memory follows it
- **Open implementation packages:** 36 (`27` missing, `9` partial)
- **Divergences requiring a user decision:** 0

The package count is not a claim that each package maps one-to-one to a spec
requirement. A requirement is present only when every field, transition,
authorization rule, and verification gate is implemented. The done rows below
are bounded to the API and browser contracts their cited gates actually prove;
they are not a claim that managed Start, chat, memory, or deployment is ready.

### Verified Foundations

- The declarative Artoo bundle is frozen at
  `sha256:0014ddedf3b60576e5e32cc640759c332eb27bbf84e72fad4121fc13caae0def`.
- The declarative managed-memory bundle is frozen at
  `sha256:4ed8f3239bcf2acd84ff000f6a686bfb07e1f2c46833d5169ec3e7a0680479e8`.
- Both declarative bundle builders, validators, and negative suites pass.
- The five Enterprise Assistant specs are registered and dependency-acyclic.
- The PostgreSQL provisioning journey proves absent self-state, exact preview,
  conditional Artoo creation in one transaction, authoritative final GET and
  strong ETag continuity, with zero Sessions, messages, schedules, snapshots,
  leases, memory attachments, memory outbox rows, or runtime side effects.
- Browser source tests prove strict self GET/preview/PUT decoding, no Project
  header, authoritative rediscovery, accessible Start/Skip, bounded stale/lost
  recovery, persistent truthful Artoo memory copy, and non-destructive Customize
  while ordinary Sessions remain reachable.
- Focused built-by-QA packaged mock proof passes for Skip, including exact request
  choreography, all Enterprise Assistant rollups, 14 allowlisted captures, zero
  page/worker errors, and observer counts of zero Sessions, workloads, and memory
  attachments. Its summary is not release-prebuilt evidence, so the full release
  evidence row remains partial.
- Browser release/evidence schemas, sanitization, run-owned cleanup, and
  fail-closed live-input scaffolding exist; no live Enterprise Assistant
  deployment or live managed-chat acceptance is recorded.
- Hindsight 0.8.4 is healthy as a standalone local Docker service, but ACP has no
  production adapter registration, private route, Kubernetes deployment, or
  attachment connecting it to Artoo. Its health is not ACP composition evidence.
- Existing exact-Session bootstrap/capability paths, generic OpenShell provider
  reconciliation, transactional Session startup, persistent browser chat, and
  deterministic package machinery are reusable foundations.
- The existing control-plane-issued Session runtime JWT is exact-Session and
  accepted by the gRPC session stream only. It is not the per-Session OIDC
  `client_credentials` identity required by the ordinary HTTP Credential token
  path and must not be treated as one.
- Kind selection and reload commands are exact-context scoped; ten Makefile
  contract tests pass.

## Dependency Order

```text
immutable bundles
  -> canonical human identity and managed persistence
  -> managed-set mutation guard
  -> public self API and strict HTTP boundary
  -> canonical state, preview, and conditional PUT
  -> generated SDKs and transport metadata
  -> Start snapshot, internal outbox, and service authorization
  -> control-plane provider/memory reconciliation
  -> Gateway-shared managed inference and exact-Session managed-memory proxies
  -> browser discovery, onboarding, and customization
  -> protected Kind bootstrap and end-to-end proof
```

## Gap Table

Status values are `missing`, `partial`, and `done`. Completed rows move to the
history section only after their verification gate passes.

### API and Persistence

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-API-001 | done | Persist exact OIDC issuer plus opaque subject identity, tombstoned aliases, human-only self resolution, and canonical `GET /users/me`; migrate mutable-username RoleBindings fail closed. | - | Identity concurrency, tombstone, actor-class, and legacy migration tests |
| EA-API-002 | done | Public self GET, preview POST, and conditional PUT routes have exact closed DTOs, operation IDs, headers, statuses, and route ordering before `/{id}`. | API-001 | OpenAPI validation, generated API models, route tests |
| EA-API-003 | done | The 16 KiB strict JSON/media/header boundary, deterministic error precedence, stable error codes, redaction, and no-store response policy are implemented. | API-001 | Malformed-body/header/error matrix |
| EA-API-004 | done | Add managed designation, config, attachment, outbox, snapshot, lease, repair/audit, runner type, and identity migrations with all DB invariants. | API-001 | Empty/legacy migrations, constraint and rollback tests |
| EA-API-005 | done | The canonical managed-set loader, conflict classification, RFC 8785 preview/state digests, strong ETags, and transformed public DTOs are implemented. | API-004, DEP-001 | Golden canonicalization, drift/cardinality, GET-no-write tests |
| EA-API-006 | done | Pure preview and one-transaction advisory-locked conditional PUT cover Project, ownership, Provider, entitlement, Agent, config, and optional memory intent. | API-002..005, API-007 | Concurrency, rollback, retry, stale intent, memoryless Skip tests |
| EA-API-007 | done | Add a persisted-state managed-set guard across generic CRUD, transfer, RoleBindings, bulk, CLI apply, and Application sync/prune. | API-004 | All alternate-writer denial tests; ordinary resources unchanged |
| EA-API-008 | missing | Add the private step-up, CAS, idempotent, audited break-glass repair API outside public OpenAPI and SDKs. | API-004, API-005, API-007, SEC-004 | JWT profile, replay, action allowlist, audit, redaction tests |
| EA-API-009 | missing | Add internal outbox claim/heartbeat/ack with authenticated worker binding, persisted current lease attempt, sealed handles, generation fencing, retry, and replay semantics. | API-004, RUN-004 | Multi-worker, crash/reclaim, stale worker, supersession tests |
| EA-API-010 | partial | Extend transactional Agent Start to revalidate managed state and atomically create Session, immutable launch snapshot, and optional memory lease. | API-004..006, API-009, RUN-005 | Race, rollback, memory readiness, postcommit failure tests |
| EA-API-011 | missing | Overlay exact owner equality and non-disclosure on every managed Agent/Session operation, preserving exact-Session runtime authority only. | API-001, API-004, SEC-003 | Delegation/admin/list/read/action denial matrix |
| EA-API-012 | partial | The focused PostgreSQL Artoo provisioning journey and API/OpenAPI/HTTP gates pass; full managed Start, runtime, memory, generated-artifact, and live integration coverage remains. | API-001..011 | Focused unit, Postgres, concurrency, drift suites |

`EA-API-004` will persist `locked_by_instance` and a current lease-attempt or
nonce fingerprint (or an equivalent separate lease row). This is required to
reject a still-valid prior worker after reclaim and is an internal storage
detail, not a public-contract divergence.

### SDK and Generation

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-SDK-001 | missing | Add the referenced Enterprise Assistant OpenAPI fragment with exact DTOs, enums, nullability, conditional headers, response headers, and operation IDs. | API-002, API-003 | Bundle/validate OpenAPI and generated API model drift |
| EA-SDK-002 | missing | Make the generator operation-first and recursively faithful to refs, objects, arrays, enums, required/null, request headers, statuses, and response headers. | SDK-001 | Parser fixtures for all three operations |
| EA-SDK-003 | missing | Add route-specific no-project-header transport, conditional headers, 200/201 handling, response metadata, ETag, Retry-After, and no-store semantics in Go/Python/TypeScript. | SDK-001 | Cross-language mock transport tests |
| EA-SDK-004 | missing | Generate typed singleton get, preview, create, and update clients with strict response decoders. | SDK-002, SDK-003 | Go/Python/TypeScript contract tests |
| EA-SDK-005 | missing | Encode every generated path segment independently in all clients. | SDK-002 | Traversal/query/Unicode table tests |
| EA-SDK-006 | missing | Add a private control-plane-only outbox client with mTLS and purpose/audience-bound credentials; do not generate a repair client. | API-009, SEC-004 | Lease, 204, redaction, and auth tests |
| EA-SDK-007 | missing | Generate into clean temporary trees, prune stale output, remove nondeterminism, build/test all SDKs, and compare clean-tree drift. | SDK-002..005 | CI drift plus all language builds/tests |

### Security and Generic-Path Boundaries

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-SEC-001 | done | Replace mutable username authority with canonical issuer/subject identity throughout REST, gRPC, RBAC, and admin seeding. | API-001 | Identity and legacy-binding matrix |
| EA-SEC-002 | done | Enforce one central persisted-state managed-set guard across every generic and GitOps writer. | API-004, API-007 | Forgery, omission, transfer, apply, sync, prune tests |
| EA-SEC-003 | missing | Require owner equality and opaque non-disclosure for managed reads, lists, starts, messages, lifecycle actions, schedules, and delegation. | SEC-001, SEC-002, API-011 | Owner/non-owner/global-admin matrix |
| EA-SEC-004 | partial | Shared deny-by-default registry now owns fixed runtime-binding, runtime-bootstrap, status, project-runtime, and gRPC bootstrap-ensure tuples; generic service/admin enrichment denies. Complete the selector-bearing discovery/work feeds and remaining operation conversions below. | API-004 | Deny-unregistered, stolen-token, target/generation, and HTTP/gRPC parity tests |
| EA-SEC-005 | missing | Protect internal RoleBindings, managed credential designations, token access, and provider material from every human/generic surface. | SEC-002, SEC-004 | Binding/designation/token isolation tests |
| EA-SEC-006 | missing | Reject generic Session mutation, clone/replay, and `/model` switching for Enterprise snapshots while preserving ordinary Session behavior. | API-004, API-010, SEC-003 | Immutable-snapshot mutation matrix |
| EA-SEC-007 | missing | Implement the sole audited repair authority and keep it absent from public OpenAPI, SDK, CLI, browser, MCP, and generic proxy paths. | API-008, SEC-001..005 | Boundary absence and step-up repair tests |

#### EA-SEC-004 residual operation packages

- Replace selector-free Session, Project, and ProjectSettings HTTP initial lists
  and gRPC watches with server-issued assignment/work feeds carrying exact target
  IDs and desired generations. Generic list/watch authorization remains absent
  and fail closed; the exact Project projection is not a discovery grant.
- Thread authoritative workload generation through every PodStatusSyncer and
  remaining Session status call, remove all fallback public status PATCHes, and
  preserve active-generation ordering through startup failure and terminal
  revocation.
- Move message-state resolve under its own exact-Session
  `internal:session-bootstrap-resolve` registry alias. Bootstrap ensure is now a
  registered exact gRPC operation; Runner fallback must remain a distinct
  session-runtime identity and purpose.
- Add a deployed `ambient-operator` OIDC client and token provider before wiring
  project-runtime reconciliation. Include declared Gateway desired state and a
  generation-fenced acknowledgement operation; do not authorize generic Gateway
  list/update. Owner/admin RoleBinding reconciliation requires immutable
  server-derived authority and must not consume mutable Project annotations.
- Remove dormant generic startup reads for Provider, Policy, RoleBinding,
  Credential, Project, Agent, and Inbox after projection-only conformance proves
  them unreachable.
- Separate the Application reconciler's Agent/Application CRUD into a specified
  controller identity and closed operation contract; it is not authorized by
  `internal:project-runtime-reconcile`.

### Control Plane, Runner, and Managed Memory

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-RUN-001 | done | Vendor/embed and independently verify immutable Artoo and managed-memory registries and bundles. | - | Digest, tamper, revision, historical-byte tests |
| EA-RUN-002 | done | Persist immutable snapshots, attachments, leases, provider resource sets, outbox events, and versioned capability context. | RUN-001, API-004 | Migration, FK, uniqueness, immutability tests |
| EA-RUN-003 | missing | Atomically revalidate Start and commit separate system/user instruction channels plus optional lease. | RUN-001, RUN-002, API-010 | Race, rollback, byte-exact snapshot tests |
| EA-RUN-004 | missing | Implement protected backend registration, control-plane outbox worker, vendor-neutral provider SPI, and Hindsight adapter. | RUN-001, RUN-002, API-009, SDK-006 | Claim/ack, crash, idempotency, adapter conformance |
| EA-RUN-005 | missing | Reconcile the managed Vertex route at the accepted Gateway trust boundary, with every Sandbox on that Gateway permitted to use it, while preserving exact-Session ACP runtime identity and preventing raw Credential exposure. | RUN-002, RUN-003, SEC-004, SEC-005 | Same-Gateway use, other-Gateway denial, rotation, readback, cleanup, no-secret tests |
| EA-RUN-006 | missing | Make the control plane consume and project only the immutable launch snapshot. | RUN-002, RUN-003, RUN-005 | Mutation race, mismatch, private-path tests |
| EA-RUN-007 | partial | Complete persistent Gemini runtime support in the OpenShell image with pre-import validation, privileged system bytes, lower-priority user context, and gRPC turns. | RUN-006 | Image, channel separation, reconnect/turn tests |
| EA-RUN-008 | missing | Add reserved supervisor-private `managed-memory` MCP proxy and exact-Session retain/recall/reflect routes with durable retain ordering. | RUN-004, RUN-006, RUN-007 | Collision, lease, dedupe, bounded-schema tests |
| EA-RUN-009 | missing | Revoke providers/routes/leases and drain or garbage-collect attachments idempotently across stop/fail/delete/timeout. | RUN-004, RUN-005, RUN-008 | Lifecycle, expiry, active-lease GC tests |
| EA-RUN-010 | missing | Provision and revoke a cryptographically unique per-Session OIDC `client_credentials` identity for ordinary Credential injection, bind its exact verified subject only to the resolved credential-scoped `credential:token-reader` rows, and deliver the bearer only to that exact workload. Until this exists, ordinary runtime Credential grants remain fail closed; the control-plane Session runtime JWT is not accepted as a substitute. | SEC-004, SEC-005 | Client create/token/subject binding, HTTP token fetch, cross-Session denial, expiry, failed-start and terminal revocation tests |

#### EA-RUN-005/006 accepted Gateway-shared inference boundary

On 2026-07-18 the user explicitly accepted OpenShell v0.0.82's Gateway as the
managed inference trust boundary. `SetClusterInference` configures one
gateway-scoped `inference.local` provider/model route, and every Sandbox using
that Gateway may use the route. An exact-Sandbox OpenShell API, downstream fork,
or upstream patch is therefore not a prerequisite for the managed-chat wave.

This decision changes inference-route isolation only. Exact-Session ACP runtime
identity, immutable launch snapshots, canonical owner checks, workload
generation fencing, and exact-Session managed-memory leases/routes remain
required. The raw managed Vertex Credential still cannot enter a Runner, Agent,
model, environment, file, tenant Secret, or generic Provider fanout.

Production managed Start remains fail closed today because the API server has no
production preflight implementation and the control plane still rejects the
gateway-scoped managed projection. ACP must implement downstream Gateway
configuration, effective readback, designation rotation, and idempotent cleanup,
then prove same-Gateway use and other-Gateway denial before managed chat is
enabled. The canonical inference lifecycle, template, identity, and sandbox
specs still describe exact-Session inference isolation and must be amended in the
next spec wave before that implementation can be marked compliant.

### Browser Extension

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-BE-001 | partial | Rename runtime/package surfaces to Enterprise Assistant while retaining old names only as explicit migration inputs/evidence. | - | Exact archive allowlist, reproducible ZIP, bounded legacy-name scan |
| EA-BE-002 | done | Strict self GET/preview/PUT client validators, ETag/Location handling, stable errors, and no Project header are implemented. | API-002, SDK-001 | Closed fixture and network-header tests |
| EA-BE-003 | done | Generated discovery uses authoritative self GET while explicitly manual legacy bindings remain distinct. | BE-002 | Cross-profile, 404/409, malformed/current-Session tests |
| EA-BE-004 | partial | Add scoped Enterprise cache/draft/startup storage and interrupt-safe per-key legacy migration; server remains sole setup/memory authority. | BE-002, BE-003 | Interruption, corruption, conflict, cross-scope tests |
| EA-BE-005 | done | Accessible Start and blue-text Skip use single-flight preview, conditional PUT, authoritative GET, bounded stale recovery, and create no Session, workload, or memory attachment. | BE-002, BE-003, API-006 | Responsive DOM, focus, request sequence, side-effect tests |
| EA-BE-006 | partial | Drive customization/review from server schema/state, render Artoo defaults, dispositions/instructions/memory, and update non-destructively with ETag. | BE-002, BE-003, BE-005 | Schema form, preview, cancellation, failure tests |
| EA-BE-007 | partial | Render persistent truthful setup/memory status, Artoo memory boundary, customization restart, and future-Session gating without disabling active Sessions. | BE-002, BE-003, BE-006 | Readiness by active-Session state matrix |
| EA-BE-008 | partial | Implement mock/live Enterprise QA assertions, exact screenshots/digests, extension-owned discovery proof, and release evidence. | BE-001..007, live API | Node 24 packaged mock/live QA and release gate |

### Deployment and Integration

| ID | Status | Gap | Dependencies | Primary verification |
|---|---|---|---|---|
| EA-DEP-001 | done | Add a build-independent shared embedded asset package for both immutable bundles and exact compiled digests. | - | Both binaries build without sibling repo; tamper tests |
| EA-DEP-002 | missing | Implement the concrete Hindsight adapter behind `managed-memory-provider-v1`. | RUN-004 | Fake-backend SPI contract suite |
| EA-DEP-003 | missing | Add internal-only Hindsight Deployment/Service, protected config, storage, auth, probes, metrics, and NetworkPolicy overlays. | DEP-002 | Kustomize, auth, health, isolation tests |
| EA-DEP-004 | missing | Keep invalid registration/bundle/backend health feature-scoped so Artoo and ordinary ACP stay healthy. | DEP-001, RUN-004 | Fault/recovery tests without process restart |
| EA-DEP-005 | missing | Add idempotent protected Kind bootstrap for managed Vertex designation and backend registration on the exact Kind context. | API-008, DEP-003 | First-run/rerun/rotation/ambiguity tests |
| EA-DEP-006 | missing | Update amd64 image build/load/reload/release paths and bundle-consumer rebuild triggers. | DEP-001, DEP-003 | Make contracts, image architecture, release matrix |
| EA-DEP-007 | missing | Add sanitized Kind integration proof for memoryless Artoo, one/two-facet memory, tools, leases, disable/drain/cleanup, and failure isolation. | all prior waves | End-to-end assertions with no private identifiers/content |

The healthy standalone Hindsight 0.8.4 container does not change
`EA-DEP-002`, `EA-DEP-003`, `EA-DEP-005`, or `EA-DEP-007`: none has an ACP
adapter registration, protected route, manifest, attachment, or live proof.

## Execution Waves

The user approved autonomous execution. A wave may fan out internally, but the
next wave starts only after the current wave's contract gates pass.

### Wave 1: Immutable Assets and Data Authority

`EA-DEP-001`, `EA-RUN-001`, `EA-API-001`, `EA-API-004`, `EA-API-007`,
`EA-SEC-001`, `EA-SEC-002`, `EA-RUN-002`

Gate: bundle tamper suites, migrations on empty and representative legacy data,
identity concurrency/migration tests, managed-writer denial tests, component
format/lint/build, and `git diff --check`.

### Wave 2: Public Composite Contract and SDKs

`EA-API-002`, `EA-API-003`, `EA-API-005`, `EA-API-006`, `EA-SDK-001` through
`EA-SDK-005`, `EA-SDK-007`

Gate: OpenAPI bundle/generation drift, strict HTTP matrix, canonicalization
goldens, transactional retry/concurrency tests, and all three SDK suites.

### Wave 3: Internal Authority and Runtime Projection

`EA-API-008` through `EA-API-011`, `EA-SDK-006`, `EA-SEC-003` through
`EA-SEC-007`, `EA-RUN-003` through `EA-RUN-006`, `EA-RUN-010`, `EA-DEP-002`,
`EA-DEP-004`

Gate: repair/outbox/service-operation boundaries, Start transaction races,
Gateway-scoped inference with exact-Session ACP identity, control-plane
conformance, and feature-scoped failure tests.

### Wave 4: Runner, Managed Memory, and Images

`EA-RUN-007` through `EA-RUN-009`, `EA-DEP-003`, `EA-DEP-006`

Gate: Gemini persistent-turn tests, privilege-channel tests, MCP collision and
lease tests, Hindsight fake/live adapter tests, Kustomize validation, and amd64
image inspection.

### Wave 5A: Provisioning-Only Browser Product Surface

Close the remaining package, exact-artifact mock, visual, evidence, and release
gates for the memoryless Artoo provisioning surface. Managed chat and Hindsight
are explicitly outside this sub-wave.

Gate: Node 24 component suite, exact package contract, responsive light/dark
manual/visual QA, packaged mock QA, sanitized evidence validation, and release
contract.

### Wave 5B: Memoryless Managed Chat

Amend the canonical inference-isolation requirements for the accepted
Gateway-shared trust boundary, then implement `EA-RUN-003`, `EA-RUN-005`,
`EA-RUN-006`, the managed Start subset of `EA-API-010`, and the browser
composer/session path. Hindsight is not a prerequisite. Keep managed Start fail
closed until Gateway configuration and readback are proven.

### Wave 5C: Hindsight-Backed Managed Memory

After managed chat works without memory, implement the Hindsight adapter,
protected registration and deployment, exact-Session memory routes and leases,
then enable the memory-on browser states. Gateway-shared inference does not
weaken exact-Session managed-memory isolation.

### Wave 6: Protected Kind Integration

`EA-DEP-005`, `EA-DEP-007`, `EA-API-012`

Gate: exact-context protected bootstrap, memoryless and memory-enabled live
flows, retain/recall/reflect, lifecycle cleanup, failure isolation, full focused
component suites, `/align`, and ACP review guidance.

## Divergences

No unresolved user decision remains. The accepted 2026-07-18 divergence is that
managed inference is Gateway-scoped: every Sandbox on the configured Gateway may
use the same managed Vertex provider route. This supersedes the earlier
exact-Sandbox OpenShell dependency but does not weaken exact-Session ACP identity
or managed-memory isolation. The affected inference requirements in
`templates-and-customization.spec.md`, `lifecycle.spec.md`,
`identity-and-provisioning.spec.md`, `identity-boundaries.spec.md`, and
`agent-sandbox-config.spec.md` require an explicit spec amendment before Wave 5B
can be called compliant.

## History

| Date | Commit | Event |
|---|---|---|
| 2026-07-18 | worktree | Provisioning-only Artoo milestone: focused PostgreSQL absent/preview/conditional-create/final-GET journey and API/OpenAPI/HTTP gates pass; browser self client, authoritative discovery, Start/Skip, memory-boundary copy, and non-destructive Customize pass source tests; focused built-by-QA packaged Skip proof passes with zero runtime/memory side effects. Release-prebuilt acceptance, live deployment, managed chat, and Hindsight attachment remain open. Accepted Gateway-shared managed inference as the next-wave boundary. |
| 2026-07-17 | worktree | Wave 1 complete: immutable assets, canonical identity, managed persistence/snapshots, fail-closed managed-set guard, and Kind identity/tooling gates verified. Open packages 50 -> 42. |
| 2026-07-17 | `04c3f384` | Replaced the stale Personal Assistant checkpoint with the approved Enterprise Assistant/Artoo scoped dry-run: 50 dependency-ordered open packages, 0 divergences. |

## Local Artifact Policy

Plans, reviews, and `docs/superpowers/**` are local-only and must never be
staged or committed. Reconciliation changes may update this checkpoint, but no
commit or push is performed without explicit user authorization.
