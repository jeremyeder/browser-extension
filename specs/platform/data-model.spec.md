# Data Model

**Date:** 2026-03-20
**Status:** Active desired-state contract
**Last Updated:** 2026-07-17 — extracted Enterprise Assistant identity,
provisioning, templates, managed agentic memory, and lifecycle into
`enterprise-assistant/`; retained canonical authenticated-self identity, opaque
RoleBinding subjects, immutable Agent-to-Session runtime selection, per-user
root-mediated vTeam coordinator and child Session lineage without introducing a
group-session entity, and an explicit no-warm-pool boundary; corrected desired
CP/Gateway bootstrap ownership, metadata-only snapshot resolver, fallback proof,
exact-Session capability profiles, key rotation, and legacy presentation
compatibility
**Previous:** 2026-07-08 — added `Policy` as supported kind in `acpctl apply` and Application sync; added `sandbox_policy`, `sandbox_template`, `entrypoint` to Agent apply fields; documented implementation gaps in acpctl apply resource struct
**Previous:** 2026-07-03 — added Agent sandbox fields (entrypoint, providers, payloads, environment, sandbox_template, sandbox_policy) for OpenShell gateway integration; split SessionMessage from new SessionEvent (comprehensive AG-UI event stream with compression); added Events API endpoints, gRPC protocol, storage model, compression strategy, migration plan
**Previous:** 2026-06-03 — added Application (GitOps continuous sync for agent fleets); addressed review feedback: credential_id FK for remote auth, RoleBinding escalation rules, prune safety, health status semantics, gitops role grantability, sync engine kind filtering
**Previous-2:** 2026-05-12 — migrate Credentials from project-scoped to global routes (`/credentials`); remove `project_id` from model, OpenAPI, and SDK; add drop-column migration; update coverage matrix
**Workflow:** *(merged into skills/build/full-stack-pipeline)* — implementation waves, gap table, build commands, run log
**Design:** `credentials-session.md` — full Credential Kind design spec and rationale

---

## Purpose

This specification defines Ambient's persistent resource model and the observable storage, read, write, authorization, compatibility, and migration contracts shared by API, control-plane, Runner, SDK, CLI, and UI consumers.

## Requirements

### Requirement: Bootstrap Message Metadata

The system SHALL expose one exact-Session, metadata-only bootstrap snapshot containing `session_id`, `bootstrap_count`, `max_seq`, and bounded `bootstrap_seqs`; it MUST fail closed when the snapshot is missing, inconsistent, ambiguous, or contains an invalid sequence.

#### Scenario: Resolve one authoritative bootstrap

- GIVEN one Session has exactly one positive bootstrap sequence not greater than its message maximum
- WHEN the authenticated control plane resolves bootstrap metadata for that exact Session
- THEN one database snapshot reports `bootstrap_count=1`, the exact `max_seq`, and that sequence in `bootstrap_seqs`
- AND the response contains no message payload, prompt, digest, transcript row, capability, or secret

#### Scenario: Reject inconsistent bootstrap metadata

- GIVEN a metadata result is missing a required field, has a count/list mismatch, has duplicate or unordered sequences, or has a sequence greater than `max_seq`
- WHEN a startup consumer validates the result
- THEN startup fails closed before payload delivery, readiness, `Running`, `start_time`, or model execution

### Requirement: Exact-Session Bootstrap Authorization

Bootstrap resolve and ensure operations SHALL require service authentication plus a short-lived capability for the exact Session, audience, and purpose. Direct/Operator runtime-token renewal SHALL require a separately signed exact-Session refresh credential with immutable `workload_mode` and `origin`; Gateway renewal SHALL require only the short Providers v2-injected ACP workload attestation and live binding. Neither mode may return global authority or signing material.

#### Scenario: Idempotently ensure a fresh bootstrap

- GIVEN an eligible pre-execution Session has no bootstrap and an authenticated authorized producer has one non-empty payload
- WHEN the producer conditionally ensures that payload and receives an indeterminate acknowledgement
- THEN at most one same-Session, same-payload recovery request returns the single positive bootstrap sequence
- AND no second bootstrap row is appended

#### Scenario: Reject cross-session or malformed authority

- GIVEN a missing service identity, wrong Session, wrong audience or purpose, expired artifact, malformed token, duplicate claim, unknown key, or ineligible Session phase
- WHEN a caller resolves metadata, ensures bootstrap, or exchanges a refresh credential
- THEN the request is rejected without reading or mutating message content
- AND the error contains no token, claim value, payload, signature, or key material

### Requirement: Canonical Authenticated User Identity

The platform SHALL expose the authenticated caller's canonical opaque `User.id`
through generic `GET /api/ambient/v1/users/me`, persist a unique immutable OIDC
issuer-plus-subject mapping for every human User, and use that opaque ID as the
canonical `RoleBinding.user_id` subject. The identity key is the composite of the
exact validated issuer string and exact opaque `sub`, stored and compared
byte-for-byte. The server SHALL perform no trimming, case folding, URL
normalization, trailing-slash changes, URL decoding, or Unicode normalization on
either component. Username, email, `preferred_username`, display claims, bearer
bytes, and either component alone SHALL never select, merge, or authorize a User.

The issuer-plus-subject composite SHALL be unique across all active and
soft-deleted User rows. A deleted row remains a tombstone that reserves the exact
composite permanently; later authentication SHALL fail closed for administrative
recovery rather than create a new User or reassign its former authority. In this
data model, any identity field or record described as `normalized` means its
closed shape was validated and stored as the canonical record. It SHALL NOT mean
that issuer or `sub` string bytes were transformed.

For migration only, `User.legacy_username` SHALL be nullable, case-sensitive,
unique across all User rows including soft-deleted rows, immutable once populated,
and never reusable after deletion. It MAY be backfilled only by an audited
administrator job from an authoritative identity-directory export that also
proves the same User's exact validated issuer-plus-subject pair. It SHALL NOT be
populated or changed from an ordinary mutable login claim, email, or display
name; username changes do not change the alias. A soft-deleted match remains a
reserved tombstone and cannot authorize or be reassigned. The backfill,
tombstone, and uniqueness audit SHALL complete before legacy RoleBindings
authorize or Enterprise Agent self-service is enabled.

#### Scenario: Resolve the authenticated User exactly

- GIVEN one valid human OIDC credential's exact issuer-plus-subject composite
  maps to one active ACP User
- WHEN the caller requests `GET /api/ambient/v1/users/me`
- THEN the API returns that one User with its stable opaque `User.id`
- AND a human OIDC principal maps by byte-for-byte equality of its validated
  immutable issuer plus opaque subject rather than mutable username, email, or
  display claims
- AND token rotation or mutable profile fields do not change the ID
- AND an unauthenticated, missing, duplicate, or ambiguous principal mapping fails closed without returning another User

#### Scenario: Evaluate ownership with canonical User IDs

- GIVEN an authenticated principal maps to one canonical ACP User
- WHEN API or RBAC code creates, reads, or evaluates a user-scoped RoleBinding
- THEN `RoleBinding.user_id` stores and compares the opaque `User.id`
- AND principal-to-User resolution occurs server-side
- AND client-supplied usernames, email addresses, token claims, or external subjects cannot substitute for the canonical ID

#### Scenario: Migrate legacy username-valued bindings safely

- GIVEN an existing RoleBinding stores a legacy username-valued `user_id`
- WHEN canonical User-ID subject migration runs or compatibility resolution is required during rollout
- THEN exactly one active User match is required before the binding can authorize access
- AND the binding is rewritten idempotently to that User's opaque ID while preserving its role and resource scope
- AND a missing or multiple match leaves the binding unauthorized and reports an actionable migration failure
- AND mixed canonical and legacy rows cannot produce duplicate effective ownership
- AND a soft-deleted alias remains reserved, cannot authorize, and cannot be
  reused by another User
- AND an email- or display-claim-valued row is never treated as a legacy alias
  and remains unauthorized
- AND rollout backfills issuer-plus-subject mappings only from a verified authoritative identity source; missing or duplicate mappings block human self-provisioning without guessing from username or email

### Enterprise Assistant Platform Contract

Enterprise Agent identity and reserved provenance SHALL follow the
[Identity and Provisioning Specification](enterprise-assistant/identity-and-provisioning.spec.md).
Template, customization, setup-mode, and inference-provider behavior SHALL
follow the
[Templates and Customization Specification](enterprise-assistant/templates-and-customization.spec.md).
Managed memory state SHALL follow the
[Agentic Memory Specification](enterprise-assistant/agentic-memory.spec.md).
Backend registration, bundle, provider SPI, MCP proxy, and outbox behavior SHALL
follow the
[Managed-Memory Backend Specification](enterprise-assistant/managed-memory-backend.spec.md).
Preview, conditional provisioning, runtime, and discovery behavior SHALL follow
the [Lifecycle Specification](enterprise-assistant/lifecycle.spec.md). The
`User`, `Project`, `RoleBinding`, `Provider`, `Credential`, `Agent`, and
`Session` records remain the canonical ACP entities; no Enterprise Agent entity
or Session subtype is introduced.

#### Consumer Note: Canonical contract

- GIVEN a client previews, provisions, discovers, updates, or starts a generated Enterprise Agent
- WHEN it evaluates identity, ownership, annotations, provider entitlement, or conditional state
- THEN it follows the exact schemas, headers, status codes, and invariants in the Enterprise Assistant specifications
- AND a legacy manually selected Agent remains a client binding rather than generated server provenance

### Requirement: Enterprise Assistant Managed-Memory Persistence

Managed Enterprise Assistant state SHALL use typed server-owned records rather
than browser state, free-form Agent annotations, prompt content, or provider
metadata. These records are internal persistence contracts, not new public ACP
resource kinds:

#### `managed_credential_designations`

The protected managed inference designation SHALL be one singleton row with
exactly these fields:

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `logical_name` | string | primary key; exactly `enterprise-agent-default` |
| `credential_id` | string | nullable foreign key to `credentials.id`; null means revoked or unavailable |
| `generation` | unsigned integer | non-null; greater than zero; monotonically increasing |

<!-- markdownlint-enable MD013 -->

Only the allowlisted credential-designation actions in the
[Audited Administrative Break-Glass](enterprise-assistant/identity-and-provisioning.spec.md#requirement-audited-administrative-break-glass)
contract may initialize, rotate, revoke, or restore the singleton. Initialization
SHALL create only the absent row at generation one; normal Enterprise Assistant
provisioning SHALL never
create, delete, or select the designation. Rotation SHALL atomically replace `credential_id` and
increment `generation`; revocation SHALL atomically set `credential_id` to null
and increment `generation`; restoration SHALL select one active eligible
Credential and increment `generation` again. A failed transaction changes
neither field. The designation is unavailable when the row is absent, the
Credential is null, deleted, revoked, or ineligible, or the generation is
invalid. `Credential.name`, labels, annotations, creation order, and generic
list results are non-authoritative and SHALL NOT create or shadow the
designation. Preview, current-state digest construction, conditional PUT, and
Agent Start SHALL lock or recheck the exact generation they observed so that a
rotate-revoke-restore sequence cannot recreate an earlier authorized state by
ABA. The Session launch snapshot's non-secret provider context SHALL persist the
logical name, designation generation, and provider revision, never Credential
ID or material.

#### `enterprise_assistant_repair_operations`

The canonical repair endpoint SHALL persist one durable operation row before any
managed mutation or external cleanup:

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `operation_id` | string | primary key; server-generated opaque ID |
| `idempotency_key` | string | non-null; globally unique; 16..128 allowlisted ASCII characters |
| `operator_user_id` | string | non-null foreign key to the canonical active administrator User |
| `token_jti_hash` | bytes | non-null SHA-256; raw JWT and `jti` are not stored |
| `request_hash` | bytes | non-null SHA-256 of canonical closed request bytes |
| `schema_version` | string | exactly `1` |
| `action` | string | non-null member of the canonical break-glass action allowlist |
| `target` | JSONB | non-null closed action-specific target; no secrets or arbitrary patch |
| `expected_state_digest` | string | non-null lowercase SHA-256 descriptor |
| `reason` | string | non-null; 1..512 UTF-8 bytes |
| `ticket` | string | non-null; 1..128 UTF-8 bytes |
| `status` | string | `pending`, `succeeded`, `rejected`, or `failed` |
| `before_state_digest` | string | nullable lowercase SHA-256 descriptor |
| `after_state_digest` | string | nullable lowercase SHA-256 descriptor |
| `audit_event_id` | string | non-null unique immutable audit reference |
| `created_at` | timestamp | non-null |
| `completed_at` | timestamp | nullable |

<!-- markdownlint-enable MD013 -->

The operation row and append-only audit event SHALL contain no Credential ID
except the action's protected target, raw credential or memory content, token,
provider endpoint, upstream response, or reusable authority. A duplicate
idempotency key with the same operator and request hash returns the stored
operation; any other reuse is rejected. State mutation SHALL compare the stored
expected digest and target versions under one lock. External cleanup SHALL use a
durable outbox keyed by `operation_id` so a retry resumes work without repeating
a committed database mutation. The exact API, authentication, actions, target
shapes, and response are defined only by the
[canonical break-glass contract](enterprise-assistant/identity-and-provisioning.spec.md#requirement-audited-administrative-break-glass).

#### `enterprise_assistant_configs`

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `agent_id` | string | primary key; foreign key to active `agents.id` |
| `project_id` | string | non-null foreign key to `projects.id` |
| `user_id` | string | non-null foreign key to active `users.id`; unique |
| `setup_mode` | string | non-null; `starter` or `customized` |
| `normalized_customization` | JSONB | non-null; exact closed Enterprise Assistant customization object |
| `personal_enabled` | Boolean | non-null |
| `coding_enabled` | Boolean | non-null |
| `desired_generation` | unsigned integer | non-null; greater than zero; monotonically increasing |
| `created_at` | timestamp | non-null |
| `updated_at` | timestamp | non-null |

<!-- markdownlint-enable MD013 -->

The table SHALL additionally have a unique key on
`(user_id, project_id, agent_id)`. `project_id` MUST equal the Agent's Project,
and `user_id` MUST equal the canonical sole owner established by the dedicated
Project RoleBinding. A database trigger or equivalent transactionally enforced
constraint SHALL reject a mismatched or deleted owner, Project, or Agent.
`normalized_customization` SHALL be one object containing exactly
`display_name`, `custom_instructions`, and `dispositions`; `dispositions` SHALL
contain exactly `empathy`, `skepticism`, and `literalism`. Database constraints
SHALL reject missing, additional, null, or wrongly typed members and disposition
integers outside one through five. The application SHALL perform the template
contract's Unicode normalization, whitespace handling, and code-point limits
before the row enters the transaction, then persist and render only those
normalized values. Prompt parsing or annotation reversal SHALL never reconstruct
the object.

#### `managed_memory_attachments`

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `id` | string | primary key; opaque server-assigned ID |
| `user_id` | string | non-null foreign key to `users.id` |
| `project_id` | string | non-null foreign key to `projects.id` |
| `agent_id` | string | non-null foreign key to `enterprise_assistant_configs.agent_id` |
| `desired_generation` | unsigned integer | non-null; greater than zero |
| `version` | unsigned integer | non-null; greater than zero; monotonically increasing |
| `state` | string | `provisioning`, `ready`, `failed`, `draining`, `deleting`, or `retired` |
| `provider_reference_ciphertext` | bytes | nullable; protected opaque provider reference |
| `last_error_code` | string | nullable; allowlisted ASCII; at most 64 characters |
| `last_error_message` | string | nullable; sanitized; at most 512 UTF-8 bytes |
| `retryable` | Boolean | non-null; false when no failure exists |
| `retry_after` | timestamp | nullable |
| `created_at` | timestamp | non-null |
| `updated_at` | timestamp | non-null |
| `retired_at` | timestamp | nullable; present only for `retired` |

<!-- markdownlint-enable MD013 -->

The attachment SHALL have a composite foreign key
`(user_id, project_id, agent_id)` to the matching configuration and a partial
unique index allowing at most one attachment whose state is not `retired` for
one `agent_id`. The provider reference SHALL never be returned by public APIs or
copied to a Session launch snapshot.

#### `managed_memory_outbox`

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `id` | string | primary key |
| `attachment_id` | string | non-null foreign key to attachment |
| `desired_generation` | unsigned integer | non-null; greater than zero |
| `operation` | string | `reconcile`, `detach`, or `garbage-collect` |
| `idempotency_key` | string | non-null; unique |
| `state` | string | `pending`, `processing`, `completed`, `failed`, or `superseded` |
| `attempts` | unsigned integer | non-null; starts at zero |
| `available_at` | timestamp | non-null |
| `locked_at` | timestamp | nullable |
| `completed_at` | timestamp | nullable |
| `last_error_code` | string | nullable; same bounded rules as attachment error code |
| `created_at` | timestamp | non-null |
| `updated_at` | timestamp | non-null |

<!-- markdownlint-enable MD013 -->

`idempotency_key` SHALL be the canonical encoding of attachment ID, desired
generation, and operation. A unique constraint on
`(attachment_id, desired_generation, operation)` SHALL reject duplicate logical
events, and a partial unique constraint on `(attachment_id,
desired_generation)` while state is `pending` or `processing` SHALL permit at
most one active operation for that generation. The configuration, attachment
intent, and outbox row SHALL commit in one database transaction. Provider I/O
SHALL occur only after commit; duplicate or recovered delivery SHALL converge on
the same attachment and generation.

Committing a newer desired generation SHALL mark every older `pending` or
`failed` row for that attachment `superseded`. A worker that already holds an
older `processing` row SHALL compare its generation to current attachment and
configuration state before provider I/O and again before committing results; a
mismatch SHALL perform no current-state write and SHALL mark the row
`superseded`. Completed rows remain immutable reconciliation history. A
superseded operation SHALL never delete, recreate, or alter provider state for a
newer generation.

#### Scenario: Disabled configuration has no usable attachment

- GIVEN a configuration has both facets disabled
- WHEN persistent state is validated
- THEN no non-retired attachment may be `provisioning`, `ready`, or `failed`
- AND any former attachment is only `draining` or `deleting` while exact-Session
  leases drain, or `retired` after cleanup
- AND future Agent Starts persist no attachment in their launch snapshot

#### Scenario: Enabled configuration has one current attachment

- GIVEN either configuration facet is enabled
- WHEN persistent state is validated
- THEN exactly one non-retired matching attachment exists in `provisioning`,
  `ready`, or `failed`
- AND its desired generation equals the configuration generation
- AND any mismatch fails closed before Session creation

### Requirement: Immutable Session Launch and Memory Lease Persistence

Every Session created from a generated Enterprise Agent after launch-snapshot
rollout SHALL have exactly one immutable `session_launch_snapshots` row committed
in the same transaction as the Session. Other ordinary Agent-bound Sessions are
outside this Enterprise Assistant persistence requirement:

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `session_id` | string | primary key; foreign key to `sessions.id` |
| `schema_version` | unsigned integer | non-null; currently `1` |
| `user_id` | string | non-null foreign key to `users.id` |
| `project_id` | string | non-null foreign key to `projects.id` |
| `agent_id` | string | non-null foreign key to `agents.id` |
| `system_instructions` | text | non-null; immutable privileged system-prompt bytes |
| `system_instructions_digest` | string | non-null; immutable digest of exact system-instruction bytes |
| `user_instruction_context` | text | non-null; immutable lower-priority user context; MAY be empty |
| `user_instruction_context_digest` | string | non-null; immutable digest of exact user-context bytes |
| `template_digest` | string | nullable for legacy Agents; immutable |
| `customization_digest` | string | nullable for legacy Agents; immutable |
| `runner_type` | string | non-null; immutable runtime selector |
| `llm_model` | string | non-null; immutable start-time model selector |
| `provider_context` | JSON | non-null non-secret start-time provider descriptor |
| `memory_attachment_id` | string | nullable foreign key to managed attachment |
| `memory_attachment_version` | unsigned integer | nullable; paired with attachment ID |
| `memory_desired_generation` | unsigned integer | nullable; positive and paired with attachment ID |
| `personal_memory_enabled` | Boolean | non-null |
| `coding_memory_enabled` | Boolean | non-null |
| `memory_audience` | string | nullable; when present exactly `managed-agentic-memory` |
| `created_at` | timestamp | non-null |

<!-- markdownlint-enable MD013 -->

The snapshot's Project and Agent IDs MUST equal the Session fields, and its User
ID MUST be the canonical owner authorized at Agent Start. Attachment ID,
attachment version, desired generation, audience, and at least one enabled facet
SHALL be either all present in a valid combination or all absent with both facets
false. An attachment-bearing snapshot MUST reference a `ready` matching
attachment in the same User, Project, and Agent boundary at transaction time;
its desired generation MUST equal both the attachment and Enterprise Assistant
configuration generation. No update or delete API SHALL mutate a snapshot while
its Session exists.

`system_instructions` SHALL contain only the verified platform-owned system
bytes, while `user_instruction_context` SHALL contain only the separately
rendered lower-priority customization context. Each digest SHALL be
`sha256:<64 lowercase hex>` over the exact UTF-8 bytes of its corresponding
string, including the digest of the empty string when user instruction context
is empty. Agent Start SHALL snapshot and digest the two strings independently in
the Session-creation transaction. The control plane and Runner SHALL preserve
them as separate values through the runner privilege handoff and SHALL NOT
concatenate, reorder, promote, demote, or re-render them before or during that
handoff.

For a memory-disabled Session, `memory_attachment_id`,
`memory_attachment_version`, `memory_desired_generation`, and `memory_audience`
SHALL all be null and both memory facet Booleans SHALL be false.

A memory-enabled Session SHALL additionally have exactly one
`managed_memory_session_leases` row:

<!-- markdownlint-disable MD013 -->

| Column | Type | Constraints |
|---|---|---|
| `session_id` | string | primary key; foreign key to launch snapshot |
| `attachment_id` | string | non-null foreign key to managed attachment |
| `attachment_version` | unsigned integer | non-null; copied from snapshot |
| `memory_desired_generation` | unsigned integer | non-null; positive and copied from snapshot |
| `user_id` | string | non-null foreign key to `users.id` |
| `project_id` | string | non-null foreign key to `projects.id` |
| `agent_id` | string | non-null foreign key to `agents.id` |
| `personal_enabled` | Boolean | non-null; copied from snapshot |
| `coding_enabled` | Boolean | non-null; copied from snapshot |
| `capability_generation` | unsigned integer | non-null; greater than zero |
| `audience` | string | non-null; exactly `managed-agentic-memory` |
| `state` | string | `active`, `terminal`, `expired`, or `revoked` |
| `issued_at` | timestamp | non-null |
| `expires_at` | timestamp | non-null; no later than Session maximum lifetime |
| `terminal_at` | timestamp | nullable |
| `revoked_at` | timestamp | nullable |
| `revocation_reason_code` | string | nullable; allowlisted ASCII; at most 64 characters |

<!-- markdownlint-enable MD013 -->

The lease SHALL have composite constraints requiring all identity, attachment,
version, desired-generation, facet, and audience fields to equal the launch
snapshot. The platform SHALL persist no raw capability token. Capability
issuance and renewal SHALL use the exact lease and separately authenticated
exact-Session runtime identity.

Creation of a memory-enabled Session, its launch snapshot, and its matching
lease SHALL be one database transaction. A constraint, lease creation, or
snapshot validation failure SHALL roll back all three records, so no Session may
commit with partial managed-memory authority. A memory-disabled Session SHALL
commit with its attachment-free launch snapshot and no lease row in the same
Session-creation transaction.

#### Scenario: Control plane consumes only immutable launch state

- GIVEN a generated Enterprise Agent Session and launch snapshot committed
  successfully
- WHEN the control plane reconciles or retries the workload
- THEN it reads system instructions, user instruction context, their independent
  digests, runtime, LLM model, provider context, and managed memory only from
  that snapshot and matching lease
- AND it passes system instructions only to the privileged system-prompt channel
  and user instruction context only to the lower-priority user-context channel
- AND it never recombines the two values before the Runner's privilege handoff
- AND it does not re-read mutable Agent customization or attachment desired
  state to reinterpret the Session

#### Scenario: Detachment drains exact live leases

- GIVEN memory is disabled while one or more matching leases are active
- WHEN the configuration transaction commits
- THEN no future snapshot may reference the attachment
- AND existing active leases remain bound to only their original Sessions
- AND provider cleanup waits until every matching lease is terminal, expired, or
  revoked
- AND immutable Session snapshots do not independently delay cleanup after their
  matching leases cease to be active
- AND cleanup is enqueued idempotently through the managed-memory outbox

#### Scenario: Legacy Sessions are not granted memory

- GIVEN a generated Enterprise Agent Session predates launch-snapshot or
  managed-memory rollout
- WHEN persistence migration runs
- THEN its memory snapshot fields are backfilled as disabled and attachment-free
- AND no attachment, lease, capability, MCP server, message, transcript, or
  workload is created or rewritten
- AND Enterprise Assistant customization remains disabled until every
  nonterminal generated Enterprise Agent Session has immutable launch state
  usable by the control plane

### Requirement: Per-Agent Runtime Selection

The platform SHALL persist an explicit `Agent.runner_type`, copy its resolved value immutably to every Agent-bound `Session.runner_type` at creation, and fail closed before workload creation when the selected runtime is unsupported, prohibited for that Agent, absent from the selected Runner image, or incapable of the required Session transport.

#### Scenario: Agent Start snapshots the runtime

- GIVEN an Agent declares a registered supported `runner_type`
- WHEN Agent Start creates a Session
- THEN the Session stores the exact resolved runtime before it becomes eligible for reconciliation
- AND the control plane injects that Session value as `RUNNER_TYPE`
- AND later Agent changes do not alter an existing Session
- AND Session update paths reject changes to `runner_type`

#### Scenario: Existing resources retain the compatibility default

- GIVEN an existing Agent or Session predates `runner_type`
- WHEN the schema migration and subsequent reads run
- THEN the resource resolves immutably to the current compatibility default `claude-agent-sdk`
- AND no existing run silently changes bridge because a new Agent default is introduced
- AND an Agent-bound ScheduledSession uses its Agent's runtime while an agentless legacy schedule MAY use its own supported `runner_type`
- AND a conflicting Agent-bound scheduled override fails closed rather than replacing the Agent selector

#### Scenario: Child runtime comes from the child Agent

- GIVEN a coordinator Session creates a child for an exact peer Agent
- WHEN the child Session is persisted
- THEN its `runner_type` is copied from the peer Agent
- AND the parent Session runtime, image, model provider, and credentials do not propagate implicitly
- AND a caller cannot select the child runtime by copying or overriding the coordinator value

#### Scenario: Runtime availability is validated before workload creation

- GIVEN a Session contains a registered runtime selector
- WHEN the control plane resolves its compatible Runner image and bridge capabilities
- THEN the image contains the selected runtime executable and the bridge supports the required startup and persistent Session-message transport
- AND an unknown selector, missing executable, incompatible image, missing transport capability, or prohibited Agent/runtime pairing sets an actionable terminal failure
- AND no fallback bridge, pod, sandbox, model call, or credential injection occurs

### Requirement: Root-Mediated vTeam Conversation Lineage

The platform SHALL represent root-mediated vTeam chat with one user-visible coordinator Session and zero or more separate child specialist Sessions using the existing User, Project, RoleBinding, Agent, Session, and SessionMessage entities. It MUST NOT model or describe the conversation as a true multi-writer group Session or introduce a separate vTeam chat entity.

#### Scenario: Bind one catalog Project to the authenticated ACP User

- GIVEN `GET /api/ambient/v1/users/me` returns one canonical opaque User ID for the authenticated caller
- WHEN a client resolves that caller's product-swarm instance
- THEN it uses only the stable opaque `User.id`
- AND normalizes the ACP URL to its serialized origin with canonical scheme and host, default port elided, and no credentials, path, query, fragment, or trailing slash
- AND computes the Project name from the UTF-8 bytes `vteam-<lowercase RFC 4648 Base32(SHA-256(normalized ACP origin + NUL + User.id + NUL + "ambient-code/vteam/product-swarm"))>` without Base32 padding
- AND requires the exact Project name, `annotations["vteam.acp.dev/key"]="ambient-code/vteam/product-swarm"`, and exactly one active `project:owner` RoleBinding between that Project and the opaque User ID
- AND does not derive Project identity from username, email address, bearer-token bytes, or OIDC subject
- AND a missing or ambiguous User, Project, catalog key, or matching owner binding fails closed before any Agent or Session write

#### Scenario: Catalog apply targets only the derived Project

- GIVEN the authenticated User's derived Project is absent
- WHEN the user runs `acpctl apply -k examples/vteam-catalog/product-swarm --project <derived-vteam-project>` with the derived name substituted
- THEN the Project manifest and every project-scoped catalog resource target that derived Project
- AND no shared fixed-name product-swarm Project is created or mutated
- AND an existing Project with mismatched catalog or canonical ownership fails closed for administrative repair

#### Scenario: Coordinator and children use existing lineage

- GIVEN Amber is the exact `amber` coordinator Agent in the authenticated User's validated catalog-bound product-swarm Project
- WHEN Amber delegates a user turn to selected peer Agents
- THEN each peer runs in a distinct Agent-bound Session in the same Project
- AND each child Session has `parent_session_id` equal to the Amber coordinator Session ID
- AND the Amber Session remains the root of the inspectable coordinator lineage
- AND `parent_session_id` does not claim to identify which user turn caused the child

#### Scenario: Delegation is bounded to one hop

- GIVEN Amber determines that specialist input is useful for one user turn
- WHEN it resolves peers with ACP MCP `list_agents` and delegates with `create_session`
- THEN it selects zero to three existing peers by exact Agent ID
- AND creates at most one child Session for each selected peer
- AND each child references an existing Amber coordinator Session in the same Project, never itself or another child
- AND `parent_session_id` is immutable after child creation
- AND each child prompt forbids further delegation
- AND no child Session creates a grandchild Session for that turn

#### Scenario: Child Sessions use ordinary cold provisioning

- GIVEN Amber creates one or more peer child Sessions
- WHEN the platform schedules their workloads and sandboxes
- THEN it uses the ordinary Session and sandbox provisioning lifecycle
- AND this MVP provides no warm-start latency or fast-fan-out guarantee
- AND this MVP does not reserve a per-project warm Session or sandbox pool

#### Scenario: Message ownership stays isolated

- GIVEN peer child Sessions produce responses, errors, or timeouts
- WHEN Amber completes the turn
- THEN peer messages remain in their respective child SessionMessage streams
- AND Amber writes one synthesized response in the coordinator Session naming every consulted Agent and its material contribution or failure
- AND no peer message is reclassified as if that peer wrote directly in the coordinator Session

#### Scenario: Coordination does not redefine reporting structure

- GIVEN Amber is marked as the vTeam chat coordinator
- WHEN coordinator and child Session lineage is created
- THEN that operational role does not make Amber the product-swarm root Agent
- AND Stella remains the root and technical lead
- AND existing `reports-to` and `manages` annotations remain unchanged

## vTeam Post-MVP Warm-Pool Follow-up

Warm pooling is not part of the MVP requirements above. The follow-up target is a compatible ready-and-unclaimed reserve greater than zero per active Project and runtime profile, initially `1`. Claim should atomically bind Session identity and credentials only after adoption, trigger immediate asynchronous replenishment, and leave unclaimed instances free of Session identity and credentials. Reserve `0` should report degraded state, alert, replenish urgently, and permit ordinary cold fallback without a fast-latency claim. Evaluate [`SandboxWarmPool.spec.replicas` plus `SandboxClaim` adoption](https://github.com/kubernetes-sigs/agent-sandbox#extensions), including the documented [`replicas: 1` shape](https://agent-sandbox.sigs.k8s.io/docs/volumes/volume-claim-template/#create-a-sandboxwarmpool-referencing-the-template), as the concrete precedent.

## Overview

The Ambient API server provides a coordination layer for orchestrating fleets of persistent agents across projects. The model is intentionally simple:

- **Project** — a workspace. Groups agents and provides shared context (`prompt`) injected into every agent start.
- **Agent** — a project-scoped, mutable definition. Agents belong to exactly one Project. `prompt` defines who the agent is and is directly editable (subject to RBAC).
- **Session** — an ephemeral Kubernetes execution run. Human-facing roots are created via Agent Start; authorized orchestration may create Agent-bound child Sessions with explicit parent lineage. Agent Start admits only one active Session per Agent at a time.
- **Message** — a single AG-UI event in the LLM conversation. Append-only; the canonical record of what happened in a session.
- **Inbox** — a persistent message queue on an Agent. Messages survive across sessions and are drained into the start context at the next run.
- **Credential** — a global secret. Stores a Personal Access Token or equivalent for an external provider (GitHub, GitLab, Jira, Google, Vertex AI, Kubeconfig). Ordinary Credentials may be consumed by ordinary runtime paths and bound to Projects via RoleBindings. The Enterprise managed Vertex Credential is excluded from direct Runner consumption and is usable only through its supervisor-private exact-Session proxy.
- **Platform Provider** — a Project-scoped API/DB declaration that names a runtime provider type for Agents. It is distinct from a global Credential and from the OpenShell Provider Declaration/instance projected by the control plane.
- **RoleBinding** — binds a Role to a user or internal resource recipient at a
  typed scope. Ordinary grants name one scoped resource; credential grants use
  the exact credential-recipient shapes defined below. Nullable foreign keys
  retain referential integrity without a polymorphic scope string.
- **Application** — a GitOps binding that continuously syncs agent fleet definitions from a git repository to an Ambient instance. The Ambient equivalent of an Argo CD Application.
- **Gateway** — a project-scoped declaration that an OpenShell gateway should be deployed in the project’s namespace. Specifies the gateway image, TLS DNS names, and TOML configuration. Applied via `acpctl apply -k` and reconciled by the GatewayReconciler into Kubernetes resources (StatefulSet, Service, RBAC, certgen Job). See [gateway-provisioning.spec.md](./gateway-provisioning.spec.md).

The stable address of an agent is `{project_name}/{agent_name}`. It holds the inbox and links to the active session.

---

## Entity Relationship Diagram

```mermaid
%%{init: {'theme': 'default', 'themeVariables': {'attributeColor': '#111111', 'lineColor': '#ffffff', 'edgeLabelBackground': '#333333', 'fontFamily': 'monospace'}}}%%
erDiagram

    User {
        string ID PK
        string username
        string legacy_username "nullable verified alias; globally unique including tombstones"
        string name
        string email
        string oidc_issuer "exact validated bytes; unique with oidc_subject including tombstones"
        string oidc_subject "exact opaque sub bytes; unique with oidc_issuer including tombstones"
        jsonb  labels
        jsonb  annotations
        time   created_at
        time   updated_at
        time   deleted_at
    }

    Project {
        string ID PK "name-as-ID"
        string name
        string description
        string prompt "workspace-level context injected into every agent start"
        jsonb  labels
        jsonb  annotations
        string status
        time   created_at
        time   updated_at
        time   deleted_at
    }

    ProjectSettings {
        string ID PK
        string project_id FK
        string group_access
        string repositories
        time   created_at
        time   updated_at
        time   deleted_at
    }

    PlatformProvider {
        string ID PK
        string project_id FK
        string name "unique within Project"
        string type
        string secret "nullable; null for managed Enterprise Agent provider"
        string namespace "nullable"
        jsonb  labels
        jsonb  annotations
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Agent (project-scoped, mutable) ──────────────────────────────────────

    Agent {
        string ID PK "KSUID"
        string project_id FK
        string name "human-readable; unique within project"
        string display_name "nullable — human-friendly display label"
        string description "nullable — purpose description"
        string prompt "who this agent is — mutable; access controlled via RBAC"
        string repo_url "nullable — primary repository for agent sessions"
        string workflow_id "nullable — default workflow for agent sessions"
        string runner_type "runtime selector; default claude-agent-sdk"
        string llm_model "active LLM; default claude-sonnet-4-6"
        float  llm_temperature "default 0.7"
        int32  llm_max_tokens "default 4000"
        string bot_account_name "nullable — service account for git ops"
        string resource_overrides "nullable — JSON pod resource overrides"
        string environment_variables "nullable — JSON extra env vars"
        string entrypoint "nullable — CLI to invoke in sandbox (e.g. claude)"
        jsonb  providers "nullable — provider names bound to this agent"
        jsonb  payloads "nullable — files and repos staged into sandbox before start"
        jsonb  environment "nullable — structured key-value env vars for sandbox"
        jsonb  sandbox_template "nullable — sandbox container resource requests"
        string sandbox_policy "nullable — name of a policy declaration to apply"
        string current_session_id FK "nullable — denormalized for fast reads"
        jsonb  labels
        jsonb  annotations
        time   created_at
        time   updated_at
        time   deleted_at
    }

    EnterpriseAssistantConfig {
        string agent_id PK,FK
        string project_id FK
        string user_id FK "unique canonical owner"
        string setup_mode "starter | customized"
        jsonb normalized_customization "closed normalized object"
        bool personal_enabled
        bool coding_enabled
        int desired_generation "positive monotonic"
        time created_at
        time updated_at
    }

    ManagedCredentialDesignation {
        string logical_name PK "enterprise-agent-default"
        string credential_id FK "nullable when revoked"
        int generation "positive monotonic"
    }

    ManagedMemoryAttachment {
        string ID PK
        string user_id FK
        string project_id FK
        string agent_id FK "one non-retired per Agent"
        int desired_generation
        int version "positive monotonic"
        string state "provisioning | ready | failed | draining | deleting | retired"
        bytes provider_reference_ciphertext "nullable protected opaque reference"
        string last_error_code "nullable bounded"
        string last_error_message "nullable bounded sanitized"
        bool retryable
        time retry_after "nullable"
        time created_at
        time updated_at
        time retired_at "nullable"
    }

    ManagedMemoryOutbox {
        string ID PK
        string attachment_id FK
        int desired_generation
        string operation "reconcile | detach | garbage-collect"
        string idempotency_key "unique"
        string state "pending | processing | completed | failed | superseded"
        int attempts
        time available_at
        time locked_at "nullable"
        time completed_at "nullable"
        string last_error_code "nullable bounded"
        time created_at
        time updated_at
    }

    %% ── Inbox (queue on Agent — messages waiting for next session) ────────────

    Inbox {
        string ID PK
        string agent_id FK "recipient — project/agent address"
        string from_agent_id FK "nullable — sender; null = human"
        string from_name "denormalized sender display name"
        text   body
        bool   read "false = unread; drained at session start"
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Session (ephemeral run — created by user or via agent start) ─────────

    Session {
        string  ID PK
        string  name "human-readable display name"
        string  project_id FK "nullable — direct project context (no agent)"
        string  agent_id FK "nullable — set when started via agent ignite"
        string  parent_session_id FK "nullable — parent Session for clone or delegation lineage"
        string  source_scheduled_session_id "nullable — FK to ScheduledSession that triggered this"
        time    scheduled_for "nullable — cron tick time; idempotency key with source_scheduled_session_id"
        string  prompt "task scope for this run"
        string  repo_url "nullable — primary repo for the session"
        string  repos "JSON array of RepoEntry (additional attached repos)"
        string  workflow_id "nullable — JSON-encoded workflow config"
        string  runner_type "immutable runtime selector copied from Agent"
        string  llm_model "active LLM; default claude-sonnet-4-6"
        float   llm_temperature "default 0.7"
        int32   llm_max_tokens "default 4000"
        int32   timeout "nullable — max session duration in seconds"
        string  bot_account_name "nullable — service account for git ops"
        string  resource_overrides "nullable — JSON pod resource overrides"
        string  environment_variables "nullable — JSON extra env vars"
        string  labels "JSON map; queryable tags"
        string  annotations "JSON map; freeform metadata"
        string  phase
        time    start_time
        time    completion_time
        string  kube_cr_name "Kubernetes CR / pod name (set to session ID on create)"
        string  kube_cr_uid
        string  kube_namespace
        string  sdk_session_id
        int32   sdk_restart_count
        string  conditions
        string  reconciled_repos
        string  reconciled_workflow
        string  sandbox_logs_snapshot "nullable — JSON array of SandboxLogEntry; last snapshot before stop"
        string  sandbox_policy_snapshot "nullable — JSON SandboxPolicyResponse; last snapshot before stop"
        time    created_at
        time    updated_at
        time    deleted_at
    }

    SessionLaunchSnapshot {
        string session_id PK,FK
        int schema_version "currently 1"
        string user_id FK
        string project_id FK
        string agent_id FK
        text system_instructions
        string system_instructions_digest
        text user_instruction_context "non-null; may be empty"
        string user_instruction_context_digest
        string template_digest "nullable"
        string customization_digest "nullable"
        string runner_type
        string llm_model
        jsonb provider_context "non-secret"
        string memory_attachment_id FK "nullable"
        int memory_attachment_version "nullable"
        int memory_desired_generation "nullable positive"
        bool personal_memory_enabled
        bool coding_memory_enabled
        string memory_audience "nullable fixed value"
        time created_at
    }

    ManagedMemorySessionLease {
        string session_id PK,FK
        string attachment_id FK
        int attachment_version
        int memory_desired_generation "positive"
        string user_id FK
        string project_id FK
        string agent_id FK
        bool personal_enabled
        bool coding_enabled
        int capability_generation
        string audience "managed-agentic-memory"
        string state "active | terminal | expired | revoked"
        time issued_at
        time expires_at
        time terminal_at "nullable"
        time revoked_at "nullable"
        string revocation_reason_code "nullable bounded"
    }

    %% ── SessionMessage (high-level conversation — human-readable) ────────────

    SessionMessage {
        string ID PK
        string session_id FK
        int    seq "monotonic within session"
        string event_type "user | bootstrap | assistant | tool_use | tool_result | system | error"
        string payload "message body or JSON-encoded event"
        time   created_at
    }

    %% ── SessionEvent (comprehensive AG-UI event stream) ───────────────────────

    SessionEvent {
        string ID PK
        string session_id FK
        int64  seq "monotonic within session; gaps allowed after compression"
        string event_type "AG-UI event type (33 types: TEXT_MESSAGE_START, TOOL_CALL_START, etc.)"
        string payload "JSON-encoded event payload"
        time   created_at
        time   completed_at "nullable — last event timestamp for compressed events"
        int32  event_count "number of raw events compressed; 1 = uncompressed"
    }

    %% ── RBAC ─────────────────────────────────────────────────────────────────

    Role {
        string ID PK
        string name
        string display_name
        string description
        jsonb  permissions
        bool   built_in
        time   created_at
        time   updated_at
        time   deleted_at
    }

    RoleBinding {
        string ID PK
        string role_id FK
        string scope         "global | project | agent | session | credential"
        string user_id FK    "nullable only for internal credential recipients"
        string project_id FK "project grant or credential recipient"
        string agent_id FK   "agent grant or managed credential recipient"
        string session_id FK "ordinary session grant only"
        string credential_id FK "credential scope only"
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Credential (global PAT/token store, bound via RoleBindings) ──────────

    Credential {
        string ID PK "KSUID"
        string name "human-readable; globally unique"
        string description
        string provider "github | gitlab | jira | google | vertex | kubeconfig"
        string token "write-only; stored encrypted"
        string url "nullable; service instance URL"
        string email "nullable; required for Jira"
        jsonb  labels
        jsonb  annotations
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── ScheduledSession (project-scoped recurring agent trigger) ──────────

    ScheduledSession {
        string ID PK "KSUID"
        string project_id FK
        string agent_id FK "nullable — which Agent to ignite on each trigger"
        string name "human-readable; unique within project"
        string description
        string schedule "cron expression"
        string timezone "IANA timezone; default UTC"
        bool   enabled "false = suspended; schedule not evaluated"
        string overlap_policy "skip (default) or allow"
        string session_prompt "injected as Session.prompt on each trigger"
        int32  timeout "nullable — max session duration in seconds for triggered sessions"
        int32  inactivity_timeout "nullable — idle timeout in seconds"
        bool   stop_on_run_finished "nullable — stop session when run completes"
        string runner_type "nullable — override runner type for triggered sessions"
        time   last_run_at "nullable; wall-clock time of last trigger"
        time   next_run_at "nullable; computed from schedule + timezone"
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Gateway (project-scoped OpenShell gateway declaration) ──────────

    Gateway {
        string ID PK "KSUID"
        string project_id FK "target project (= namespace)"
        string name "resource name; typically openshell-gateway"
        string image "nullable — gateway container image; defaults to OPENSHELL_GATEWAY_IMAGE"
        jsonb  server_dns_names "DNS names for TLS certificate generation"
        string config "nullable — OpenShell gateway TOML configuration"
        jsonb  labels
        jsonb  annotations
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Application (GitOps sync — Argo CD for Ambient) ──────────────

    Application {
        string ID PK "KSUID"
        string name "unique; human-readable"
        string source_repo_url "git repository URL"
        string source_target_revision "branch, tag, or commit SHA"
        string source_path "path within repo to kustomize overlay"
        string destination_ambient_url "nullable — target Ambient API URL; null = local"
        string destination_project "target project name; created if CreateProject=true"
        string credential_id FK "nullable — Credential for remote Ambient auth; required when destination_ambient_url is set"
        bool   auto_sync "enable automated sync on git change"
        bool   auto_prune "delete resources removed from git"
        bool   self_heal "re-sync when live state drifts"
        string sync_options "comma-separated: CreateProject=true, etc."
        int    retry_limit "max sync retries on failure"
        string sync_status "Synced | OutOfSync | Unknown"
        string health_status "Healthy | Degraded | Progressing | Unknown"
        string sync_revision "last successfully synced git commit SHA"
        string operation_phase "Succeeded | Failed | Running | idle"
        string operation_message "human-readable sync result summary"
        jsonb  resource_status "per-resource sync/health detail"
        jsonb  conditions "error conditions array"
        jsonb  labels
        jsonb  annotations
        time   last_synced_at "timestamp of last successful sync"
        time   created_at
        time   updated_at
        time   deleted_at
    }

    %% ── Relationships ────────────────────────────────────────────────────────

    Project         ||--o{ ProjectSettings  : "has"
    Project         ||--o{ PlatformProvider : "declares"
    Project         ||--o{ Agent            : "owns"
    User            ||--o| EnterpriseAssistantConfig : "owns"
    Project         ||--o{ EnterpriseAssistantConfig : "contains"
    Agent           ||--o| EnterpriseAssistantConfig : "configures"
    EnterpriseAssistantConfig ||--o{ ManagedMemoryAttachment : "desires"
    ManagedMemoryAttachment ||--o{ ManagedMemoryOutbox : "reconciles"
    RoleBinding     }o--o| Credential       : "credential_id"
    Project         ||--o{ ScheduledSession : "owns"

    User            }o--o{ RoleBinding      : "user_id"
    Project         }o--o{ RoleBinding      : "project_id"

    RoleBinding     }o--o| Agent            : "agent_id"
    RoleBinding     }o--o| Session          : "session_id"

    Agent           ||--o{ Session          : "runs"
    Agent           ||--o| Session          : "current_session"
    Agent           ||--o{ Inbox            : "receives"
    Agent           ||--o{ ScheduledSession : "scheduled_by"

    Inbox           }o--o| Agent            : "sent_from"

    Project         ||--o{ Gateway          : "owns"

    Application }o--o| Project        : "syncs_to"
    Application }o--o| Credential     : "credential_id"

    Session         ||--o{ SessionMessage   : "streams"
    Session         ||--o{ SessionEvent     : "emits"
    Session         ||--o| SessionLaunchSnapshot : "generated Enterprise Agent snapshot"
    SessionLaunchSnapshot ||--o| ManagedMemorySessionLease : "authorizes"
    ManagedMemoryAttachment ||--o{ ManagedMemorySessionLease : "leases"
    Credential      ||--o| ManagedCredentialDesignation : "designated by"
    Session         o|--o{ Session          : "parent_session_id"

    Role            ||--o{ RoleBinding      : "granted_by"
```

---

## Application — GitOps Continuous Sync

Application is the Ambient equivalent of an [Argo CD Application](https://argo-cd.readthedocs.io/en/stable/core_concepts/). It binds a git repository source (containing kustomize-based agent fleet definitions) to a destination Ambient instance and project, then continuously reconciles the desired state from git against the live state in the platform.

### Core Concepts (Argo CD Mapping)

| Argo CD Concept | Ambient Equivalent | Description |
|---|---|---|
| Application | **Application** | Declarative binding of source → destination |
| Source (repo + path + revision) | `source_repo_url` + `source_path` + `source_target_revision` | Git repo containing kustomize overlays of Projects, Agents, Credentials, RoleBindings |
| Application Source Type | Always **Kustomize** | The CLI's built-in kustomize engine renders the manifests |
| Destination (cluster + namespace) | `destination_ambient_url` + `destination_project` | Target Ambient instance + project name |
| Target State | Rendered kustomize output | The desired set of Projects, Agents, Credentials, RoleBindings, and Inbox seeds from git |
| Live State | Current API server state | What actually exists in the destination Ambient's project |
| Sync Status | `sync_status` | Whether live state matches target state: `Synced`, `OutOfSync`, `Unknown` |
| Sync Operation | `/sync` sub-resource | The act of applying target state to live state |
| Refresh | `/refresh` sub-resource | Fetch latest from git, render kustomize, diff against live state |
| Health | `health_status` | Are all synced agents healthy? `Healthy`, `Degraded`, `Progressing`, `Unknown` |
| Self-Heal | `self_heal` flag | Re-sync when live state drifts (agent modified via UI, deleted manually) |
| Prune | `auto_prune` flag | Delete agents/resources from Ambient that no longer exist in git |

### What Gets Synced

An Application syncs **project-scoped fleet definitions** — a subset of resource kinds that `acpctl apply -k` handles (excluding infrastructure inventory kinds like Cluster and Ambient):

| Kind | Sync Behavior |
|---|---|
| `Project` | Created if `CreateProject=true` in `sync_options`; patched (description, prompt, labels, annotations) on subsequent syncs |
| `Agent` | Created or patched within the destination project; prompt, providers, payloads, environment, entrypoint, sandbox_policy, sandbox_template, labels, annotations updated |
| `Credential` | Created if not present; idempotent by name |
| `RoleBinding` | Created if not present; idempotent by user+role+scope key. **Escalation-bound:** the sync engine can only create RoleBindings at or below the level of the service credential it uses (see Design Decisions). |
| `Gateway` | Created or patched within the destination project; image, serverDnsNames, config updated. Reconciled into K8s gateway resources by the GatewayReconciler. |
| `Policy` | Created or patched within the destination project; spec, labels, annotations updated. Contains the upstream OpenShell `SandboxPolicy` JSON. Referenced by agents via `sandbox_policy` field. |
| `Inbox` (seed messages) | Idempotent delivery — only new messages (by `from_agent_id` + `body` content hash dedup) are posted. Uses immutable `from_agent_id` FK, not mutable `from_name`. |

### What Does NOT Get Synced

| Kind | Why |
|---|---|
| `Session` | Ephemeral run artifact. Created via agent start, not via GitOps. |
| `SessionMessage` | Append-only event stream. |
| `ScheduledSession` | Project-scoped trigger config; future sync candidate. |
| `User` | Identity record. |
| `Role` | RBAC definition (platform-scoped, not project-scoped). |

### Field Reference

| Field | Notes |
|---|---|
| `name` | Unique, human-readable. The stable address of this sync binding. |
| `source_repo_url` | Git repository URL. HTTPS or SSH. |
| `source_target_revision` | Branch name, tag, or commit SHA. Default: `main`. |
| `source_path` | Relative path within the repo to a kustomize directory (must contain `kustomization.yaml`). |
| `credential_id` | Nullable FK → Credential. The stored credential providing authentication for the destination Ambient's REST API. Required when `destination_ambient_url` is set. Uses the same write-only encrypted storage as all Credentials. The credential's token is resolved at sync time via `GET /credentials/{cred_id}/token` (gated by `credential:token-reader`). Null when targeting the local Ambient (controller uses its own service identity). |
| `destination_ambient_url` | Nullable. The Ambient API server URL to sync to. Null = local Ambient (this API server). When set, `credential_id` must also be set — async polling controllers have no request context to forward a token from. |
| `destination_project` | Target project name. The project is created on first sync if `CreateProject=true` is in `sync_options`. |
| `auto_sync` | If true, the controller polls the git repo and syncs automatically when changes are detected. If false, sync is manual via `POST /sync`. |
| `auto_prune` | If true, resources in the live state that are absent from the target state are deleted. If false, orphaned resources are left in place. **WARNING: Pruning a Project is permanently destructive.** All Agents, Sessions, Inbox messages, and SessionMessages in the project are cascade-deleted. The sync engine will never auto-prune a Project — Project removal requires manual confirmation via `POST /sync` with explicit `prune: true` and `prune_project: true` flags. Agent-level pruning operates normally under `auto_prune`. |
| `self_heal` | If true, the controller re-syncs when live state drifts from target state (e.g., an agent's prompt is changed via the UI). If false, drift is allowed. |
| `sync_options` | Comma-separated option flags. Initial options: `CreateProject=true`. |
| `retry_limit` | Max number of automatic retries on sync failure. Default: 3. |
| `sync_status` | Computed on refresh. `Synced` = live matches target. `OutOfSync` = differences detected. `Unknown` = not yet refreshed. |
| `health_status` | Computed from synced resources. `Healthy` = all synced resources exist in the destination and match the target state (name, prompt, labels, annotations match git). `Degraded` = one or more synced resources are missing, have field drift from target state, or failed to apply. `Progressing` = sync operation is currently running. `Unknown` = not yet assessed (never refreshed). Health is assessed per-resource and aggregated — any single `Degraded` resource makes the whole application `Degraded`. |
| `sync_revision` | The git commit SHA of the last successful sync. |
| `operation_phase` | State of the last sync operation: `Succeeded`, `Failed`, `Running`, or empty if never synced. |
| `operation_message` | Human-readable summary, e.g. `"3 created, 1 configured, 0 pruned"`. |
| `resource_status` | JSONB array of per-resource sync results: `[{"kind": "Agent", "name": "lead", "status": "Synced", "health": "Healthy", "message": "configured"}]`. |
| `conditions` | JSONB array of error conditions: `[{"type": "SyncError", "message": "...", "lastTransitionTime": "..."}]`. |
| `last_synced_at` | Timestamp of the last successful sync completion. |

### Sync Lifecycle

```
1. Refresh: clone/fetch repo at source_target_revision
2. Render:  build kustomize at source_path → flat manifest stream
3. Diff:    compare rendered manifests against live state in destination project
4. Sync:    apply creates/patches/deletes to reconcile live → target
5. Status:  update sync_status, health_status, resource_status, operation_*
```

For automated sync (`auto_sync=true`), this lifecycle runs on a configurable polling interval (default: 3 minutes). For manual sync, it runs on `POST /api/ambient/v1/applications/{id}/sync`.

### Destination Resolution

```
Application.destination_ambient_url set?
  |── null  ──> local Ambient (this API server's own service layer)
  |            ──> controller uses its own service identity
  |── set   ──> remote Ambient (SDK client pointed at the URL)
              ──> credential_id MUST be set (FK → Credential)
              ──> token resolved at sync time via GET /credentials/{id}/token
```

When targeting a remote Ambient, the sync engine acts as an API client to the remote Ambient's REST API, authenticated via the stored Credential. The credential is resolved at sync time — the controller never caches tokens beyond a single sync cycle. This is different from how Sessions use kubeconfig for direct K8s provisioning — the Application works entirely at the Ambient API layer.

### Unsupported Kinds in Sync

The kustomize rendering engine (`acpctl apply -k`) supports additional resource kinds beyond what Application syncs (e.g., `Cluster`, `Ambient` — infrastructure inventory kinds). When a rendered kustomize tree contains documents of unsupported kinds, the sync engine **silently skips** them. Each skipped document is recorded in `resource_status` with a `Skipped` status:

```json
{"kind": "Ambient", "name": "staging-cluster", "status": "Skipped", "health": "Unknown", "message": "infrastructure inventory — not synced by Application"}
```

This is not an error. The sync operation proceeds with the supported kinds and reports `operation_phase: Succeeded` if all syncable resources apply cleanly.

### Multi-Environment Promotion

Promotion across environments is expressed as **multiple Applications**, each pointing to a different overlay and destination:

```yaml
## Dev — auto-sync from main, auto-prune
kind: Application
name: my-fleet-dev
source:
  repo_url: https://gitlab.cee.redhat.com/ambient-code/ambient-code-gitops.git
  target_revision: main
  path: ambient/overlays/dev
destination:
  ambient_url: null   # local
  project: my-fleet
auto_sync: true
auto_prune: true
self_heal: true

---
## Staging — manual sync from release branch, no prune
kind: Application
name: my-fleet-staging
source:
  repo_url: https://gitlab.cee.redhat.com/ambient-code/ambient-code-gitops.git
  target_revision: release/v1.2
  path: ambient/overlays/staging
destination:
  ambient_url: https://ambient-staging.apps.example.com
  credential: staging-ambient-pat   # Credential name; resolved to credential_id
  project: my-fleet
auto_sync: false
auto_prune: false
self_heal: false
```

Promotion is a git operation: merge the dev overlay changes into the release branch, then sync the staging Application.

---

## Agent — Project-Scoped Mutable Definition

Agent is scoped to a Project. The stable address is `{project_name}/{agent_name}`.

| Field | Notes |
|-------|-------|
| `name` | Human-readable, unique within the project. Used as display name and in addressing. |
| `display_name` | Nullable. Human-friendly label for UI display; does not affect addressing. |
| `description` | Nullable. Free-text purpose description. |
| `prompt` | Defines who the agent is. Mutable via PATCH. Access controlled by RBAC (`agent:editor` or higher). |
| `repo_url` | Nullable. Primary repository URL cloned into every session the agent starts. Copied to `Session.repo_url` on ignite. |
| `workflow_id` | Nullable. Default workflow identifier injected into sessions. Copied to `Session.workflow_id` on ignite. |
| `runner_type` | Runtime bridge selector. Default `claude-agent-sdk`. Copied immutably to `Session.runner_type` on Agent Start; later Agent edits do not alter existing Sessions. |
| `llm_model` | Active LLM model name. Default: `claude-sonnet-4-6`. Copied to `Session.llm_model` on ignite. |
| `llm_temperature` | LLM sampling temperature. Default: `0.7`. Copied to `Session.llm_temperature` on ignite. |
| `llm_max_tokens` | Max tokens per LLM response. `int32`, default: `4000`. Copied to `Session.llm_max_tokens` on ignite. |
| `bot_account_name` | Nullable. Service account name for git operations inside sessions. Copied to `Session.bot_account_name` on ignite. |
| `resource_overrides` | Nullable. JSON-encoded pod resource requests/limits override for sessions spawned by this agent. Copied to `Session.resource_overrides` on ignite. |
| `environment_variables` | Nullable. JSON-encoded extra environment variables injected into session pods. Copied to `Session.environment_variables` on ignite. |
| `entrypoint` | Nullable. Logical agent runtime binary to invoke inside the sandbox (e.g. `claude`). In Gateway mode the fixed Ambient Runner supervisor, not this value, is the top-level `ExecSandbox` command; the authenticated Runner applies the logical selection only after bootstrap. Not propagated to Session. |
| `providers` | Nullable. JSONB array of provider names bound to this agent (e.g. `["vertex", "github"]`). References provider declarations in the same namespace. The control plane resolves provider secrets and configures credential sidecars or gateway providers at session start. Not propagated to Session. |
| `payloads` | Nullable. JSONB array of file/repo payloads staged into the sandbox before the agent runs. Each entry specifies a `sandbox_path` and either inline `content` or a `repo_url` + `ref` to clone. Not propagated to Session. |
| `environment` | Nullable. JSONB object of structured key-value environment variables injected into the sandbox container. Distinct from `environment_variables` (legacy string field). Not propagated to Session. |
| `sandbox_template` | Nullable. JSONB object specifying sandbox container resource requests (e.g. `{"resources": {"cpu": "2", "memory": "4Gi"}}`). Consumed by the control plane when creating the sandbox via the gateway. Not propagated to Session. |
| `sandbox_policy` | Nullable. Name of a policy declaration (ConfigMap with `ambient.ai/kind: policy` label) that defines network, filesystem, process, and landlock rules for the sandbox. Not propagated to Session. |
| `current_session_id` | Denormalized FK to the active Session. Null when no session is running. Used by Project Home for fast reads. |

**Agent is mutable.** PATCH updates in place. There is no versioning. If you need to track prompt history, use `labels`/`annotations` or an external audit log.

**Field propagation on Agent Start:** When `POST /agents/{id}/start` creates a new Session, the registered Agent start handler copies `repo_url`, `workflow_id`, `runner_type`, `llm_model`, `llm_temperature`, `llm_max_tokens`, `bot_account_name`, `resource_overrides`, and `environment_variables` from the Agent to the new Session. `runner_type` is immutable and cannot be overridden by the start request; existing supported overrides for other fields retain their documented behavior.

**Sandbox fields (not propagated):** The six sandbox-related fields (`entrypoint`, `providers`, `payloads`, `environment`, `sandbox_template`, `sandbox_policy`) are consumed directly by the control plane reconciler when building the OpenShell gateway sandbox — they are not copied to the Session model. The control plane reads them from the Agent record at reconcile time. These fields can be declared via `acpctl apply -k` with native ACP kinds for declarative fleet management. The `sandbox_policy` field references a `Policy` resource by name within the same project — policies are applied separately via `acpctl apply` as `kind: Policy` documents.

```
POST /projects/{id}/agents          → create agent in this project
PATCH /projects/{id}/agents/{id}    → update agent (name, prompt, labels, annotations)
GET /projects/{id}/agents/{id}      → read agent
DELETE /projects/{id}/agents/{id}   → soft delete
```

Agent Start owns at most one active current root Session per Agent and is idempotent — if that active Session exists, start returns it; otherwise it creates one. Explicit orchestration children are separate lineage records and do not replace `current_session_id`.

---

## Inbox — Persistent Message Queue

Inbox messages are addressed to an Agent (`agent_id`). They are distinct from Session Messages:

| | Inbox | SessionMessage |
|--|-------|----------------|
| Scope | Agent (persists across sessions) | Session (ephemeral) |
| Created by | Human or another Agent | LLM turn / runner gRPC push |
| Drained | At session start | Never — append-only stream |
| Purpose | Queued intent waiting for next run | Real LLM event stream |

At session start, all unread Inbox messages are drained: marked `read=true` and composed into the trusted `bootstrap` SessionMessage before the first model run. Any separately persisted human-authored task remains an `event_type=user` transcript row.

---

## Session — Ephemeral Run

Sessions are run artifacts. A user-facing root Session is created through `POST /projects/{project_id}/agents/{agent_id}/start`. An authorized orchestration client MAY use the existing Session create-and-start path for an Agent-bound child only when it supplies the exact project, exact peer `agent_id`, and `parent_session_id` of an existing root coordinator Session in that same Project. The API SHALL reject a missing, cross-project, self-referential, child-as-parent, or otherwise cyclic parent and SHALL make `parent_session_id` immutable after creation. That child remains an ordinary Session rather than a shared or multi-writer conversation.

`Session.prompt` scopes the task for this specific run — separate from `Agent.prompt` which defines who the agent is.

```
Project.prompt  → "This workspace builds the Ambient platform API server in Go."
Agent.prompt    → "You are a backend engineer specializing in Go APIs..."
Inbox messages  → "Please also review the RBAC middleware while you're in there"
Session.prompt  → "Implement the session messages handler. Repo: github.com/..."
```

All four are assembled into the start context in that order. Pokes roll downhill. The composed start context is persisted as `event_type=bootstrap`; it is not attributed to the human as a `user` turn.

### Sandbox Snapshot Fields

| Field | Type | Written by | Purpose |
|-------|------|-----------|---------|
| `sandbox_logs_snapshot` | TEXT (nullable) | CP `PodStatusSyncer` + pre-delete snapshot | JSON array of `SandboxLogEntry` — the last 500 log lines from the OpenShell gateway |
| `sandbox_policy_snapshot` | TEXT (nullable) | CP `PodStatusSyncer` + pre-delete snapshot | JSON `SandboxPolicyResponse` envelope — the full effective sandbox policy |

Both fields are **read-only from the API perspective** — they are set exclusively by the control plane via `UpdateStatus` patches. The CP writes them on every 15s sync cycle and as a final snapshot before sandbox deletion. The UI reads them to display historical sandbox data for terminal sessions (Stopped, Completed, Failed). See `openshell-sandbox-observability.spec.md` § Sandbox Log and Policy Persistence for full requirements.

---

## SessionMessage — High-Level Conversation (Messages API)

SessionMessages provide the human-oriented conversation plus inspectable trusted startup context. This is the Messages API — human turns, platform bootstrap input, replies, and high-level tool invocations summarized for human consumption. A `bootstrap` row is model input, but is not an ordinary human transcript turn.

`seq` is monotonically increasing within a session, using an **independent counter** from `SessionEvent.seq` (the two tables serve different APIs at different granularities and must not share a sequence). `event_type` uses **simplified message types** (distinct from AG-UI event types used in SessionEvent):

**Messages API Event Types** (7 types):
- `user` — Human-authored task or later human turn, including a scheduled task originally authored by a human
- `bootstrap` — Trusted platform-authored initial model input composed from Project, Agent, Inbox, peer, and Session task context
- `assistant` — Agent reply or response
- `tool_use` — Tool invocation summary
- `tool_result` — Tool execution result summary
- `system` — System notification or status
- `error` — Error condition

These are **not** AG-UI event types. For the complete AG-UI protocol with 33 granular event types, see SessionEvent below.

### Bootstrap Authorship and Sequence Contract

For a new Agent start, including internal and scheduled producer paths, a producer with the full start context SHALL persist the human-authored task as `event_type=user` when such text exists, then persist exactly one rich `event_type=bootstrap` row before making the Session eligible to run. The task and bootstrap writes MUST commit in one transaction, and the task sequence `U` MUST be less than the bootstrap sequence `B`. This order allows the Runner to watch from `B - 1`, consume the bootstrap once, and avoid executing the already-represented task row as a second initial run. A producer MUST NOT manufacture an empty `user` row when no human-authored task exists. An idempotent start that returns an existing active Session MUST NOT append either row.

Producers that cannot assemble the rich context MAY omit the bootstrap. When the control plane owns a Gateway fresh-start path and has a non-empty compatibility prompt, the control plane SHALL idempotently ensure the singleton bootstrap through the exact-Session trusted API before payload delivery, `Running`, `start_time`, or `ExecSandbox`, then hand the returned sequence to the Runner. Runner-owned fallback is permitted only when trusted operator/CreateSession launch configuration sets `INITIAL_BOOTSTRAP_FALLBACK_ALLOWED=true` and mints the exact-Session Runner capability; this signed launch provenance is not a caller-supplied Session field. The API atomically revalidates the exact Runner identity, capability, `Pending`/`Creating` phase, absent `start_time`, and absent `sdk_session_id`. Fallback is forbidden after `Running`, after any `start_time`/SDK identity, on resume, or because an elapsed-time heuristic labels a Session "fresh." This contract adds no Session database, protobuf, or OpenAPI field. Once a bootstrap exists, no producer, control plane, or Runner may append another one. More than one bootstrap row is ambiguous and execution MUST fail closed.

The REST message endpoint SHALL accept only human-authored `user` turns and SHALL reject `bootstrap`. Except for the producer's transactional initial task, it SHALL reject later human-message writes until both the Session is `Running` and the exact Session's runtime-authenticated message watch has registered ready. Gateway persists `Running` immediately before `ExecSandbox`, but that phase change alone SHALL NOT open human-message admission; admission opens only after the executed Runner registers its selected cursor. This prevents a human row from being committed below the bootstrap cursor while preserving the required Gateway `Running`-before-`ExecSandbox` cutoff.

The gRPC `PushSessionMessage` method SHALL accept `bootstrap` only when both normal service authentication and a valid bootstrap capability authorize the exact target Session and purpose. Project access, an ordinary administrative token, a capability without service authentication, or a service identity for another Session is insufficient. For Runner fallback, the API SHALL atomically revalidate the exact Runner service identity and signed fallback capability, phase `Pending`/`Creating`, `start_time IS NULL`, and `sdk_session_id IS NULL`; the CP-owned Gateway ensure uses the control-plane service identity and remains exact-Session and pre-execution. The write is a conditional ensure: a same-payload retry or re-query returns the existing row and positive sequence without appending, while a different payload for a Session that already has bootstrap fails closed. Each owner may issue at most two total same-Session, same-payload requests end-to-end: a second request only after an indeterminate acknowledgement, with finite per-attempt and overall deadlines and no nested transport retries that multiply the budget.

`event_type` is already an unconstrained string in both PostgreSQL and protobuf. Adding `bootstrap` is an application-level value addition and SHALL NOT require a database column migration, protobuf field migration, or rewrite of existing rows. A partial unique index on `session_messages(session_id) WHERE event_type = 'bootstrap'` SHALL enforce at most one durable bootstrap per Session; this index-only cardinality migration exists for concurrency safety, not to add a field or enum. Legacy startup-context rows encoded as `user` remain immutable and readable. Presentation consumers MAY recognize such a row only by an exact digest of the trusted platform-assembled context; they MUST NOT use prefix, substring, or semantic-content guesses to reclassify arbitrary human turns. Runtime components MUST NOT execute or reclassify a legacy `user` row as bootstrap.

The fresh-session invariant is one authoritative bootstrap publication and one initial model invocation during normal startup and transport reconnect. It is not crash-proof effect-level exactly-once execution: without a durable consumed-message checkpoint or idempotent run identity, a process or pod crash after model effects but before durable completion can leave an ambiguous outcome.

### Internal Bootstrap Capability Contract

Internal bootstrap resolution and mutation SHALL require existing service authentication plus a short-lived signed capability. A capability is additional authority, never a replacement for the service credential. The API SHALL reject the request before reading or mutating SessionMessage content when either credential is missing or invalid.

| Artifact | Audience | Purpose | Consumer |
|---|---|---|---|
| Resolve capability | `ambient-api-server` | `session-bootstrap-resolve` | Control plane only; metadata resolver |
| Ensure capability | `ambient-api-server` | `session-bootstrap-ensure` | Control plane or eligible operator/CreateSession Runner; conditional bootstrap ensure |
| Exact-Session service credential | `ambient-api-server` | `session-runtime` | Exact-Session Runner; ordinary API/gRPC calls whose target Session matches the signed claim |
| Direct/Operator refresh credential (not the ACP `Credential` Kind) | `ambient-control-plane-tokenserver` | `session-capability-refresh` | Exact-Session Direct/Operator supervisor; exchange for a replacement service credential and, only for eligible fallback, an ensure capability |
| Gateway workload attestation | `ambient-control-plane-tokenserver` | `gateway-workload-attestation` | Gateway-mode `/token` exchange only; an ACP bearer returned by `/oauth2/sandbox-attestation` and injected by OpenShell Providers v2 outside the Runner process |

Resolve and ensure access capabilities SHALL use header `alg=HS256`, `typ=JWT`, and the current HMAC key identifier in `kid`; their lifetime is two minutes by default and never more than five minutes. The exact-Session service credential and Direct/Operator refresh credential SHALL use `alg=RS256`, `typ=JWT`, and the current CP signing-key identifier in `kid`. The service credential lifetime SHALL be two minutes. The Direct/Operator refresh credential is bounded by the owning Pod and SHALL NOT exceed 12 hours. `crit` is forbidden for every profile.

Each resolve, ensure, service, and Direct/Operator refresh profile contains exactly one `iss`, `aud`, `purpose`, `session_id`, `iat`, `nbf`, and `exp`. The refresh profile additionally contains exactly one immutable `workload_mode`, `origin`, `workload_generation`, and `grant_scope`; those claims are forbidden on the resolve, ensure, and service profiles. The Gateway attestation has the separate exact profile below and Gateway Runner receives no refresh credential. No profile accepts unknown claims. `iss` SHALL equal `ambient-control-plane`; `aud` and `purpose` SHALL equal the table values; `session_id` SHALL exactly equal the request Session. `workload_generation` SHALL be an unpadded base64url encoding of 32 random bytes. Direct/Operator `grant_scope` SHALL be `runtime-only` or `runtime-and-bootstrap-ensure`; a request may ask for `runtime-only` within either scope, while ensure requires the latter scope plus live fallback eligibility. Numeric times SHALL describe a positive bounded lifetime. Clock skew of at most 30 seconds may apply only to future `iat` and `nbf`; `now >= exp` is always expired with no grace.

| Workload mode | Required origin/binding | Fixed service-identity verifier | Additional binding |
|---|---|---|---|
| `gateway` | Live Sandbox namespace/name/UID, immutable OpenShell Sandbox UUID, Pod UID, ServiceAccount, and CP-owned Session/generation annotations | OpenShell v0.0.82 Providers v2 SPIFFE JWT-SVID, verified by ACP only at `/oauth2/sandbox-attestation`; the resulting ACP attestation is verified at `/token` | JWT-SVID `sub` contains the exact Sandbox UUID and generation from immutable/CP-owned Pod annotations; the Runner receives no projected token, SVID, SPIFFE key/socket, attestation, refresh credential, or ensure capability |
| `direct` | `pod:<namespace>/<name>@<uid>` | `ambient-control-plane-tokenserver`, verified by ACP TokenReview | Live Pod name/UID, ServiceAccount, CP-owned Session/generation annotations, and refresh all match |
| `operator` | `pod:<namespace>/<name>@<uid>` | `ambient-control-plane-tokenserver`, verified by ACP TokenReview | Live Pod name/UID, ServiceAccount, CP-owned Session/generation annotations, and refresh all match |

The CP SHALL derive the Direct/Operator refresh pair from trusted launch state before signing; the exchange request cannot provide or override `workload_mode`, `origin`, or service-identity profile. A pair outside the table, including a known value in the wrong combination, fails closed. ACP TokenReviews only Direct/Operator projected tokens. Gateway uses only the released OpenShell v0.0.82 Providers v2 `token_grant` flow and MUST NOT fall back to HMAC workload authentication, Kubernetes TokenReview, an OpenShell gateway JWT, a caller-provided bearer, or a per-Session mTLS private-key upload.

The Gateway workload attestation SHALL use header `alg=RS256`, `typ=ambient-gateway-attestation+jwt`, and a current CP signing-key `kid`. Its claims are exactly one each of `iss`, `aud`, `purpose`, `session_id`, `sandbox_id`, `origin`, `pod_uid`, `service_account`, `workload_generation`, `iat`, `nbf`, and `exp`, with no unknown claims. `sandbox_id` SHALL be the exact OpenShell Sandbox UUID copied from the validated SPIFFE subject and immutable `openshell.io/sandbox-id` annotation, not a name or Kubernetes UID; `origin` SHALL name the exact live Sandbox namespace/name/Kubernetes UID. `iss` SHALL be `ambient-control-plane`, `aud` SHALL be the single `ambient-control-plane-tokenserver`, `purpose` SHALL be `gateway-workload-attestation`, and lifetime SHALL be exactly 60 seconds with `now >= exp` expired without grace.

The distinct HTTPS `POST /oauth2/sandbox-attestation` endpoint SHALL accept OpenShell v0.0.82's RFC 7523 client authentication: a body of at most 16 KiB only as `application/x-www-form-urlencoded` with exactly one each of `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion=<JWT-SVID>`, `audience=ambient-control-plane-tokenserver`, and `scope=sandbox-attestation`. An optional OAuth `client_id` must equal the exact SPIFFE ID in JWT `sub`; ACP ignores unknown extension parameters as required by RFC 6749 and rejects duplicate, missing/empty, folded/oversized required input and `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. It validates fixed RS256 against the SPIFFE trust bundle/JWKS, exact SPIFFE `iss`, exact `aud=ambient-control-plane-sandbox-attestor` as the configured authorization-server identity, bounded `iat`/`nbf`/`exp`, and `sub=spiffe://<trust-domain>/openshell/sandbox/<sandbox-uuid>/pod/<pod-uid>/generation/<workload-generation>/sa/<service-account>`. It resolves that UUID to exactly one live Sandbox and Pod and requires the subject Pod UID, generation, and ServiceAccount to equal the live values, along with immutable sandbox-ID annotation, controlling Sandbox owner kind/name/UID, deletion state, and exact Session annotations. Success returns only JSON `access_token`, `token_type=Bearer`, `expires_in=60`, and exact `scope=sandbox-attestation` with `Cache-Control: no-store` and `Pragma: no-cache`; it never returns a refresh token. Failures use the RFC 6749 JSON error shape without secret-bearing descriptions: `invalid_client` for assertion/authentication failure, `invalid_request` for malformed or ambiguous form input, `unsupported_grant_type` for a wrong grant, and `invalid_scope` for a wrong scope. Every response carries both no-store headers.

Gateway launch requires OpenShell v0.0.82, `providers_v2_enabled=true`, its released SPIFFE provider-token-grant support enabled, a SPIFFE implementation such as SPIRE, and an exactly validated `ClusterSPIFFEID` whose template binds the per-workload SPIFFE ID to the sandbox annotation, immutable Pod UID, CP-owned workload generation annotation, and Pod ServiceAccount. The OpenShell supervisor sidecar receives the SPIFFE Workload API socket and `OPENSHELL_PROVIDER_SPIFFE_WORKLOAD_API_SOCKET` through the supported CSI sidecar topology and requests the default JWT-SVID; Runner receives neither that socket/env nor any SPIFFE key or token. The supervisor trust store SHALL contain the current ACP serving CA before startup for both its direct token-grant client and proxy upstream TLS, validate the exact ACP service DNS SAN, and restart on CA rotation because v0.0.82 does not hot-reload per-profile CA trust. NetworkPolicy allows only the required ACP service port. CP SHALL reconcile an ACP runtime-only provider profile and empty provider instance, validate their resource versions and effective values, and attach the instance before Runner execution.

The profile's `token_grant` fixes `token_endpoint=https://<configured-exact-cp-service-dns>:8443/oauth2/sandbox-attestation`, `jwt_svid_audience=ambient-control-plane-sandbox-attestor`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `audience=ambient-control-plane-tokenserver`, `scopes=[sandbox-attestation]`, `cache_ttl_seconds=30`, `auth_style=bearer`, and `header_name=Authorization`; the token endpoint always returns `expires_in=60`, so the v0.0.82 fixed cache TTL remains shorter than token lifetime. No audience override is permitted. The same configured DNS name, whether short `.svc` or fully qualified `.svc.cluster.local`, SHALL be used consistently in URL, provider endpoint, certificate SAN validation, and policy, with no alternate host accepted. The provider instance has no static credential value, environment placement, config, query, path, refresh material, or client private key. Its only protected endpoint is that exact ACP host and port, exact path `/token`, no query or fragment, `protocol=rest`, TLS termination/enforcement, and ACP server-CA trust; wildcard, additional, equal-specificity, or more-specific bindings are forbidden. Because OpenShell matching does not enforce HTTP method, ACP itself SHALL accept only `POST` and SHALL reject any query before issuance. CP SHALL read back the effective global setting, socket mount/env, profile, empty instance, attachment, trust, and endpoint policy. Missing, stale, ambiguous, detached, or mismatched SPIFFE/profile/provider/CA/network state fails startup and reconnect closed.

For Gateway mode, a dedicated runtime-auth helper outside the agent/model process and filesystem allowlists sends HTTPS HTTP/1.1 `POST /token` through the OpenShell proxy with the fixed runtime-only body and SHALL NOT send `Authorization`, a refresh credential, Session selector, workload mode, origin, audience, or ensure request. The OpenShell supervisor obtains or reuses the ACP attestation for no more than 30 seconds and injects exactly one `Authorization: Bearer <attestation>` only for the exact protected endpoint. `/token` rejects duplicate, folded, malformed, or multiple Authorization values, verifies the attestation's fixed profile, and repeats the live Sandbox/Pod/ServiceAccount/owner/session/generation/deletion checks before returning only a two-minute RS256 exact-Session `session-runtime` credential. Gateway `/token` SHALL NOT return an ensure capability. Providers v2 token-grant injection applies only to inspectable HTTP/1.1 traffic; it SHALL NOT be claimed or configured for h2 or gRPC. Runner gRPC starts only after `/token` succeeds and authenticates directly with the returned runtime credential.

CP SHALL reject unsigned, malformed, wrong-algorithm/type/issuer/audience/purpose/Session/Sandbox/Pod/ServiceAccount/generation, duplicate-header/claim, `crit`, unknown-header/claim, multiple-audience, expired/future/excess-lifetime, unknown-key, or retired-key attestations. A projected ServiceAccount token, OpenShell gateway JWT, or SPIFFE JWT-SVID is not an ACP workload attestation and MUST be rejected at `/token`.

For Gateway, CP SHALL assign one random 32-byte `workload_generation` before Sandbox Pod creation and include `ambient-code.ai/session-id` plus `ambient-code.ai/workload-generation` in the operator-owned Pod template. It SHALL preserve that generation across resume, re-exec, and controller replacement within the same Sandbox lifecycle; the immutable Pod UID is an independent SVID subject component, so a replacement Pod invalidates every prior JWT-SVID even when it inherits the template generation. CP SHALL never patch identity inputs onto an already-Ready Gateway Pod; missing or mismatched annotations fail startup and require a fresh Sandbox lifecycle. For Direct/Operator, CP likewise generates the value before Pod creation, binds it into the exact-Session refresh credential and Pod annotation, preserves the annotation when reusing the same live Pod, and generates a new value for a replacement Pod. Every `/token` exchange TokenReviews the pod-bound identity and requires the signed generation to equal the live Pod annotation, so a pre-created refresh credential is unusable until that exact annotated Pod exists. CP SHALL read back the exact Gateway object before allowing `/oauth2/sandbox-attestation`. Only the CP reconciler identity may define or mutate the Session/generation annotations; OpenShell, SPIRE, Runner, and agent identities are read-only or denied. Name-only, label-only, truncated-name, or UID-reuse inference is forbidden. Deletion makes lookup fail closed. This live annotation plus signed refresh or attestation generation is the authoritative mapping and adds no Session database, protobuf, or OpenAPI field.

Following RFC 8725 explicit-algorithm, explicit-typing, and audience-validation guidance, every verifier SHALL reject unsigned tokens, an algorithm outside the artifact's fixed profile, malformed base64/JSON/signatures, unknown headers or claims, duplicate header or claim names, multiple credential values, any `crit` header, missing or unknown required values, multiple audiences, wrong issuer/audience/purpose/Session, invalid Direct/Operator refresh binding, a generation unequal to live state, future `iat`/`nbf` outside skew, `now >= exp`, excessive lifetime, and unknown or retired `kid`. An audience valid for a different mode is wrong, not a compatible fallback. Errors SHALL be content-free and MUST NOT echo a token, assertion, payload, signature, claim value, service bearer, or key material.

Only an eligible Direct/Operator fallback Runner SHALL receive an exact-Session ensure capability and separate signed refresh credential; it SHALL never receive HMAC/RSA signing material, a resolve capability, or cross-Session authority. On Direct/Operator initial acquisition, reconnect, or ensure-capability expiry, the supervisor presents the refresh credential together with the current pod-bound projected identity to `/token` and requests exactly one signed-scope grant: `runtime-only` or `runtime-and-bootstrap-ensure`. Gateway, resume, authoritative-bootstrap, history-empty, and ordinary reconnect cannot request or retain ensure authority.

The CP SHALL choose the authentication branch from trusted deployment mode, never request fields. Direct/Operator requires its exact refresh profile plus ACP TokenReview at the fixed audience. Gateway requires only the Providers v2-injected ACP workload attestation and live binding; ACP MUST NOT TokenReview or accept a projected ServiceAccount token, OpenShell gateway JWT, raw SPIFFE JWT-SVID, HMAC workload token, refresh credential, or client mTLS key at Gateway `/token`. API middleware SHALL validate the returned runtime credential on every Runner REST/gRPC operation and compare the exact target Session to `session_id`; it SHALL NOT accept this credential as user, administrator, control-plane, cross-Session, or global service authority. For a Runner endpoint whose URL has no Session parameter, including credential-token fetch, middleware SHALL derive the Session only from the verified runtime credential and authorize the requested resource only when it is pre-bound to that exact Session; a caller-supplied project or credential ID cannot widen the scope.

CP SHALL renew Direct/Operator refresh credentials by controlled workload reprovision before signed expiry. A generation change immediately invalidates old Direct/Operator refresh credentials and Gateway attestations at `/token`; already-issued `session-runtime` credentials remain cryptographically valid for at most two minutes. CP SHALL quiesce and network-isolate the prior workload before activating a replacement generation. Immediate runtime-token invalidation requires a separate revocation mechanism and MUST NOT be claimed.

Gateway/OpenShell configuration SHALL reject provider fields that alter the fixed ACP token-grant endpoint, JWT-SVID audience, assertion type, resource audience, scope, protected endpoint, or trust domain. ACP MUST NOT invent an OpenShell TOML projected-token audience key or accept any provider-selected authorization branch.

Bootstrap-capability HMAC keys and refresh/service/attestation RSA keypairs SHALL be external secret material. Every HMAC key contains at least 256 bits of decoded random data and every RSA private key is at least 2048 bits. API server and control plane startup/readiness SHALL fail fast when a required key set or SPIFFE trust bundle is absent, invalid, low-diversity, a known test key, or contains a template marker. No default key, manifest literal, runtime-generated fallback, or Gateway-uploaded private key is permitted. Reconciliation SHALL update-or-create references and mounts idempotently but MUST NOT overwrite valid externally supplied key, trust-bundle, or CA material.

Bootstrap access, Direct/Operator refresh, service, and attestation key rings rotate independently; the SPIFFE trust bundle rotates under its issuer contract. Because HS256 is symmetric, CP and API both hold the bootstrap-capability HMAC ring and are equally capable cryptographic issuers, although API code SHALL use it only in the verifier path. CP alone mounts RSA private signing rings plus SPIFFE verification trust; API server mounts only RSA public verification rings. Runner receives no signing or verification key material and no SPIFFE Workload API socket. Each ring exposes an explicit current `kid`/key and MAY expose one previous verification key for overlap no longer than that artifact's maximum lifetime. Components SHALL atomically reload valid updates; new artifacts use only current keys, previous keys are verification-only during overlap, and retired/unknown keys fail. Reload failure preserves the last valid set and reports a content-free unhealthy state.

HMAC secrets and RSA or SPIFFE private keys MUST NEVER appear in any API response, Runner container, environment, log, error, status condition, SessionMessage, prompt, screenshot, or retained evidence. Gateway Runner additionally receives no projected identity, JWT-SVID, Workload API socket, ACP attestation, refresh credential, or ensure capability. Only the exact-Session runtime credential and expiry metadata, plus an explicitly eligible Direct/Operator ensure capability, may appear in the bounded `/token` response; none may reach the model or its child processes.

The authorization contract prevents accepted artifacts from being replayed beyond their exact Session, audience, purpose, endpoint, and lifetime. It does not claim containment after HMAC/RSA signing-key leakage or supervisor-private token leakage; either event is a security incident requiring key rotation, affected Session termination, and credential revocation. No bootstrap sequencing or exactly-once guarantee substitutes for secret confidentiality.

SessionMessages are never deleted or edited. They represent the conversation summary — what the user asked, what the agent replied, which tools were used.

**Examples:**
- User message: `"Please review the PR and suggest improvements"`
- Assistant message: `"I'll review the pull request. Let me read the files."`
- Tool use: `Read(file_path="src/main.go")`
- Tool result: Summary of file contents

**REST API:**
```
GET    /api/ambient/v1/sessions/{id}/messages     # List conversation messages (paginated)
POST   /api/ambient/v1/sessions/{id}/messages     # Push user message
```

**gRPC:**
```
rpc PushSessionMessage(PushSessionMessageRequest) returns (SessionMessage)
rpc WatchSessionMessages(WatchSessionMessagesRequest) returns (stream SessionMessage)
```

---

## SessionEvent — Comprehensive Event Stream (Events API)

SessionEvents provide the **complete, granular** AG-UI event stream emitted during session execution. This is the Events API — every tool call, every thinking token, every content delta, every state transition.

`seq` is monotonically increasing within a session (gaps allowed after compression), using an **independent counter** from `SessionMessage.seq`. The two tables serve different APIs at different granularities and compress at different rates — sharing a counter would create false ordering dependencies. `event_type` follows the full AG-UI protocol with 33 event types.

SessionEvents are never deleted or edited. They are the canonical **audit trail** of everything that happened during a session — ideal for debugging, replays, analytics, and compliance.

**Examples:**
- `RUN_STARTED` — session execution began
- `TEXT_MESSAGE_START` (role=assistant, message_id=msg_abc) — assistant started a message
- `TEXT_MESSAGE_CONTENT` (content="Let me check") — assistant emitted text (compressed from many deltas)
- `TOOL_CALL_START` (tool_name=Read, tool_call_id=tc_123) — tool invocation started
- `TOOL_CALL_ARGS` (args='{"file_path":"/app/main.go"}') — tool arguments (compressed from fragments)
- `TOOL_CALL_END` — tool invocation complete
- `TOOL_CALL_RESULT` (result="package main...") — tool execution result
- `THINKING_TEXT_MESSAGE_CONTENT` — extended thinking content (Claude 4+)
- `REASONING_MESSAGE_CONTENT` — reasoning trace (Gemini Deep Research)
- `RUN_FINISHED` — session execution completed

### Messages API vs Events API

| Aspect | Messages API (`session_messages`) | Events API (`session_events`) |
|--------|-----------------------------------|-------------------------------|
| **Purpose** | Human turns, trusted startup context, and conversation summary | Complete AG-UI event audit trail |
| **Granularity** | Message-level (prompts, replies, tool summaries) | Token-level (every delta, every event) |
| **Audience** | End users, conversation history UIs | Developers, debugging, analytics, compliance |
| **Event Types** | 7 simplified types (`user`, `bootstrap`, `assistant`, tool summaries, status) | 33 AG-UI event types (TEXT_MESSAGE_START, TOOL_CALL_ARGS, etc.) |
| **Volume** | ~10-100 messages per session | ~1,000-20,000 events per session (compressed) |
| **Compression** | No compression needed | Context-aware compression (5:1 to 20:1) |
| **Streaming** | gRPC watch + replay from DB | SSE proxy to runner pod (ephemeral) + persisted compressed events |

### Three Event Streams

| Endpoint | Source | Persistence | Purpose |
|---|---|---|---|
| `GET /sessions/{id}/messages` | gRPC `PushSessionMessage` | `session_messages` table | **Messages API** — human conversation plus trusted startup context |
| `GET /sessions/{id}/events` | Runner pod SSE (`/events/{thread_id}`) | Ephemeral in-memory queue | **Live Events** — real-time AG-UI events during active run |
| `GET /sessions/{id}/events/history` | gRPC `PushSessionEvent` | `session_events` table | **Events API** — complete persisted event audit trail |

The runner's `/events/{thread_id}` endpoint streams live AG-UI events via SSE during an active run. The API server proxies this from the runner pod (`GET /sessions/{id}/events`). These are **ephemeral** — disappear when the session ends.

Simultaneously, the runner's gRPC client pushes **compressed events** to `session_events` table for durable storage. These power the **Events API** (`GET /sessions/{id}/events/history`) for post-session replay, debugging, and analysis.

### Events API — Storage and Compression

The Events API stores the complete AG-UI event stream in the `session_events` table. Events are the atomic units of session execution: text deltas, tool calls, thinking blocks, state updates, and control flow markers.

#### AG-UI Event Types

Events follow the [AG-UI protocol](https://github.com/anthropics/ag-ui), a streaming protocol for agentic UIs. The protocol defines 33 event types organized into semantic categories:

| Category | Event Types | Purpose |
|----------|-------------|--------|
| **Run Lifecycle** | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` | Session execution boundaries |
| **Step Lifecycle** | `STEP_STARTED`, `STEP_FINISHED` | Multi-step execution boundaries (LangGraph pattern) |
| **Text Messages** | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` | User or assistant text content |
| **Tool Calls** | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` | Tool invocations and results |
| **Thinking** | `THINKING_START`, `THINKING_END`, `THINKING_TEXT_MESSAGE_START`, `THINKING_TEXT_MESSAGE_CONTENT`, `THINKING_TEXT_MESSAGE_END` | Extended thinking blocks (Claude 4+ models) |
| **Reasoning** | `REASONING_START`, `REASONING_END`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_ENCRYPTED_VALUE` | Reasoning trace (Gemini 2.5+ Deep Research) |
| **State** | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` | Bidirectional state sync (LangGraph pattern) |
| **Custom** | `RAW`, `CUSTOM` | Framework-specific or debug events |

Each event carries:
- `type` — event type from the enum above
- `run_id` — AG-UI run identifier (scoped to a single execution turn)
- `thread_id` — session identifier (maps to `session_id` in DB)
- Payload fields specific to the event type (e.g., `message_id`, `tool_id`, `content`, `args`)

**Note on Event Naming:** Thinking and Reasoning events are prefixed variants of base text message types. For example, `THINKING_TEXT_MESSAGE_CONTENT` is a distinct event type from `TEXT_MESSAGE_CONTENT`, emitted during extended thinking blocks. The prefixes indicate the semantic context (regular message vs thinking vs reasoning).

**Start/End Pairing:** Events with `_START` / `_END` suffixes define stream boundaries. Content events (`_CONTENT`, `_ARGS`, `_CHUNK`) appear between their corresponding start/end markers.

**Example sequence:**
```
RUN_STARTED
├── TEXT_MESSAGE_START (role=assistant, message_id=msg_abc)
│   ├── TEXT_MESSAGE_CONTENT (content="Let me")
│   ├── TEXT_MESSAGE_CONTENT (content=" check")
│   └── TEXT_MESSAGE_END
├── TOOL_CALL_START (tool_name=Read, tool_call_id=tc_123)
│   ├── TOOL_CALL_ARGS (args='{"file')
│   ├── TOOL_CALL_ARGS (args='_path":')
│   ├── TOOL_CALL_ARGS (args='"/app/file.txt"}')
│   └── TOOL_CALL_END
├── TOOL_CALL_RESULT (tool_call_id=tc_123, result="file contents...")
└── RUN_FINISHED
```

#### Event Compression

AG-UI events stream at **token-level granularity** — a single word or JSON fragment can emit one event. Without compression, sessions generate thousands of tiny rows (e.g., `TEXT_MESSAGE_CONTENT` with `"Let"`, then `" me"`, then `" check"`). This creates storage bloat and query overhead.

**Compression Strategy — Context-Aware Accumulation:**

Events are compressed **before persistence** by the runner's gRPC client. Compression groups consecutive events sharing the same **context** (message_id, tool_call_id, role). When the context changes or a boundary event arrives, the accumulated content is flushed as a single compressed event.

**Compression Rules:**

| Event Type | Compression Behavior |
|------------|---------------------|
| `TEXT_MESSAGE_START` | **Boundary** — flushes prior accumulated content; starts new message context |
| `TEXT_MESSAGE_CONTENT` | **Accumulate** — append `content` to buffer within current message context |
| `TEXT_MESSAGE_END` | **Boundary** — flushes accumulated content; ends message context |
| `TOOL_CALL_START` | **Boundary** — starts new tool call context |
| `TOOL_CALL_ARGS` | **Accumulate** — append `args` fragment to buffer within current tool context |
| `TOOL_CALL_END` | **Boundary** — flushes accumulated args; ends tool context |
| `TEXT_MESSAGE_CHUNK` | **Pass-through** — complete message in one event (no START/END wrapper); stored as-is |
| `TOOL_CALL_CHUNK` | **Pass-through** — complete tool call in one event (no START/END wrapper); stored as-is |
| `THINKING_TEXT_MESSAGE_CONTENT` | **Accumulate** — within thinking message context |
| `REASONING_MESSAGE_CONTENT` | **Accumulate** — within reasoning message context |
| All `_START`, `_END`, `_RESULT`, run/step lifecycle | **Never compressed** — stored as individual events |

**Accumulation Assumption:** `_CONTENT` and `_ARGS` fragments are raw character slices of a single value, not semantically complete units. The compressor concatenates them verbatim. For `TOOL_CALL_ARGS`, the accumulated result MUST be valid JSON — the compressor SHOULD validate the accumulated string before flushing and reject malformed payloads rather than persisting silently invalid data.

**Context Definition:**
- Text messages: `(message_id, role)`
- Tool calls: `(tool_call_id)`
- Thinking: `(message_id, thinking_id)`
- Reasoning: `(message_id, reasoning_id)`

**Flush Triggers:**
1. Context change (new message_id / tool_call_id)
2. Boundary event (`_START`, `_END`)
3. Event type transition (TEXT → TOOL, TOOL → TEXT)
4. Buffer size threshold (optional; e.g., 10 KB per compressed event)
5. Time threshold (optional; e.g., 5 seconds idle)

**Metadata Preservation:**
- `created_at` — timestamp of the **first** event in the compressed group
- `completed_at` — timestamp of the **last** event (new field on `SessionMessage`)
- `event_count` — number of raw events compressed into this row (new field)

**Example — Before Compression:**
```json
{"seq":10, "event_type":"TEXT_MESSAGE_START", "payload":"{\"message_id\":\"msg_1\",\"role\":\"assistant\"}"}
{"seq":11, "event_type":"TEXT_MESSAGE_CONTENT", "payload":"{\"content\":\"Let\"}"}
{"seq":12, "event_type":"TEXT_MESSAGE_CONTENT", "payload":"{\"content\":\" me\"}"}
{"seq":13, "event_type":"TEXT_MESSAGE_CONTENT", "payload":"{\"content\":\" check\"}"}
{"seq":14, "event_type":"TEXT_MESSAGE_END", "payload":"{}"}
```

**After Compression (with gaps):**
```json
{"seq":10, "event_type":"TEXT_MESSAGE_START", "payload":"{\"message_id\":\"msg_1\",\"role\":\"assistant\"}"}
{"seq":11, "event_type":"TEXT_MESSAGE_CONTENT", "payload":"{\"content\":\"Let me check\"}", "event_count":3, "completed_at":"2026-05-21T..."}
{"seq":14, "event_type":"TEXT_MESSAGE_END", "payload":"{}"}
```

**Note:** Sequence numbers preserve gaps after compression (11 → 14) to avoid renumbering all subsequent events. This makes compression idempotent and prevents race conditions with concurrent event streams.

**Space Savings:** Typical compression ratios range from **5:1** (simple text) to **20:1** (complex tool arguments with many JSON fragments).

**Backward Compatibility:** Existing queries and APIs continue to work. Compression is transparent to readers — gaps in `seq` indicate compressed ranges.

#### Storage Model

Compressed events are stored in the `session_events` table:

```sql
CREATE TABLE session_events (
    id           VARCHAR(36) PRIMARY KEY,
    session_id   VARCHAR(36) NOT NULL REFERENCES sessions(id),
    seq          BIGINT NOT NULL,
    event_type   VARCHAR(255) NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,          -- timestamp of last event in compressed group (NULL for uncompressed)
    event_count  INT DEFAULT 1,        -- number of raw events compressed (1 = uncompressed, >1 = compressed)
    UNIQUE(session_id, seq)
);

CREATE INDEX idx_session_events_session_id ON session_events(session_id);
CREATE INDEX idx_session_events_event_type ON session_events(event_type);
CREATE INDEX idx_session_events_created_at ON session_events(created_at);
CREATE INDEX idx_session_events_completed_at ON session_events(completed_at);
```

The `completed_at` index supports time-range queries that filter on the end-timestamp of compressed groups (e.g., "all events active during window T1–T2" requires `WHERE created_at <= T2 AND completed_at >= T1`).

#### Migration from Current State

**Database Schema Changes** (API server):

1. Create `session_events` table with compression fields:
   ```sql
   -- New table creation (no existing data to migrate)
   CREATE TABLE session_events (
       id           VARCHAR(36) PRIMARY KEY,
       session_id   VARCHAR(36) NOT NULL REFERENCES sessions(id),
       seq          BIGINT NOT NULL,
       event_type   VARCHAR(255) NOT NULL,
       payload      TEXT NOT NULL,
       created_at   TIMESTAMPTZ NOT NULL,
       completed_at TIMESTAMPTZ,
       event_count  INT DEFAULT 1,
       UNIQUE(session_id, seq)
   );

   CREATE INDEX idx_session_events_session_id ON session_events(session_id);
   CREATE INDEX idx_session_events_event_type ON session_events(event_type);
   CREATE INDEX idx_session_events_created_at ON session_events(created_at);
   CREATE INDEX idx_session_events_completed_at ON session_events(completed_at);
   ```

2. No column, protobuf field, or historical-row migration is required for the additive value. An index-only migration adds a partial unique constraint on `session_id` where `event_type = 'bootstrap'` to enforce cardinality under concurrent producers and uncertain acknowledgements.

**Backward Compatibility:**
- Compression is opt-in at the runner gRPC client level
- Legacy runners can continue pushing uncompressed events indefinitely (`event_count=1`, `completed_at=NULL`)
- API server accepts both compressed and uncompressed events transparently
- Existing `session_messages` rows remain unchanged; legacy startup-context rows encoded as `user` are not backfilled or rewritten

**Field Semantics:**

| Field | Description |
|-------|-------------|
| `seq` | Monotonic sequence within session; gaps allowed after compression |
| `event_type` | AG-UI event type enum (33 types: RUN_STARTED, TEXT_MESSAGE_START, TOOL_CALL_ARGS, etc.) |
| `payload` | JSON-encoded event payload; structure varies by event type |
| `created_at` | First event timestamp (for compressed events) or single event timestamp |
| `completed_at` | Last event timestamp for compressed events; `NULL` for uncompressed |
| `event_count` | Number of raw events compressed; `1` = uncompressed, `>1` = compressed |

#### API Endpoints

**Messages API** (human-readable conversation):
```
GET    /api/ambient/v1/sessions/{id}/messages                # List conversation messages (paginated)
POST   /api/ambient/v1/sessions/{id}/messages                # Push human user message (HTTP; event_type=user only; bootstrap rejected)
```

**Events API** (comprehensive AG-UI event stream):
```
GET    /api/ambient/v1/sessions/{id}/events                  # SSE proxy to runner pod (live, ephemeral, active sessions only)
GET    /api/ambient/v1/sessions/{id}/events/history          # List persisted compressed events (paginated)
```

**Query Parameters (GET /events/history):**

| Param | Type | Description |
|-------|------|-------------|
| `after_seq` | int64 | Return events with `seq > after_seq` (for replay/catch-up) |
| `event_type` | string | Filter by AG-UI event type (e.g., `TOOL_CALL_START`, `TEXT_MESSAGE_CONTENT`) |
| `limit` | int | Max events to return (default 100, max 1000) |
| `start_time` | ISO8601 | Filter events created after this timestamp |
| `end_time` | ISO8601 | Filter events created before this timestamp |

**Response (GET /events/history):**
```json
{
  "items": [
    {
      "id": "01HXY...",
      "session_id": "2abc...",
      "seq": 42,
      "event_type": "TEXT_MESSAGE_CONTENT",
      "payload": "{\"content\":\"Let me check the file\"}",
      "created_at": "2026-05-21T10:00:00Z",
      "completed_at": "2026-05-21T10:00:02Z",
      "event_count": 8
    },
    {
      "id": "01HXZ...",
      "session_id": "2abc...",
      "seq": 43,
      "event_type": "TOOL_CALL_START",
      "payload": "{\"tool_name\":\"Read\",\"tool_call_id\":\"tc_123\"}",
      "created_at": "2026-05-21T10:00:02Z",
      "completed_at": null,
      "event_count": 1
    }
  ],
  "page": 1,
  "size": 100,
  "total": 15234
}
```

#### gRPC Protocol

**Messages API** (concise conversation):
```protobuf
// Push a human-oriented message or trusted platform bootstrap input
rpc PushSessionMessage(PushSessionMessageRequest) returns (SessionMessage)

message PushSessionMessageRequest {
  string session_id = 1;
  string event_type = 2;  // Simplified: user | bootstrap | assistant | tool_use | tool_result | system | error
  string payload = 3;     // Message body or summary
}

message SessionMessage {
  string id = 1;
  string session_id = 2;
  int64 seq = 3;
  string event_type = 4;
  string payload = 5;
  google.protobuf.Timestamp created_at = 6;
}
```

**Events API** (comprehensive AG-UI stream):
```protobuf
// Push a compressed AG-UI event to the audit trail
rpc PushSessionEvent(PushSessionEventRequest) returns (SessionEvent)

message PushSessionEventRequest {
  string session_id = 1;
  string event_type = 2;                               // AG-UI event type (33 types)
  string payload = 3;                                  // JSON-encoded event payload
  optional google.protobuf.Timestamp completed_at = 4; // Last event timestamp (for compressed events)
  optional int32 event_count = 5;                      // Number of events compressed (default 1)
}

message SessionEvent {
  string id = 1;
  string session_id = 2;
  int64 seq = 3;
  string event_type = 4;
  string payload = 5;
  google.protobuf.Timestamp created_at = 6;
  optional google.protobuf.Timestamp completed_at = 7;
  int32 event_count = 8;
}
```

**Compression in gRPC Client:**

The runner's gRPC client (`ambient-runner` Python package) implements compression **before** calling `PushSessionEvent`. The compressor maintains:
- **Context stack** — tracks active message_id, tool_call_id, thinking_id, reasoning_id
- **Accumulation buffer** — collects content/args fragments for current context
- **Flush logic** — detects boundary events and context transitions

When a flush occurs, the compressor:
1. Concatenates accumulated fragments into a single payload
2. Attaches `event_count` and `completed_at` metadata
3. Calls `PushSessionEvent` once with the compressed event
4. Resets the accumulation buffer

**Dual Push Pattern:**

Runners emit **both** messages and events:
- `PushSessionMessage` — trusted fallback bootstrap input and high-level conversation turns (human prompts, assistant replies, tool summaries)
- `PushSessionEvent` — every AG-UI event (text deltas, tool args, thinking tokens, all compressed)

This provides both human-readable conversation history and complete audit trail.

**Implementation Note:** Compression is **opt-in per runner framework**. Legacy runners can push uncompressed events (stored with `event_count=1`). The API server and database accept both formats transparently.

---

## ScheduledSession — Recurring Agent Trigger

A `ScheduledSession` is a project-scoped definition that ignites an Agent on a recurring cron schedule. Each trigger creates a new Session with `session_prompt` injected as the task scope for that run.

| Field | Notes |
|-------|-------|
| `name` | Human-readable, unique within the project. |
| `agent_id` | Which Agent to ignite. Nullable — if NULL, creates a project-scoped session. |
| `schedule` | Standard cron expression (e.g. `"0 9 * * 1-5"` = 9 AM on weekdays). Validated at write time. |
| `timezone` | IANA timezone string (e.g. `"America/New_York"`). Defaults to `UTC`. |
| `enabled` | `false` suspends evaluation without deleting the schedule. |
| `overlap_policy` | `"skip"` (default) or `"allow"`. Controls whether a new session is created when the previous run from this schedule is still active. |
| `session_prompt` | Injected as `Session.prompt` on each trigger — the recurring task. |
| `last_run_at` | Wall-clock time of the last trigger. Null if never triggered. |
| `next_run_at` | Computed from `schedule` + `timezone`. Updated after each trigger. NULL when `enabled = false`. |

**Trigger semantics:** Each trigger creates a Session through `StartupService.CreatePending`, the shared transactional Session/bootstrap creation service also used beneath registered Agent Start behavior. The `overlap_policy` field controls behavior when a previous session from the same schedule is still active: `skip` (default) advances `next_run_at` without creating a new session; `allow` creates a new session regardless. See [Scheduled Session Execution spec](scheduled-session-execution.spec.md) for full execution semantics.

**Manual trigger:** `POST .../trigger` ignites the Agent immediately outside the cron schedule, using the same `session_prompt`. Useful for testing or one-off runs.

**Suspend / Resume:** `POST .../suspend` sets `enabled=false`; `POST .../resume` sets `enabled=true`. These are named convenience actions equivalent to `PATCH {enabled: false|true}`.

---

## CLI Reference (`acpctl`)

The `acpctl` CLI mirrors the API 1-for-1. Every REST operation has a corresponding command.

### API ↔ CLI Mapping

#### Projects

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /projects` | `acpctl get projects` | ✅ implemented |
| `GET /projects/{id}` | `acpctl get project <name>` | ✅ implemented |
| `POST /projects` | `acpctl create project --name <n> [--description <d>]` | ✅ implemented |
| `PATCH /projects/{id}` | `acpctl project update [--name <n>] [--description <d>] [--prompt <p>]` | ✅ implemented |
| `DELETE /projects/{id}` | `acpctl delete project <name>` | ✅ implemented |
| _(context switch)_ | `acpctl project <name>` | ✅ implemented |
| _(context view)_ | `acpctl project current` | ✅ implemented |

#### Agents (Project-Scoped)

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /projects/{id}/agents` | `acpctl agent list --project <p>` | ✅ implemented |
| `GET /projects/{id}/agents/{agent_id}` | `acpctl agent get --project <p> --agent-id <id>` | ✅ implemented |
| `POST /projects/{id}/agents` | `acpctl agent create --project <p> --name <n> [--prompt <p>]` | ✅ implemented |
| `PATCH /projects/{id}/agents/{agent_id}` | `acpctl agent update --project <p> --agent-id <id> [--name <n>] [--prompt <p>]` | ✅ implemented |
| `DELETE /projects/{id}/agents/{agent_id}` | `acpctl agent delete --project <p> --agent-id <id> --yes` | ✅ implemented |
| `POST /projects/{id}/agents/{agent_id}/start` | `acpctl start <agent-id> --project <p> [--prompt <t>]` | ✅ implemented |
| `GET /projects/{id}/agents/{agent_id}/start` | `acpctl agent start-preview --project <p> --agent-id <id>` | ✅ implemented |
| `GET /projects/{id}/agents/{agent_id}/sessions` | `acpctl agent sessions --project <p> --agent-id <id>` | ✅ implemented |
| `GET /projects/{id}/agents/{agent_id}/inbox` | `acpctl inbox list --project <p> --pa-id <id>` | ✅ implemented |
| `POST /projects/{id}/agents/{agent_id}/inbox` | `acpctl inbox send --project <p> --pa-id <id> --body <text>` | ✅ implemented |
| `PATCH /projects/{id}/agents/{agent_id}/inbox/{msg_id}` | `acpctl inbox mark-read --project <p> --pa-id <id> --msg-id <id>` | ✅ implemented |
| `DELETE /projects/{id}/agents/{agent_id}/inbox/{msg_id}` | `acpctl inbox delete --project <p> --pa-id <id> --msg-id <id>` | ✅ implemented |

#### Sessions

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /sessions` | `acpctl get sessions` | ✅ implemented |
| `GET /sessions` | `acpctl get sessions -w` | ✅ implemented (gRPC watch) |
| `GET /sessions/{id}` | `acpctl get session <id>` | ✅ implemented |
| `GET /sessions/{id}` | `acpctl describe session <id>` | ✅ implemented |
| `DELETE /sessions/{id}` | `acpctl delete session <id>` | ✅ implemented |
| `GET /sessions/{id}/messages` | `acpctl session messages <id>` | ✅ implemented |
| `POST /sessions/{id}/messages` | `acpctl session send <id> <message>` | ✅ implemented |
| `POST /sessions/{id}/messages` + `GET /sessions/{id}/events` | `acpctl session send <id> <message> -f` | ✅ implemented |
| `POST /sessions/{id}/messages` + `GET /sessions/{id}/events` | `acpctl session send <id> <message> -f --json` | ✅ implemented |
| `GET /sessions/{id}/events` | `acpctl session events <id>` | ✅ implemented |

#### ScheduledSessions (Project-Scoped)

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /projects/{id}/scheduled-sessions` | `acpctl scheduled-session list` | ✅ implemented |
| `GET /projects/{id}/scheduled-sessions/{sched_id}` | `acpctl scheduled-session get <name>` | ✅ implemented |
| `POST /projects/{id}/scheduled-sessions` | `acpctl scheduled-session create --name <n> --agent-id <a> --schedule <cron> [--prompt <p>] [--timezone <tz>]` | ✅ implemented |
| `PATCH /projects/{id}/scheduled-sessions/{sched_id}` | `acpctl scheduled-session update <name> [--schedule <cron>] [--prompt <p>] [--enabled=false]` | ✅ implemented |
| `DELETE /projects/{id}/scheduled-sessions/{sched_id}` | `acpctl scheduled-session delete <name> --yes` | ✅ implemented |
| `POST .../suspend` | `acpctl scheduled-session suspend <name>` | ✅ implemented |
| `POST .../resume` | `acpctl scheduled-session resume <name>` | ✅ implemented |
| `POST .../trigger` | `acpctl scheduled-session trigger <name>` | ✅ implemented |
| `GET .../runs` | `acpctl scheduled-session runs <name>` | ✅ implemented |

#### Session Operations

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /sessions/{id}/workspace` | `acpctl session workspace list <id>` | 🔲 planned |
| `GET /sessions/{id}/workspace/*path` | `acpctl session workspace get <id> <path>` | 🔲 planned |
| `PUT /sessions/{id}/workspace/*path` | `acpctl session workspace put <id> <path> [--file <f>]` | 🔲 planned |
| `DELETE /sessions/{id}/workspace/*path` | `acpctl session workspace delete <id> <path>` | 🔲 planned |
| `GET /sessions/{id}/files` | `acpctl session files list <id>` | 🔲 planned |
| `PUT /sessions/{id}/files/*path` | `acpctl session files upload <id> <path> [--file <f>]` | 🔲 planned |
| `DELETE /sessions/{id}/files/*path` | `acpctl session files delete <id> <path>` | 🔲 planned |
| `GET /sessions/{id}/git/status` | `acpctl session git status <id>` | 🔲 planned |
| `POST /sessions/{id}/git/configure-remote` | `acpctl session git configure-remote <id>` | 🔲 planned |
| `GET /sessions/{id}/git/branches` | `acpctl session git branches <id>` | 🔲 planned |
| `GET /sessions/{id}/repos/status` | `acpctl session repos list <id>` | 🔲 planned |
| `POST /sessions/{id}/repos` | `acpctl session repos add <id> --repo <url>` | 🔲 planned |
| `DELETE /sessions/{id}/repos/{name}` | `acpctl session repos remove <id> <repo>` | 🔲 planned |
| `POST /sessions/{id}/clone` | `acpctl session clone <id> [--name <n>]` | 🔲 planned |
| `POST /sessions/{id}/model` | `acpctl session model <id> --model <m>` | 🔲 planned |
| `GET /sessions/{id}/export` | `acpctl session export <id>` | 🔲 planned |
| `GET /sessions/{id}/pod-events` | `acpctl session pod-events <id>` | 🔲 planned |
| `GET /sessions/{id}/tasks` | `acpctl session tasks <id>` | 🔲 planned |
| `POST /sessions/{id}/tasks/{task_id}/stop` | `acpctl session tasks stop <id> <task-id>` | 🔲 planned |
| `GET /sessions/{id}/tasks/{task_id}/output` | `acpctl session tasks output <id> <task-id>` | 🔲 planned |

#### Applications (GitOps)

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /applications` | `acpctl get applications` | 🔲 planned |
| `GET /applications/{id}` | `acpctl get application <name>` | 🔲 planned |
| `POST /applications` | `acpctl create application --name <n> --repo <url> --path <p> [--revision <r>] [--project <p>] [--ambient-url <u>]` | 🔲 planned |
| `PATCH /applications/{id}` | `acpctl update application <name> [--repo <url>] [--path <p>] [--auto-sync] [--auto-prune] [--self-heal]` | 🔲 planned |
| `DELETE /applications/{id}` | `acpctl delete application <name> --yes` | 🔲 planned |
| `POST /applications/{id}/sync` | `acpctl sync application <name> [--prune] [--revision <r>]` | 🔲 planned |
| `POST /applications/{id}/refresh` | `acpctl refresh application <name>` | 🔲 planned |
| `GET /applications/{id}/status` | `acpctl get application <name> -o wide` | 🔲 planned |

#### Credentials (Global)

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /credentials` | `acpctl credential list [--provider <p>]` | ✅ implemented |
| `POST /credentials` | `acpctl credential create --name <n> --provider <p> --token <t\|@->  [--url <u>] [--email <e>] [--description <d>]` | ✅ implemented |
| `GET /credentials/{cred_id}` | `acpctl credential get <id>` | ✅ implemented |
| `PATCH /credentials/{cred_id}` | `acpctl credential update <id> [--token <t>] [--description <d>]` | ✅ implemented |
| `DELETE /credentials/{cred_id}` | `acpctl credential delete <id> --yes` | ✅ implemented |
| `GET /credentials/{cred_id}/token` | `acpctl credential token <id>` | ✅ implemented |
| `POST /role_bindings` | `acpctl credential bind <cred-name> --project <project>` | ✅ implemented |

#### RBAC

| REST API | `acpctl` Command | Status |
|---|---|---|
| `GET /roles` | `acpctl get roles` | ✅ implemented |
| `GET /roles/{id}` | `acpctl get roles <id>` | ✅ implemented |
| `POST /roles` | `acpctl create role --name <n> [--permissions <json>]` | ✅ implemented |
| `DELETE /roles/{id}` | `acpctl delete role <id>` | ✅ implemented |
| `GET /role_bindings` | `acpctl get role-bindings` | ✅ implemented |
| `GET /role_bindings/{id}` | `acpctl get role-bindings <id>` | ✅ implemented |
| `POST /role_bindings` | `acpctl create role-binding --role-id <r> --scope <s> [--user-id <u>] [--project-fk <p>] [--agent-id-fk <a>] [--session-id-fk <s>] [--credential-id-fk <c>]` | ✅ implemented |
| `DELETE /role_bindings/{id}` | `acpctl delete role-binding <id>` | ✅ implemented |

#### Auth & Context

| Operation | `acpctl` Command | Status |
|---|---|---|
| Authenticate | `acpctl login [SERVER_URL] --token <t>` | ✅ implemented |
| Log out | `acpctl logout` | ✅ implemented |
| Identity | `acpctl whoami` | ✅ implemented |
| Config get | `acpctl config get <key>` | ✅ implemented |
| Config set | `acpctl config set <key> <value>` | ✅ implemented |

### `acpctl apply` — Declarative Fleet Management

`acpctl apply` reconciles Projects and Agents from declarative YAML files, mirroring `kubectl apply` semantics. It is the primary way to provision and update entire agent fleets from the `.ambient/teams/` directory tree.

#### Supported Kinds

| Kind | Fields applied |
|---|---|
| `Project` | `name`, `description`, `prompt`, `labels`, `annotations` |
| `Agent` | `name`, `prompt`, `providers`, `payloads`, `environment`, `entrypoint`, `sandbox_policy`, `sandbox_template`, `labels`, `annotations`, `inbox` (seed messages) |
| `Credential` | `name`, `description`, `provider`, `token` (env var reference), `url`, `email`, `labels`, `annotations` — global resource; use `credential bind` to grant project access |
| `Gateway` | `name`, `project`, `image`, `serverDnsNames`, `config`, `labels`, `annotations` — project-scoped; declares an OpenShell gateway deployment in the project namespace |
| `Policy` | `name`, `spec`, `labels`, `annotations` — project-scoped; declares a sandbox policy containing upstream OpenShell `SandboxPolicy` JSON. Referenced by agents via `sandbox_policy` field. See [agent-sandbox-config.spec.md](./agent-sandbox-config.spec.md) § Policy Declarations |

`Agent` resources in `.ambient/teams/` files also carry an `inbox` list of seed messages. On apply, any message in the list is posted to the agent's inbox if an identical message (same `from_name` + `body`) does not already exist there.

#### `-f` — File or Directory

```sh
acpctl apply -f <file>               # apply a single YAML file
acpctl apply -f <dir>                # apply all *.yaml files in the directory (non-recursive)
acpctl apply -f -                    # read from stdin
```

Each file may contain one or more YAML documents separated by `---`. Documents with unrecognised `kind` values are skipped with a warning.

Apply behaviour per resource:
- **Project**: if a project with `name` already exists, `PATCH` it (description, prompt, labels, annotations). If it does not exist, `POST` to create it.
- **Agent**: resolved within the current project context. If an agent with `name` already exists in the project, `PATCH` it (prompt, providers, payloads, environment, entrypoint, sandbox_policy, sandbox_template, labels, annotations). If it does not exist, `POST` to create it. Payloads are stored as JSONB on the agent record and uploaded to the sandbox via SSH-over-gRPC before the entrypoint launches. After upsert, post any inbox seed messages not already present.
- **Policy**: resolved within the current project context. If a policy with `name` already exists in the project, `PATCH` it (spec, labels, annotations). If it does not exist, `POST` to create it. The `spec` field contains the upstream OpenShell `SandboxPolicy` JSON — see [agent-sandbox-config.spec.md](./agent-sandbox-config.spec.md) § Policy Declarations.

Output (default — one line per resource):

```
project/ambient-platform configured
agent/lead configured
agent/api created
agent/fe created
```

With `-o json`: JSON array of all applied resources.

#### `-k` — Kustomize Directory

```sh
acpctl apply -k <dir>                # build kustomization in <dir> and apply the result
```

Equivalent to: build the kustomization (resolve `bases`, `resources`, merge `patches`) into a flat manifest stream, then apply each document in order.

The kustomization schema is a subset of Kubernetes Kustomize, restricted to the fields meaningful for Ambient resources:

```yaml
kind: Kustomization

resources:           # relative paths to YAML files included in this build
  - project.yaml
  - lead.yaml

bases:               # other kustomization directories to include first
  - ../../base

patches:             # strategic-merge patches applied after resource collection
  - path: project-patch.yaml
    target:
      kind: Project
      name: ambient-platform
  - path: agents-patch.yaml
    target:
      kind: Agent   # no name = apply to all Agent resources
```

Patches use **strategic merge**: scalar fields overwrite, maps merge, sequences replace.

Output is identical to `-f`.

#### Examples

```sh
## Apply the full base fleet
acpctl apply -f .ambient/teams/base/

## Apply the dev overlay (resolves base + patches)
acpctl apply -k .ambient/teams/overlays/dev/

## Apply a single agent file
acpctl apply -f .ambient/teams/base/lead.yaml

## Dry-run: show what would change without applying
acpctl apply -k .ambient/teams/overlays/prod/ --dry-run

## Pipe from stdin
cat lead.yaml | acpctl apply -f -
```

#### Flags

| Flag | Description |
|---|---|
| `-f <path>` | File, directory, or `-` for stdin. Mutually exclusive with `-k`. |
| `-k <dir>` | Kustomize directory. Mutually exclusive with `-f`. |
| `--dry-run` | Print what would be applied without making API calls. |
| `-o json` | JSON output (array of applied resources). |
| `--project <name>` | Override project context for Agent resources. |

#### Status column

| Output | Meaning |
|---|---|
| `created` | Resource did not exist; POST succeeded. |
| `configured` | Resource existed; PATCH applied one or more changes. |
| `unchanged` | Resource existed and matched desired state; no API call made. |

#### CLI reference row additions

| Command | Status |
|---|---|
| `acpctl apply -f <path>` | ✅ implemented |
| `acpctl apply -k <dir>` | ✅ implemented |

### Global Flags

| Flag | Description |
|---|---|
| `--insecure-skip-tls-verify` | Skip TLS certificate verification |
| `-o json` | JSON output (most `get`/`create` commands) |
| `-o wide` | Wide table output |
| `--limit <n>` | Max items to return (default: 100) |
| `-w` / `--watch` | Live watch mode (sessions only) |
| `--watch-timeout <duration>` | Watch timeout (default: 30m) |

### Project Context

The CLI maintains a current project context in `~/.acpctl/config.yaml` (also overridable via `AMBIENT_PROJECT` env var). Most operations that require `project_id` read it from context automatically.

```sh
acpctl login https://api.example.com --token $TOKEN
acpctl project my-project
acpctl get sessions
acpctl create agent --name overlord --prompt "You coordinate the fleet..."
acpctl start overlord
```

---

## API Reference

### Authenticated User

```
GET    /api/ambient/v1/users/me                             canonical authenticated User
```

The response SHALL be derived from server-authenticated principal mapping and SHALL include the stable opaque `User.id`. It SHALL NOT require a client to parse identity claims or search the User collection for itself.

### Enterprise Assistant Self-Service

```
GET    /api/ambient/v1/users/me/enterprise-agent              discover authoritative generated state
POST   /api/ambient/v1/users/me/enterprise-agent/preview      preview canonical generated state without mutation
PUT    /api/ambient/v1/users/me/enterprise-agent              conditionally create or reconcile generated state
```

The exact bodies, headers, statuses, ownership rules, managed-memory state, and provider boundary are defined only in the [Enterprise Assistant Lifecycle Specification](enterprise-assistant/lifecycle.spec.md).

### Projects

```
GET    /api/ambient/v1/projects                              list projects
POST   /api/ambient/v1/projects                              create project
GET    /api/ambient/v1/projects/{id}                         read project
PATCH  /api/ambient/v1/projects/{id}                         update project
DELETE /api/ambient/v1/projects/{id}                         delete project

GET    /api/ambient/v1/projects/{id}/role_bindings           RBAC bindings scoped to this project
```

### Platform Providers (Project-Scoped)

```
GET    /api/ambient/v1/projects/{id}/providers               list Platform Providers in this project
POST   /api/ambient/v1/projects/{id}/providers               create a Platform Provider
GET    /api/ambient/v1/projects/{id}/providers/{provider_id} read a Platform Provider
PATCH  /api/ambient/v1/projects/{id}/providers/{provider_id} update a Platform Provider
DELETE /api/ambient/v1/projects/{id}/providers/{provider_id} delete a Platform Provider
```

A Platform Provider is an API/DB resource and is distinct from a GitOps-only OpenShell Provider Declaration. The control plane may project an authorized Platform Provider into an OpenShell Provider instance for one workload.

### Agents (Project-Scoped)

```
GET    /api/ambient/v1/projects/{id}/agents                  list agents in this project
POST   /api/ambient/v1/projects/{id}/agents                  create agent
GET    /api/ambient/v1/projects/{id}/agents/{agent_id}       read agent
PATCH  /api/ambient/v1/projects/{id}/agents/{agent_id}       update agent (name, prompt, labels, annotations)
DELETE /api/ambient/v1/projects/{id}/agents/{agent_id}       soft delete

POST   /api/ambient/v1/projects/{id}/agents/{agent_id}/start     start — creates Session (idempotent; one active at a time)
GET    /api/ambient/v1/projects/{id}/agents/{agent_id}/start     preview start context (dry run — no session created)
GET    /api/ambient/v1/projects/{id}/agents/{agent_id}/sessions  session run history
GET    /api/ambient/v1/projects/{id}/agents/{agent_id}/inbox     read inbox (unread first)
POST   /api/ambient/v1/projects/{id}/agents/{agent_id}/inbox     send message to this agent's inbox
PATCH  /api/ambient/v1/projects/{id}/agents/{agent_id}/inbox/{msg_id}   mark message read
DELETE /api/ambient/v1/projects/{id}/agents/{agent_id}/inbox/{msg_id}   delete message

GET    /api/ambient/v1/projects/{id}/agents/{agent_id}/role_bindings    RBAC bindings
```

#### Ignite Response

`POST /projects/{id}/agents/{agent_id}/start` is idempotent:
- If a session is already active, it is returned as-is.
- If no active session exists, a new one is created.
- Unread Inbox messages are drained (marked read) and injected into the start context.
- When human-authored task text exists, it is persisted first as `event_type=user`; the complete composed bootstrap payload is then persisted once as `event_type=bootstrap` before the Session can run.
- Returning an existing active Session appends neither message.

```json
{
  "session": {
    "id": "2abc...",
    "agent_id": "1def...",
    "phase": "pending",
    "created_at": "2026-03-20T00:00:00Z"
  },
  "starting_prompt": "# Agent: API\n\nYou are API...\n\n## Inbox\n...\n\n## Task\n..."
}
```

The start context assembles in order:
1. `Project.prompt` (workspace context — shared by all agents in this project)
2. `Agent.prompt` (who you are)
3. Drained Inbox messages (what others have asked you to do)
4. `Session.prompt` (what this run is focused on)
5. Peer Agent roster with latest status

That composition is an ordinary-Session compatibility path. For a provenanced
Enterprise Agent, `Agent.prompt` may carry only a byte-identical internal copy of
the verified system instructions and SHALL be excluded from bootstrap assembly.
The immutable snapshot's `system_instructions` go unchanged only to Gemini's
privileged system channel; `user_instruction_context` goes separately to its
lower-priority user-context channel. Neither field is persisted as bootstrap or
recombined with the other. Authorized human task/message input remains ordinary
user context. Project, Inbox, and Session compatibility behavior for ordinary
Sessions is unchanged.

### Sessions

Root conversations use Agent Start. The existing direct create/start compatibility path MAY be used by an authorized orchestration client for a child Session with explicit Agent and parent lineage.

```
GET    /api/ambient/v1/sessions                                              list sessions
POST   /api/ambient/v1/sessions                                              create an authorized child or compatibility Session
GET    /api/ambient/v1/sessions/{id}                                         read session
POST   /api/ambient/v1/sessions/{id}/start                                   start a created Session
DELETE /api/ambient/v1/sessions/{id}                                         cancel or delete session

GET    /api/ambient/v1/sessions/{id}/messages                                list messages (history)
POST   /api/ambient/v1/sessions/{id}/messages                                push a message (human turn)
GET    /api/ambient/v1/sessions/{id}/events                                  SSE live event stream from runner pod
GET    /api/ambient/v1/sessions/{id}/role_bindings                           RBAC bindings
```

#### Session Messages (Current Read Paths and Desired Metadata Resolver)

```
GET    /api/ambient/v1/sessions/{id}/messages                                current Session list; bare array, after_seq cursor
GET    /api/ambient/v1/session_messages                                      current top-level compatibility list
GET    /api/ambient/v1/internal/sessions/{id}/message-metadata               desired service-only metadata resolver
```

The existing Session list response and `after_seq` behavior SHALL remain unchanged for UI, CLI, and extension consumers. The current top-level compatibility route remains documented but MUST NOT be used for CP startup resolution because it does not provide the required bounded, Session-identity-safe contract.

The additive `SessionMessageMetadata` resolver SHALL require normal service authentication plus a `session-bootstrap-resolve` capability for the exact Session. It SHALL read `bootstrap_count`, `max_seq`, and bootstrap sequences from one consistent database snapshot and return metadata only:

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `bootstrap_limit` | `2` | Return at most two ascending bootstrap sequences while preserving the exact snapshot count |

Examples:
```
GET /api/ambient/v1/internal/sessions/01HABC/message-metadata?bootstrap_limit=2
```

Response shape:
```json
{
  "session_id": "01HABC",
  "bootstrap_count": 1,
  "max_seq": 42,
  "bootstrap_seqs": [42]
}
```

All four response fields are required. `bootstrap_count` is the exact bootstrap cardinality and `max_seq` is the maximum across all SessionMessages in the same snapshot; because persisted sequences are positive, `max_seq=0` if and only if the Session has no message history. Zero bootstrap with nonzero human or legacy history is valid metadata, not corruption. `bootstrap_seqs` SHALL be unique, positive, ascending, and contain at most the first two sequences. When `bootstrap_count <= 2`, its value MUST equal `len(bootstrap_seqs)`; when corruption produces `bootstrap_count > 2`, exactly two sequences are returned and fresh execution fails on the count. Every sequence MUST be less than or equal to `max_seq`. A missing field, wrong Session, negative count or maximum, invalid ordering, duplicate sequence, count/list mismatch under these rules, or sequence greater than `max_seq` is an invalid response and MUST fail closed.

The SDK SHALL expose this as `ResolveSessionMessageMetadata(session_id)`. Query failure is distinct from an empty result. `INITIAL_HISTORY_EMPTY=true` is valid only when one successful snapshot reports `bootstrap_count=0`, `max_seq=0`, an empty `bootstrap_seqs`, every applicable Project/Agent/Inbox/Session context read succeeded, and the composed compatibility prompt is empty. A context read or assembly error is failure, never empty proof. The proof is mutually exclusive with resume state, `INITIAL_BOOTSTRAP_SEQ`, fallback input, and resolver/assembly error. This additive resolver does not change either existing list response and SHALL NOT expose a payload, digest, prompt, message ID, event type, timestamp, transcript row, capability, or secret.

### Applications (GitOps)

```
GET    /api/ambient/v1/applications                  list all applications
POST   /api/ambient/v1/applications                  create application
GET    /api/ambient/v1/applications/{id}              read application (includes status)
PATCH  /api/ambient/v1/applications/{id}              update application
DELETE /api/ambient/v1/applications/{id}              delete application

POST   /api/ambient/v1/applications/{id}/sync         trigger sync (apply target state to live state)
POST   /api/ambient/v1/applications/{id}/refresh      refresh (fetch git, diff against live, update sync_status)
GET    /api/ambient/v1/applications/{id}/status       read sync/health status and per-resource detail
```

#### Sync Request

`POST /applications/{id}/sync` accepts an optional body:

```json
{
  "prune": true,
  "revision": "abc123"
}
```

`prune` overrides the application-level `auto_prune` for this sync only. `revision` overrides `source_target_revision` for a one-time sync at a specific commit.

#### Status Response

`GET /applications/{id}/status` returns the sync and health detail:

```json
{
  "sync_status": "Synced",
  "health_status": "Healthy",
  "sync_revision": "abc123def456",
  "last_synced_at": "2026-06-03T12:05:00Z",
  "operation_phase": "Succeeded",
  "operation_message": "3 created, 1 configured, 0 pruned",
  "resource_status": [
    {"kind": "Project", "name": "my-fleet", "status": "Synced", "health": "Healthy", "message": "created"},
    {"kind": "Agent", "name": "lead", "status": "Synced", "health": "Healthy", "message": "configured"},
    {"kind": "Agent", "name": "engineer", "status": "Synced", "health": "Healthy", "message": "unchanged"}
  ],
  "conditions": []
}
```

#### Workspace Files

Read and write files in a running session's workspace. Session must be in `Running` phase.

```
GET    /api/ambient/v1/sessions/{id}/workspace                               list workspace files
GET    /api/ambient/v1/sessions/{id}/workspace/*path                         read file content
PUT    /api/ambient/v1/sessions/{id}/workspace/*path                         write file content
DELETE /api/ambient/v1/sessions/{id}/workspace/*path                         delete file
```

#### Pre-Upload Files

Stage files into S3 before the session pod starts. Files are hydrated into the workspace at start time. Max 10 MB per file.

```
GET    /api/ambient/v1/sessions/{id}/files                                   list staged files
PUT    /api/ambient/v1/sessions/{id}/files/*path                             stage a file
DELETE /api/ambient/v1/sessions/{id}/files/*path                             remove staged file
```

#### Git

```
GET    /api/ambient/v1/sessions/{id}/git/status                              git status in session workspace
POST   /api/ambient/v1/sessions/{id}/git/configure-remote                    configure git remote
GET    /api/ambient/v1/sessions/{id}/git/branches                            list branches
```

#### Repos

Attach additional repositories to a session workspace.

```
GET    /api/ambient/v1/sessions/{id}/repos/status                            list attached repos and clone status
POST   /api/ambient/v1/sessions/{id}/repos                                   attach an additional repo
DELETE /api/ambient/v1/sessions/{id}/repos/{repo_name}                       detach a repo
```

#### Operational

```
POST   /api/ambient/v1/sessions/{id}/clone                                   clone session (new session from same config)
PATCH  /api/ambient/v1/sessions/{id}/displayname                             update display name
POST   /api/ambient/v1/sessions/{id}/model                                   switch active model
GET    /api/ambient/v1/sessions/{id}/workflow/metadata                       get active workflow and metadata
POST   /api/ambient/v1/sessions/{id}/workflow                                select workflow
GET    /api/ambient/v1/sessions/{id}/pod-events                              Kubernetes pod events for this session
GET    /api/ambient/v1/sessions/{id}/oauth/{provider}/url                    get OAuth redirect URL for provider
GET    /api/ambient/v1/sessions/{id}/export                                  export session transcript
```

Generic `POST /sessions/{id}/model` SHALL return HTTP 409 for a Session whose
immutable launch snapshot identifies a provenanced Enterprise Agent. Its model is template-owned
and immutable for that Session; neither a human, platform service, Runner, SDK,
CLI, nor generic Session mutation may replace it. Ordinary Sessions retain the
documented runtime-switch behavior.

#### Runner Protocol

These endpoints proxy directly to the runner pod. Session must be in `Running` phase. Returns `502` if the runner is unreachable.

```
POST   /api/ambient/v1/sessions/{id}/interrupt                               interrupt the active run
POST   /api/ambient/v1/sessions/{id}/feedback                                submit feedback event (Langfuse)
GET    /api/ambient/v1/sessions/{id}/capabilities                            runner framework and capabilities
GET    /api/ambient/v1/sessions/{id}/mcp/status                              MCP server instance status
GET    /api/ambient/v1/sessions/{id}/tasks                                   list background tasks
GET    /api/ambient/v1/sessions/{id}/tasks/{task_id}/output                  get task output (max 10 MB)
POST   /api/ambient/v1/sessions/{id}/tasks/{task_id}/stop                    stop background task
```

### Credentials (Global)

Credentials are global resources. Access to credentials is granted via RoleBindings — bind a
credential to a Project, Agent, or Session scope to make it available to runners in that scope.

**Designed paths (global — pending implementation):**
```
GET    /api/ambient/v1/credentials                                        list credentials (filtered by caller's RoleBindings)
GET    /api/ambient/v1/credentials?provider={provider}                    filter by provider
POST   /api/ambient/v1/credentials                                        create a credential
GET    /api/ambient/v1/credentials/{cred_id}                              read credential (metadata only; token never returned)
PATCH  /api/ambient/v1/credentials/{cred_id}                              update credential
DELETE /api/ambient/v1/credentials/{cred_id}                              soft delete
GET    /api/ambient/v1/credentials/{cred_id}/token                        fetch raw token — restricted to credential:token-reader
```

> **Note:** `credential bind` uses `POST /role_bindings` with `scope=credential`, `credential_id`, and `project_id`.

`token` is accepted on `POST` and `PATCH` but **never returned** by standard read endpoints.
`GET .../token` is gated by `credential:token-reader`. See
[Security Spec — Token Reader Role Grant](../security/identity-boundaries.spec.md#requirement-token-reader-role-grant) for
runtime authorization semantics.

#### Provider Enum

| Provider | Service | Token type | `url` | `email` |
|----------|---------|------------|-------|---------|
| `github` | GitHub.com or GitHub Enterprise | Personal Access Token | optional; required for GHE | — |
| `gitlab` | GitLab.com or self-hosted | Personal Access Token | optional; required for self-hosted | — |
| `jira` | Jira Cloud (Atlassian) | API Token | required (Atlassian instance URL) | required (used in Basic auth) |
| `google` | Google Cloud / Workspace | Service Account JSON serialized to string | — | — |
| `vertex` | Vertex AI (GCP) | GCP service account key | — | — |
| `kubeconfig` | Kubernetes clusters | Kubeconfig file serialized to string | — | — |

#### Token Response Shape (Runner)

When a runner fetches a credential, the response payload shape is consistent across providers:

```json
{ "provider": "gitlab", "token": "glpat-...",       "url": "https://gitlab.myco.com" }
{ "provider": "github", "token": "github_pat_...",  "url": "https://github.com" }
{ "provider": "jira",   "token": "ATATT3x...",      "url": "https://myco.atlassian.net", "email": "bot@myco.com" }
{ "provider": "google", "token": "{\"type\":\"service_account\", ...}" }
```

`token` is always present. `url` and `email` are included when set. Google's token field carries the full Service Account JSON serialized as a string.

---

## RBAC

### RoleBinding — Nullable FK Design

`RoleBinding` is a typed nullable-FK table. There is no polymorphic `scope_id`
string; every stored identifier points to a real table with referential
integrity. Database checks SHALL admit only these exact shapes:

<!-- markdownlint-disable MD013 -->

| Shape | `scope` | `user_id` | `project_id` | `agent_id` | `session_id` | `credential_id` |
|---|---|---|---|---|---|---|
| Global user grant | `global` | set | null | null | null | null |
| Ordinary Project grant | `project` | set | set | null | null | null |
| Ordinary Agent grant | `agent` | set | null | set | null | null |
| Ordinary Session grant | `session` | set | null | null | set | null |
| User-to-Credential ownership or read grant | `credential` | set | null | null | null | set |
| Credential recipient Project | `credential` | null | set | null | null | set |
| Managed Credential recipient Agent | `credential` | null | set | set | null | set |

<!-- markdownlint-enable MD013 -->

Every other nullability combination SHALL fail a database check and API
validation. In particular, `session_id` cannot accompany credential scope;
ordinary project, Agent, and Session grants name exactly one resource plus the
canonical user subject; and only the two credential-recipient shapes may combine
multiple resource foreign keys. The managed Project-plus-Agent-plus-Credential
shape additionally requires the platform-internal `credential:consumer` role,
complete Enterprise Agent provenance, and exact Project/Agent consistency.

`user_id` contains the canonical opaque `User.id` for a user-specific grant and
is null only for the two credential-recipient shapes. Authenticated
username, email, and external-subject values are lookup inputs only; the server
SHALL resolve them to one User before creating or evaluating a binding. Legacy
username-valued rows follow the fail-closed migration contract above.

| Use case | `user_id` | scope FK | Meaning |
|---|---|---|---|
| User A owns Credential Y | `user_id=A` | `credential_id=Y` | A can CRUD credential Y |
| Credential Y bound to Project X | `user_id=NULL` | `credential_id=Y` + `project_id=X` | Project X can access credential Y |
| User A is project:owner of Project X | `user_id=A` | `project_id=X` | A owns project X |
| Global platform:admin grant | `user_id=A` | _(none)_ | A has platform-wide admin |

For credential-to-Project bindings, both `credential_id` and `project_id` are
non-null. An Enterprise Agent managed-Credential entitlement is the narrower
Project-plus-Agent recipient shape: `scope=credential`, `credential_id`,
`project_id`, and `agent_id` are non-null; `user_id` and `session_id` are null;
and the platform-internal `credential:consumer` role limits resolution to exact
Sessions of that Agent. These are allowed shapes, not exceptions to an
otherwise contradictory one-FK invariant.

### Scopes

| Scope | FK set | Meaning |
|---|---|---|
| `global` | _(none)_ | Applies across the entire platform |
| `project` | `project_id` | Applies to all resources in a specific project |
| `agent` | `agent_id` | Applies to a specific Agent and all its sessions |
| `session` | `session_id` | Applies to one session run only |
| `credential` | `credential_id` | Governs access to a specific Credential |
| `credential` plus Project recipient | `credential_id`, `project_id` | Makes one Credential available to one Project |
| `credential` plus Agent recipient | `credential_id`, `project_id`, `agent_id` | Platform-internal use-only entitlement for exact Sessions of one Agent |

Effective permissions = union of all applicable bindings (global ∪ project ∪ agent ∪ session). No deny rules.

#### Credential Access — Global with RoleBinding Grants

Credentials are global resources. A credential is made accessible to a Project by creating a RoleBinding with `scope=credential`, `credential_id=<cred>`, `project_id=<project>`, `agent_id=NULL`, and `user_id=NULL`. At Session start, the resolver returns rows whose Project matches and whose `agent_id` is null or exactly matches `Session.agent_id`; a `credential:consumer` row always requires the exact non-null Agent match and named Provider request.

A single Credential can be shared across multiple Projects by creating one binding per project — no duplication of the Credential record.

See [Security Spec — Credential Access via RoleBindings](../security/identity-boundaries.spec.md#requirement-credential-access-via-rolebindings) for runtime authorization semantics.

### Built-in Roles

| Role | Description |
|---|---|
| `platform:admin` | Full access to everything |
| `platform:viewer` | Read-only across the platform |
| `project:owner` | Full control of a project and all its agents |
| `project:editor` | Create/update Agents, ignite, send messages |
| `project:viewer` | Read-only within a project |
| `agent:operator` | Ignite and message a specific Agent |
| `agent:editor` | Update prompt and metadata on a specific Agent |
| `agent:observer` | Read a specific Agent and its sessions |
| `agent:runner` | Minimum viable pod credential: read agent, push messages, send inbox |
| `credential:owner` | Full CRUD on credentials the user created. Bind credentials to projects the user has `project:owner` on. |
| `credential:viewer` | Read metadata (not token) on credentials bound to projects the user has access to. |
| `credential:token-reader` | Fetch the raw token via `GET /credentials/{cred_id}/token`. Granted only to runner service accounts at session start. Human users do not hold this role. |
| `credential:consumer` | Platform-internal use-only entitlement for exact Sessions of one bound Agent to consume one administrator-managed Credential through its named Provider. Grants no metadata list, raw-token read, mutation, rebinding, or delegation permission. |
| `gitops:admin` | Full CRUD on Applications; trigger sync/refresh. Platform-scoped — grantable only by `platform:admin`. |
| `gitops:viewer` | Read-only on Applications and their status. Platform-scoped — grantable only by `platform:admin`. |

### Permission Matrix

| Role | Projects | Agents | Sessions | Inbox | Credentials | Apps | Home | RBAC |
|---|---|---|---|---|---|---|---|---|
| `platform:admin` | full | full | full | full | full | full | full | full |
| `platform:viewer` | read/list | read/list | read/list | — | read/list | read/list | read | read/list |
| `project:owner` | full | full | full | full | manage bindings | local-only (own project) | read | project+agent bindings |
| `project:editor` | read | create/update/ignite | read/list | send/read | — | — | read | — |
| `project:viewer` | read | read/list | read/list | — | — | — | read | — |
| `gitops:admin` | — | — | — | — | — | full (any destination) | — | — |
| `gitops:viewer` | — | — | — | — | — | read/list | — | — |
| `agent:operator` | — | update/ignite | read/list | send/read | — | — | — | — |
| `agent:editor` | — | update | — | — | — | — | — | — |
| `agent:observer` | — | read | read/list | — | — | — | — | — |
| `agent:runner` | — | read | read | send | — | — | — | — |
| `credential:owner` | — | — | — | — | create/update/delete + bind | — | — | — |
| `credential:viewer` | — | — | — | — | read/list (metadata only) | — | — | — |
| `credential:consumer` | — | — | — | — | runtime use through bound Provider only | — | — | — |
| `credential:token-reader` | — | — | — | — | token: read | — | — | — |

### RBAC Endpoints

```
GET    /api/ambient/v1/roles                                              ✅ implemented
GET    /api/ambient/v1/roles/{id}                                         ✅ implemented
POST   /api/ambient/v1/roles                                              ✅ implemented
PATCH  /api/ambient/v1/roles/{id}                                         ✅ implemented
DELETE /api/ambient/v1/roles/{id}                                         ✅ implemented

GET    /api/ambient/v1/role_bindings                                      ✅ implemented
GET    /api/ambient/v1/role_bindings/{id}                                 ✅ implemented
POST   /api/ambient/v1/role_bindings                                      ✅ implemented
PATCH  /api/ambient/v1/role_bindings/{id}                                 ✅ implemented
DELETE /api/ambient/v1/role_bindings/{id}                                 ✅ implemented

GET    /api/ambient/v1/projects/{id}/agents/{agent_id}/role_bindings      ✅ implemented
GET    /api/ambient/v1/users/{id}/role_bindings                           🔲 planned
GET    /api/ambient/v1/projects/{id}/role_bindings                        🔲 planned
GET    /api/ambient/v1/sessions/{id}/role_bindings                        🔲 planned
GET    /api/ambient/v1/credentials/{cred_id}/role_bindings                🔲 planned
```

The `credential:token-reader` role is platform-internal. Credential CRUD is governed by
RoleBindings with `credential` scope. See
[Security Spec — Token Reader Role Grant](../security/identity-boundaries.spec.md#requirement-token-reader-role-grant) for
grant semantics and runtime authorization rules.

---

### ScheduledSessions (Project-Scoped)

```
GET    /api/ambient/v1/projects/{id}/scheduled-sessions                              list
POST   /api/ambient/v1/projects/{id}/scheduled-sessions                              create
GET    /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}                   read
PATCH  /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}                   update (schedule, session_prompt, enabled, timezone, description)
DELETE /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}                   delete

POST   /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}/suspend           disable — sets enabled=false
POST   /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}/resume            enable  — sets enabled=true
POST   /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}/trigger           immediate one-off ignite outside cron schedule
GET    /api/ambient/v1/projects/{id}/scheduled-sessions/{sched_id}/runs              list Sessions triggered by this schedule
```

---

### Generic Proxy

All backend paths not mapped to a native `/api/ambient/v1/...` endpoint are forwarded
verbatim to the backend service. See
[Security Spec — Proxy Authentication](../security/identity-boundaries.spec.md#requirement-proxy-authentication) for
authentication and credential injection behavior.

This allows SDK and CLI clients to reach the full backend surface through a single
authenticated endpoint without requiring every backend route to be natively implemented in
the API server. Routes listed here are candidates for future native spec entries.

#### Project Configuration (proxied)

```
GET    PUT          /api/projects/{p}/permissions
GET    POST DELETE  /api/projects/{p}/keys
GET    PUT          /api/projects/{p}/mcp-servers
GET    PUT          /api/projects/{p}/runner-secrets
GET    PUT          /api/projects/{p}/integration-secrets
GET                 /api/projects/{p}/secrets
GET    PUT POST DELETE  /api/projects/{p}/feature-flags[/{flagName}[/override|/enable|/disable]]
GET                 /api/projects/{p}/feature-flags/evaluate/{flagName}
GET                 /api/projects/{p}/runner-types
GET                 /api/projects/{p}/models
GET                 /api/projects/{p}/integration-status
GET                 /api/projects/{p}/access
```

#### Repository Operations (proxied)

```
GET                 /api/projects/{p}/repo/tree
GET                 /api/projects/{p}/repo/blob
GET                 /api/projects/{p}/repo/branches
GET                 /api/projects/{p}/repo/seed-status
POST                /api/projects/{p}/repo/seed
GET    POST         /api/projects/{p}/users/forks
```

#### Auth Integration Flows (proxied — admin)

```
*                   /api/auth/github/*
*                   /api/auth/google/*
*                   /api/auth/jira/*
*                   /api/auth/gitlab/*
*                   /api/auth/gerrit/*
*                   /api/auth/coderabbit/*
*                   /api/auth/mcp/*
GET    POST         /oauth2callback
GET                 /oauth2callback/status
```

#### Session Runtime — Runner-Internal (proxied)

These endpoints are called by runner pods at runtime. They are accessible via the API server for SDK/CLI tooling but are not intended for human interactive use.

```
POST                /api/projects/{p}/agentic-sessions/{s}/github/token
GET                 /api/projects/{p}/agentic-sessions/{s}/credentials/{provider}
POST                /api/projects/{p}/agentic-sessions/{s}/runner/feedback
```

#### Cluster / Platform (proxied)

```
GET                 /api/cluster-info
GET                 /api/version
GET                 /health
GET                 /api/runner-types
GET                 /api/workflows/ootb
GET                 /api/ldap/users[/{uid}]
GET                 /api/ldap/groups
```

---

## Labels and Annotations

Every first-class Kind carries two JSONB columns:

| Column | Purpose | Example values |
|---|---|---|
| `labels` | Queryable key/value tags. Use for filtering, grouping, and selection. | `{"env": "prod", "team": "platform", "tier": "critical"}` |
| `annotations` | Freeform key/value metadata. Use for tooling notes, human remarks, external references. | `{"last-reviewed": "2026-03-21", "jira": "PLAT-123", "owner-slack": "@mturansk"}` |

**Kinds with `labels` + `annotations`:** User, Project, Agent, Session, Credential (global), Application

**Kinds without:** Inbox (ephemeral message queue), SessionMessage (append-only event stream), Role, RoleBinding (RBAC internals — structured by design)

### Design: JSONB over EAV or separate tables

Instead of a separate `metadata` table (requires joins) or a polymorphic EAV table (breaks referential integrity), metadata is stored inline in the row it describes. This is the modern hybrid approach:

- **Zero joins**: Data is co-located with the resource.
- **Infinite flexibility**: Every row can carry different keys — no schema migration required to add a new label key.
- **GIN-indexed**: PostgreSQL JSONB supports `GIN` (Generalized Inverted Index), making containment queries (`@>`) nearly as fast as standard column lookups at scale.

```sql
CREATE INDEX idx_projects_labels     ON projects     USING GIN (labels);
CREATE INDEX idx_agents_labels       ON agents       USING GIN (labels);
CREATE INDEX idx_sessions_labels     ON sessions     USING GIN (labels);
CREATE INDEX idx_credentials_labels  ON credentials  USING GIN (labels);
```

### Query patterns

```sql
-- Find all sessions tagged env=prod
SELECT * FROM sessions WHERE labels @> '{"env": "prod"}';

-- Find all Agents owned by a team
SELECT * FROM agents WHERE labels @> '{"team": "platform"}';

-- Read a single annotation
SELECT annotations->>'jira' FROM projects WHERE id = 'my-project';
```

### Convention

- `labels` keys should be short, lowercase, hyphenated (e.g. `env`, `team`, `tier`, `managed-by`).
- `annotations` keys should use reverse-DNS namespacing for tooling (e.g. `ambient.io/last-sync`, `github.com/pr`).
- Neither column enforces a schema — validation is the caller's responsibility.
- Default value: `{}` (empty object). Never `null`.

---

## The Model as a String Tree

Every node in this model is an **ID and a string**. That is the complete primitive.

A `Project` is an ID and a `prompt` string — the workspace context.
An `Agent` is an ID and a `prompt` string — who the agent is.
A `Session` is an ID and a `prompt` string — what this run is focused on.
An `InboxMessage` is an ID and a `body` string — a request addressed to an agent.
A `SessionMessage` is an ID and a `payload` string — a human turn, trusted bootstrap input, or conversation result.

Strings can be simple (`"hello world"`) or arbitrarily complex (a bookmarked system prompt, a structured markdown context block, a multi-section briefing). The model does not care. Every node is still just an ID and a string.

This means the entire data model is a **composable JSON tree** — four nodes, each an ID and a string:

```json
{
  "project": {
    "id": "ambient-platform",
    "prompt": "This workspace builds the Ambient platform API server in Go. All agents operate on the same codebase. Prefer small, focused PRs. All code must pass gofmt, go vet, and golangci-lint before commit.",
    "labels": { "env": "prod", "team": "platform" },
    "annotations": { "github.com/repo": "ambient/platform" }
  },
  "agent": {
    "id": "01HXYZ...",
    "name": "be",
    "prompt": "You are a backend engineer specializing in Go REST APIs and Kubernetes operators. You write idiomatic Go, prefer explicit error handling over panic, and follow the plugin architecture in components/ambient-api-server/plugins/. You never use the service account client directly — always GetK8sClientsForRequest.",
    "labels": { "role": "backend", "lang": "go" },
    "annotations": { "ambient.io/specialty": "grpc,rest,k8s" }
  },
  "inbox": [
    {
      "id": "01HDEF...",
      "from": "overlord",
      "body": "While you're in the sessions plugin, also harden the subresource handler — agent_id is interpolated directly into a TSL search string."
    },
    {
      "id": "01HGHI...",
      "from": null,
      "body": "The presenter nil-pointer in projectAgents and inbox needs a guard before this goes to staging."
    }
  ],
  "session": {
    "id": "01HABC...",
    "prompt": "Implement WatchSessionMessages gRPC handler with SSE fan-out and replay. Replay all existing messages to new subscribers before switching to live delivery. Repo: github.com/ambient/platform, path: components/ambient-api-server/plugins/sessions/.",
    "labels": { "wave": "3", "feature": "session-messages" },
    "annotations": { "github.com/pr": "ambient/platform#142" }
  },
  "message": {
    "event_type": "user",
    "payload": "Begin. Start with the gRPC handler, then wire SSE, then write the integration test."
  }
}
```

### Composition

Because every node is a string, **entire agent suites and workspaces compose declaratively**.

The start context pipeline is string composition — each scope inherits and narrows the string above it:

```
Project.prompt        → workspace context (shared by all agents)
  Agent.prompt        → who this agent is
    Inbox messages    → what others have asked (queued intent)
      Session.prompt  → what this run is focused on
```

To compose a new workspace: write a `Project.prompt`. To define a new agent role: write an `Agent.prompt` and create the Agent in the project. To start: the system assembles the full context string automatically, in order, from the tree.

A different `Project.prompt` = a different team with different shared context.
An Agent with the same name in two projects = the same role operating in two different workspaces (separate records, independently mutable).
A poke (`InboxMessage.body`) sent from one Agent to another = a string crossing a node boundary.

This structure means you can define and compose bespoke agent suites — entire fleets with different roles, different workspace contexts, different session scopes — purely by composing strings at the right node in the tree. The platform assembles the start context; the model does the rest.

---

## Design Decisions

| Decision | Rationale |
|---|---|
| Agent is project-scoped, not global | Simplicity. An agent's identity and prompt are contextual to the project it serves. No indirection via a global registry. |
| Ordinary `Agent.prompt` is mutable | Prompt editing is routine for ordinary Agents. Enterprise Agent compatibility bytes are template-owned, protected, and never bootstrap authority. |
| Ownership via RBAC, not hardcoded FKs | Ownership of all Kinds is expressed through RoleBindings, not `owner_user_id` FKs. For Agents: `RoleBinding(scope=agent, agent_id=<id>, user_id=<owner>)`. For Sessions: `RoleBinding(scope=session, session_id=<id>, user_id=<assignee>)`. Enables multi-owner, delegated ownership, and transfer — consistently across all Kinds. Audit fields (who created/modified a resource) belong at the REST middleware layer, not on individual Kind schemas. |
| One active Agent-started root per Agent | Agent Start is idempotent and owns `current_session_id`; explicit orchestration children use immutable parent lineage and do not replace the current root |
| Inbox on Agent, not Session | Messages persist across re-ignitions; addressed to the agent, not the run |
| Inbox drained at start | Unread messages become part of the start context; session picks up where things left off |
| `current_session_id` denormalized on Agent | Project Home reads Agent + session phase without joining through sessions |
| Root Sessions use Agent Start; orchestration children use compatibility create/start | Sessions remain run artifacts. Authorized child creation requires exact Agent and immutable same-Project root parent lineage; it does not create a new entity or shared transcript. |
| Every ordinary layer carries a `prompt` | Ordinary Project, Agent, Session, and Inbox prompts compose downward. Enterprise system and user-instruction snapshot channels remain separate and privileged as specified. |
| `SessionMessage` is append-only | Canonical record of human turns, trusted bootstrap input, and LLM conversation; never edited or deleted |
| CLI mirrors API 1-for-1 | Every endpoint has a corresponding command; status tracked explicitly |
| This document is the spec | A reconciler will compare the spec (this doc) against code status and surface gaps |
| `labels` / `annotations` are JSONB, not strings | Enables GIN-indexed key/value queries (`@>` operator) without joins; every row carries its own metadata without a separate EAV table. `labels` = queryable tags; `annotations` = freeform notes. Applied to first-class Kinds: User, Project, Agent, Session. Not applied to Inbox, SessionMessage, Role/RoleBinding. |
| Credential is global, not project-scoped | Eliminates duplication when the same PAT is used across multiple Projects. Access controlled via RoleBindings with `credential` scope. A single Credential can be shared across Projects without creating copies. |
| Application syncs fleet definitions, not infrastructure | Application syncs Projects, Agents, Credentials, RoleBindings, and Inbox seeds. Sessions, Users, and Roles are not synced. |
| Application targets Ambient API, not K8s API | Unlike Sessions (which use kubeconfig for direct K8s provisioning), Application works at the Ambient REST API layer. Remote sync uses the SDK client pointed at `destination_ambient_url`. |
| Promotion via multiple Applications | Each environment gets its own Application pointing to a different git overlay and destination Ambient URL. Promotion = merge changes between overlay branches. |
| Kustomize engine shared between CLI and API server | The sync engine reuses the same kustomize rendering logic as `acpctl apply -k`. |
| Git polling, not webhooks (v1) | Simplicity. Webhook-triggered refresh is a v2 optimization. |
| Self-heal is opt-in | Default `false`. When enabled, the controller detects and reverts drift — useful for production fleets where UI-based changes should not persist. |
| Sync engine bound by credential escalation rules | The sync engine can only create RoleBindings where the role level is at or below the level of the service credential it authenticates with. This prevents a compromised git repo from escalating RBAC in the destination project. The credential's effective role level sets the ceiling. A sync that attempts to create a binding above the ceiling fails with a per-resource `Forbidden` status in `resource_status`. |
| Remote Ambient auth via stored Credential, not forwarded token | Async polling controllers (`auto_sync`) have no request context. The `credential_id` FK on Application provides the auth context. Token is resolved at sync time via `GET /credentials/{id}/token`, never cached beyond a single sync cycle. |
| Project prune requires manual confirmation | `auto_prune` deletes Agents and sub-resources automatically, but never auto-prunes a Project. Project removal is permanently destructive (cascades through Agents, Sessions, Inbox, SessionMessages). Pruning a Project requires explicit `POST /sync` with `prune: true, prune_project: true`. |
| `gitops:admin` is platform-scoped | Applications can target any Ambient instance, including production environments. Cross-environment reach exceeds project scope, so `gitops:admin` is grantable only by `platform:admin`. `project:owner` can create Applications where `destination_ambient_url` is null (local) and `destination_project` matches a project they own. This allows teams to self-serve GitOps for their own projects without platform-admin escalation. |
| `gitops:admin` / `gitops:viewer` follow platform escalation chain | Only `platform:admin` can grant `gitops:admin` or `gitops:viewer`. `project:owner` cannot grant these roles. This matches the escalation pattern established for `credential:owner` and other platform-scoped roles in the security spec. |
| Unsupported kinds silently skipped by sync engine | The kustomize engine supports all apply kinds (including Cluster, Ambient). The sync engine intentionally syncs only fleet definition kinds (Project, Agent, Credential, RoleBinding, Inbox). Documents of other kinds are silently skipped with a `Skipped` status in `resource_status`, not treated as errors. This allows shared kustomize overlays to contain infrastructure inventory alongside fleet definitions without breaking sync. |

Security and credential design decisions (RBAC scoping, write-only tokens, role catalog rationale) are in the [Security Spec — Design Decisions](../security/identity-boundaries.spec.md#design-decisions).

---

## Credential — Usage

```sh
## Create a GitLab PAT — token via env var (avoids shell history exposure)
acpctl credential create --name my-gitlab-pat --provider gitlab \
  --token "$GITLAB_PAT" --url https://gitlab.myco.com
## credential/my-gitlab-pat created

## Token via stdin (also avoids shell history)
echo "$GITLAB_PAT" | acpctl credential create --name my-gitlab-pat --provider gitlab \
  --token @- --url https://gitlab.myco.com

## Bind credential to a project (grants access to all agents in the project)
acpctl credential bind my-gitlab-pat --project my-project

## Bind the same credential to another project (no duplication)
acpctl credential bind my-gitlab-pat --project other-project

## List credentials (filtered by caller's RoleBindings)
acpctl credential list
## NAME              PROVIDER  URL                      CREATED
## my-gitlab-pat     gitlab    https://gitlab.myco.com  2026-03-31

## Rotate a token
acpctl credential update my-gitlab-pat --token "$GITLAB_PAT_NEW"

## Declarative apply — token sourced from env var
```

```yaml
kind: Credential
metadata:
  name: platform-gitlab-pat
spec:
  provider: gitlab
  token: $GITLAB_PAT
  url: https://gitlab.myco.com
  labels:
    team: platform
```

```sh
acpctl apply -f credential.yaml
## credential/platform-gitlab-pat created

## Then bind to the desired project
acpctl credential bind platform-gitlab-pat --project my-project
```

---

## Design Decisions — Credential

Credentials are global resources, not project-scoped. This eliminates duplication when the same
PAT is used across multiple Projects. Access is controlled via RoleBindings — bind a credential
to a project scope to grant access to all agents in that project.

See the [Security Spec — Design Decisions](../security/identity-boundaries.spec.md#design-decisions) for credential
design rationale (storage, rotation, provider serialization, migration).

---

## Implementation Coverage Matrix

_Last updated: 2026-07-14. Use this as the authoritative index — click into component source to verify._

| Area | API Server | Go SDK | CLI (`acpctl`) | Notes |
|---|---|---|---|---|
| **Sessions — CRUD** | ✅ | ✅ `SessionAPI.{Get,List,Create,Update,Delete}` | ✅ `get/create/delete session` | |
| **Sessions — start/stop** | ✅ `/start` `/stop` | ✅ `SessionAPI.{Start,Stop}` | ✅ `start`/`stop` commands | |
| **Messages API — list/push/watch** | ⚠️ core paths present; bootstrap trust/cardinality pending | ⚠️ bootstrap-aware push/watch pending | ⚠️ bootstrap rendering pending | Desired human conversation and trusted bootstrap context in `session_messages` |
| **Session messages (top-level compatibility)** | ✅ `GET /session_messages` | ⚠️ existing client path is not suitable for CP startup resolution | n/a | Retained for compatibility; not the bootstrap authority |
| **Session message metadata resolver** | 🔲 service-only metadata endpoint | 🔲 `ResolveSessionMessageMetadata` | n/a | Required for CP bootstrap selection and resume max-seq; query failure distinct from zero |
| **Events API — live SSE stream** | ✅ `/events` → runner pod SSE | ✅ `SessionAPI.StreamEvents` → `io.ReadCloser` | ✅ `session events` | Ephemeral; runner must be Running; 502 if unreachable |
| **Events API — persisted history** | ✅ `plugins/sessionEvents/` | ✅ `ListSessionEvents`, `PushSessionEvent` (gRPC) | ✅ `session events --history` | `session_events` table with compression schema |
| **Events API — compression** | ✅ schema supports `completed_at`, `event_count` | ✅ `completed_at`, `event_count` fields in `SessionEvent` | ✅ fields in SDK | Runner-side compression not yet active (all events stored uncompressed) |
| **Events API — 33 AG-UI event types** | ✅ runners emit AG-UI types | ✅ stored in `session_events.event_type` | ✅ query by event type | TEXT_MESSAGE_START, TOOL_CALL_ARGS, THINKING_*, REASONING_*, etc. |
| **Sessions — labels/annotations** | ✅ PATCH accepts `labels`/`annotations` | ✅ fields on `Session` type; `SessionAPI.Update(patch map[string]any)` | ⚠️ no dedicated subcommand; use `acpctl get session -o json` + manual PATCH | |
| **Sessions — immutable runtime selector** | 🔲 no `runner_type` field or immutability gate | 🔲 | 🔲 | Must snapshot Agent runtime before reconciliation and drive CP `RUNNER_TYPE`/image capability selection |
| **Sessions — workspace files** | ✅ sessions plugin; stubs empty list when no runner; 503 per-file-op | 🔲 | 🔲 `session workspace list/get/put/delete` | Requires running session for file ops |
| **Sessions — pre-upload files** | ✅ sessions plugin; stubs empty list when no runner; 503 per-file-op | 🔲 | 🔲 `session files list/upload/delete` | S3-staged; available before session starts |
| **Sessions — git** | ✅ sessions plugin; stubs empty status/branches; configure-remote 503 if no runner | 🔲 | 🔲 `session git status/configure-remote/branches` | |
| **Sessions — repos** | ✅ sessions plugin; repos/status stub; add/remove stored natively in session DB | 🔲 | 🔲 `session repos list/add/remove` | |
| **Sessions — operational** | ✅ sessions plugin; clone/displayname/model/workflow/export/pod-events native; oauth 501 | 🔲 | 🔲 `session clone/model/export/pod-events` | |
| **Sessions — runner protocol** | ✅ sessions plugin; agui/{run,events,interrupt,feedback,tasks,capabilities}, mcp/status | 🔲 | 🔲 `session interrupt/feedback/capabilities/tasks` | AGUI prefix routes; 502 if runner unreachable |
| **Agents — CRUD** | ✅ `/projects/{id}/agents` | ✅ `ProjectAgentAPI.{ListByProject,GetByProject,GetInProject,CreateInProject,UpdateInProject,DeleteInProject}` | ✅ `agent list/get/create/update/delete` | |
| **Agents — start/start-preview** | ✅ `/start` | ✅ `ProjectAgentAPI.{Start,GetStartPreview}` | ✅ `start <id>`, `agent start-preview` | Idempotent — returns existing session if active |
| **Agents — runtime selector** | 🔲 no `runner_type` persistence/propagation | 🔲 | 🔲 apply/start support | Default existing Agents to `claude-agent-sdk`; Amber explicitly selects `gemini-cli` |
| **Agents — sessions history** | ✅ `/sessions` sub-resource | ✅ `ProjectAgentAPI.Sessions` | ✅ `agent sessions` | Returns `SessionList` scoped to agent |
| **Agents — labels/annotations** | ✅ PATCH accepts `labels`/`annotations` | ✅ fields on `ProjectAgent` type; `UpdateInProject(patch map[string]any)` | ⚠️ via `agent update` with raw patch; no typed helpers | |
| **Inbox — list/send** | ✅ GET/POST `/inbox` | ✅ `InboxMessageAPI.{ListByAgent,Send}` + `ProjectAgentAPI.{ListInboxInProject,SendInboxInProject}` | ✅ `inbox list`, `inbox send` | |
| **Inbox — mark-read/delete** | ✅ PATCH/DELETE `/inbox/{id}` | ✅ `InboxMessageAPI.{MarkRead,DeleteMessage}` | ✅ `inbox mark-read`, `inbox delete` | |
| **Projects — CRUD** | ✅ | ✅ `ProjectAPI.{Get,List,Create,Update,Delete}` | ✅ `get/create/delete project`, `project set/current`, `project update` | |
| **Projects — labels/annotations** | ✅ PATCH accepts `labels`/`annotations` | ✅ fields on `Project` type; `ProjectAPI.Update(patch map[string]any)` | ⚠️ no dedicated subcommand | |
| **Users — authenticated self** | 🔲 generic `GET /users/me` | 🔲 authenticated-self helper | ⚠️ `whoami` parses token claims rather than reading canonical `User.id` | Required for opaque per-user vTeam binding |
| **Enterprise Assistant — authenticated-self discovery** | 🔲 `GET /users/me/enterprise-agent` exact composite + strong ETag | 🔲 typed self-scoped GET exposing response body and ETag | n/a | Authoritative cross-profile discovery; no Project header or generic list scan |
| **Enterprise Assistant — preview** | 🔲 self-scoped non-mutating endpoint | 🔲 exact typed request/response | n/a | Exact schema and RFC 8785 digests are defined in `enterprise-assistant/lifecycle.spec.md` |
| **Enterprise Assistant — conditional provision** | 🔲 atomic conditional PUT | 🔲 exact typed request/response | n/a | Deterministic Project, sole owner, managed provider, reserved Agent, ETag, retry, and rollback remain missing |
| **Enterprise Assistant — Agent Start** | 🔲 complete effective-state revalidation + immutable launch snapshot | 🔲 typed stable Start errors | n/a | Provider entitlement, memory readiness, desired generation, and exact-Session authority remain missing |
| **RBAC — roles** | ✅ full CRUD | ✅ `RoleAPI` | ✅ `create role`, `get roles`, `get roles <id>`, `delete role` | |
| **RBAC — role bindings** | ✅ full CRUD | ✅ `RoleBindingAPI` | ✅ `create role-binding`, `get role-bindings`, `get role-bindings <id>`, `delete role-binding` | |
| **RBAC — canonical User subjects** | 🔲 evaluator and writes still use authenticated username | schema exposes `user_id` | CLI accepts caller-supplied subject | Migrate legacy username-valued rows idempotently to opaque `User.id`; fail closed on missing/ambiguous mapping |
| **RBAC — scoped role_bindings queries** | ✅ users/projects/agents/sessions/credentials | n/a | n/a | All five scoped read endpoints are registered; canonical opaque User-ID migration remains separate |
| **Credentials — CRUD** | ✅ `plugins/credentials/` (global at `/credentials`) | ✅ `credential_api.go` + `credential_extensions.go` | ✅ `credential list/get/create/update/delete/token/bind` | |
| **Credentials — token fetch** | ✅ `GET /credentials/{cred_id}/token` | ✅ `GetToken()` in `credential_extensions.go` | ✅ `credential token <id>` | Gated by `credential:token-reader`; granted to runner SA by operator |
| **ScheduledSessions — CRUD** | ✅ scheduledSessions plugin | ✅ `ScheduledSessionAPI.{List,Get,Create,Update,Delete,GetByName}` | ✅ `scheduled-session list/get/create/update/delete` | |
| **ScheduledSessions — lifecycle** | ✅ suspend/resume/trigger/runs handlers | ✅ `ScheduledSessionAPI.{Suspend,Resume,Trigger,Runs}` | ✅ `scheduled-session suspend/resume/trigger/runs` | |
| **Generic proxy — project config** | ✅ proxy plugin (`plugins/proxy`); forwards non-`/api/ambient/` paths to `BACKEND_URL` | n/a | 🔲 raw HTTP fallback | Permissions, keys, MCP servers, secrets, feature flags |
| **Generic proxy — repo operations** | ✅ proxy plugin | n/a | 🔲 raw HTTP fallback | Tree, blob, branches, seed, forks |
| **Generic proxy — auth integrations** | ✅ proxy plugin | n/a | n/a | GitHub/GitLab/Google/Jira/Gerrit/CodeRabbit/MCP OAuth flows |
| **Generic proxy — cluster/platform** | ✅ proxy plugin | n/a | 🔲 `acpctl version`, `acpctl cluster-info` | cluster-info, version, health, LDAP, OOTB workflows |
| **Declarative apply** | n/a | uses SDK | ✅ `apply -f`, `apply -k` | Upsert semantics; supports inbox seeding |
| **Declarative apply — Credential kind** | n/a | uses SDK | ✅ `apply -f credential.yaml` | Global resource; token sourced from env var in YAML |
| **Declarative apply — Policy kind** | ✅ `plugins/policies/` | ✅ `Policys()` (SDK) | 🔲 `apply -f policy.yaml` | Project-scoped; spec contains OpenShell SandboxPolicy JSON |
| **Declarative apply — Agent sandbox fields** | ✅ PATCH accepts all fields | ✅ `AgentBuilder.SandboxPolicy()`, `.SandboxTemplate()` | 🔲 `acpctl apply` resource struct missing `sandbox_policy`, `sandbox_template`, `entrypoint` | Fields silently dropped during YAML parsing; only `prompt`, `providers`, `payloads`, `environment`, `labels`, `annotations` applied |
| **Declarative apply — ScheduledSession kind** | n/a | 🔲 | 🔲 | Planned; schedule and agent reference in YAML |
| **Applications — CRUD** | ✅ `plugins/applications/` | ✅ `ApplicationAPI.{Get,List,Create,Update,Delete}` | ✅ `application list/get/create/update/delete` | GitOps sync binding |
| **Applications — sync/refresh** | ✅ `sync`/`refresh` handlers | ✅ `ApplicationAPI.{Sync,Refresh}` | ⚠️ `application sync/refresh` (stub implementations) | Sync engine partial — only Agent kind synced |
| **Applications — status** | ⚠️ status on main GET only | ✅ status fields in `Application` type | ✅ `application get` shows status | Dedicated `/status` endpoint not yet implemented |

### Labels/Annotations — SDK Ergonomics Gap

All Kinds with `labels`/`annotations` store them as JSON strings in the DB (`*string` in the Go model) but as structured maps in the OpenAPI schema. The Go SDK type carries `Labels *string` / `Annotations *string` (matching the DB column). Consumers doing label/annotation operations must marshal/unmarshal the JSON string themselves — there are no typed `PatchLabels`/`PatchAnnotations` helper methods in the SDK.

**Workaround:** Use `Update(ctx, id, map[string]any{"labels": labelsMap, "annotations": annotationsMap})`. The API server accepts the map directly and stores it as JSON.

**Permanent fix:** Add `PatchLabels` / `PatchAnnotations` typed helpers to `SessionAPI`, `ProjectAgentAPI`, and `ProjectAPI` in the SDK — these should accept `map[string]string` and call `Update` internally.

### CLI — Known Gaps vs Spec

| Command | Status | Path to close |
|---|---|---|
| Project/Agent/Session label subcommands | 🔲 no `acpctl label`/`acpctl annotate` | add typed label helpers to SDK first, then CLI |
| `acpctl credential bind` | ✅ implemented | `POST /role_bindings` with `scope=credential`; global migration complete |
| Session workspace/files/git/repos subcommands | 🔲 planned | see Session Operations table above |


 Manual Test

  # 1. Project
  acpctl create project --name test-cred-1 --description "cred test"
  acpctl project test-cred-1

  # 2. Agent
  acpctl agent create --project test-cred-1 --name github-agent \
    --prompt "You are a GitHub automation agent."

  AGENT_ID=$(acpctl agent list --project test-cred-1 -o json | python3 -c "import sys,json; print(json.load(sys.stdin)['items'][0]['id'])")
  echo "AGENT_ID=$AGENT_ID"

  # 3. Credential (global resource)
  printf 'kind: Credential\nname: github-pat-test\nprovider: github\ntoken: %s\ndescription: test\n' \
    "$(cat ~/projects/secrets/github.ambient-pat.token)" > /tmp/cred.yaml
  acpctl apply -f /tmp/cred.yaml && rm /tmp/cred.yaml

  # 4. Bind credential to project
  acpctl credential bind github-pat-test --project test-cred-1

  CRED_ID=$(acpctl credential list -o json | python3 -c "import sys,json; print(next(i['id'] for i in json.load(sys.stdin)['items'] if i['name']=='github-pat-test'))")
  echo "CRED_ID=$CRED_ID"

  # 5. Start session
  SESSION_ID=$(acpctl start github-agent --project test-cred-1 \
    --prompt "Fetch credential $CRED_ID token and confirm you received it." \
    -o json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "SESSION_ID=$SESSION_ID"

  # 6. Watch events
  acpctl session events "$SESSION_ID"

---
