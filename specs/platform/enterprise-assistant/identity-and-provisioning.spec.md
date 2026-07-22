# Enterprise Assistant Identity and Provisioning Specification

## Purpose

This specification defines the identity, dedicated Project, and reserved
provenance contracts for provisioning one user-owned Enterprise Agent for the
Enterprise Assistant capability. An Enterprise Agent is an ordinary persistent
ACP Agent whose server-reserved provenance identifies it as created and managed
through this workflow; neither Enterprise Agent nor Enterprise Assistant
introduces a new ACP entity or Session type.

## Requirements

### Requirement: Canonical Human Self-Service Identity

The platform SHALL allow every authenticated human principal that maps uniquely
to one active ACP `User` to preview and provision that User's Enterprise Agent.
Human OIDC and human bearer-token authentication are eligible without a separate
Enterprise Agent capability; service accounts, platform services, Session
runtimes, delegated subjects, missing mappings, and ambiguous mappings SHALL be
rejected.

#### Scenario: Human authentication resolves one immutable identity

- GIVEN a human OIDC or human bearer credential maps uniquely to one active User
- WHEN the caller uses an Enterprise Agent self-service route
- THEN the server derives the canonical opaque `User.id` from one immutable OIDC
  issuer-plus-subject mapping whose validated issuer and opaque `sub` are stored
  and compared byte-for-byte without case-folding, URL decoding, or Unicode
  normalization
- AND that exact composite is unique across active and soft-deleted User rows,
  with a tombstoned match permanently reserved and ineligible for self-service
- AND `normalized` identity data means a validated canonical record, never
  transformed issuer or `sub` string bytes
- AND token rotation, username, email, and display-name changes do not change
  that identity
- AND the caller is eligible without an administrator grant or separate
  generation capability

#### Scenario: Non-human or ambiguous identity fails closed

- GIVEN the caller is a service identity, delegated subject, Session runtime, or
  does not map uniquely to one active human User
- WHEN the caller requests preview or provisioning
- THEN the server returns HTTP 403 without reading another User's state or
  making a write
- AND deployments SHALL issue Session runtimes a cryptographically distinct
  `actor_class=session-runtime` credential and SHALL never expose an eligible
  human bearer credential to a runtime
- AND a deployment that cannot prove the actor class SHALL reject self-service

#### Scenario: Legacy RoleBinding subjects migrate without widening access

- GIVEN legacy RoleBindings contain usernames while canonical bindings use
  opaque `User.id` values
- WHEN identity migration runs
- THEN each legacy row is rewritten only when its exact case-sensitive legacy
  username matches one unique verified `legacy_username` alias on an active
  issuer-plus-subject-bound User under the canonical User migration contract
- AND email and display claims are not aliases
- AND a legacy alias is globally unique across active and soft-deleted Users,
  remains reserved by a tombstone, and is never reassigned after deletion
- AND any historical alias reuse or inability to prove that the legacy subject
  and the current issuer-plus-subject identify the same person fails closed
- AND an equivalent canonical row with the same `role_id`, `scope`,
  `project_id`, `agent_id`, `session_id`, and `credential_id` is merged
  idempotently rather than duplicated
- AND one transaction creates or confirms the canonical row before disabling
  the legacy row
- AND roles and resource scopes are preserved
- AND missing, conflicting, or multiply matched rows remain unauthorized and
  produce an auditable administrative error

### Requirement: Deterministic Dedicated Project

The platform SHALL derive exactly one dedicated Project name per canonical User
and template family using this algorithm without padding:

```text
ea-<lowercase RFC 4648 Base32(SHA-256(UTF-8(User.id) + 0x00 + UTF-8(template_key)))>
```

`User.id` and `template_key` SHALL be used exactly as stored and SHALL contain
no NUL. For template key
`ambient-code/enterprise-agent/artoo`, the result is 55 DNS-1123 characters and
SHALL depend on no username, email, token, external subject, browser-selected
Project, or mutable template revision.

#### Scenario: Provisioning creates the stable Project

- GIVEN the caller has no Enterprise Agent Project
- WHEN the caller provisions the `ambient-code/enterprise-agent/artoo` template
- THEN the server creates the deterministic Project on the caller's behalf
- AND creates exactly one active `project:owner` RoleBinding from that Project
  to the caller's opaque `User.id`
- AND creates no Project-, Agent-, or Session-scoped human grant for another User
- AND an existing exact, canonically owned, template-provenanced Project is
  reconciled rather than duplicated

#### Scenario: Collision or tombstone is not adopted

- GIVEN the deterministic name is occupied by foreign, ambiguous,
  unprovenanced, or tombstoned state
- WHEN preview or provisioning evaluates it
- THEN the operation returns HTTP 409 without mutation
- AND generic create, patch, declarative apply, and Application sync reject only
  the exact reserved generated-name pattern

### Requirement: Reserved Enterprise Agent Provenance

The server SHALL reserve Agent name `enterprise-agent` and Platform Provider
name `enterprise-agent-default` within the dedicated Project. The server SHALL
be the only writer of these exact JSON annotation keys:

<!-- markdownlint-disable MD013 -->

| Resource | Annotation | Value |
|---|---|---|
| Agent | `ambient-code.io/enterprise-agent/managed` | `"true"` |
| Agent | `ambient-code.io/enterprise-agent/template-key` | `"ambient-code/enterprise-agent/artoo"` |
| Agent | `ambient-code.io/enterprise-agent/template-digest` | `"sha256:<64 lowercase hex>"` |
| Agent | `ambient-code.io/enterprise-agent/customization-digest` | `"sha256:<64 lowercase hex>"` |
| Agent | `ambient-code.io/enterprise-agent/setup-mode` | `"starter"` or `"customized"` |
| Project | `ambient-code.io/enterprise-agent/managed` | `"true"` |
| Project | `ambient-code.io/enterprise-agent/template-key` | `"ambient-code/enterprise-agent/artoo"` |
| Project | `ambient-code.io/enterprise-agent/template-digest` | `"sha256:<64 lowercase hex>"` |
| Platform Provider | `ambient-code.io/enterprise-agent/managed` | `"true"` |

<!-- markdownlint-enable MD013 -->

#### Scenario: Discovery uses server state rather than presentation

- GIVEN a client discovers a generated Enterprise Agent
- WHEN it validates the dedicated Project
- THEN it requires exactly one canonically owned Project and exactly one Agent
  carrying the complete matching annotation set
- AND it does not infer the role from Agent name, display name, prompt text,
  list position, or local storage
- AND ownership comes only from RoleBinding evaluation, never an annotation

#### Scenario: Setup mode records server-authoritative provenance

- GIVEN the Enterprise Agent is provisioned from the Artoo starter template
- WHEN provisioning succeeds before onboarding customization
- THEN the Agent's `ambient-code.io/enterprise-agent/setup-mode` annotation
  equals `"starter"`
- AND only successful Enterprise Assistant customization changes that value to
  `"customized"`
- AND clients SHALL treat the annotation as server-authoritative provenance
  rather than infer setup mode from presentation or local state

### Requirement: Private Managed Resource Boundary

The complete Enterprise Assistant resource set SHALL be server-managed. The
`ambient-code.io/enterprise-agent/managed="true"` annotation is the common
managed-resource marker for this set, while the remaining Enterprise Assistant
annotations establish provenance. Generic create SHALL reject the deterministic
Project name and the reserved Agent and Platform Provider names. Generic patch,
delete, declarative apply, Application sync, RoleBinding mutation, and bulk
operations SHALL reject
any attempt to change or remove a completely or partially marked Enterprise
Assistant Project, Agent, Platform Provider, owner binding, or managed-Credential
binding. Validation SHALL inspect persisted state as well as the request so that
omitting protected annotations from a patch cannot bypass the guard.

Only the conditional Enterprise Assistant self-service operation or the exact
[Audited Administrative Break-Glass](#requirement-audited-administrative-break-glass)
operation MAY change the managed set.
The self-service operation MAY change only the fields allowed by the template,
customization, memory, and lifecycle contracts. Repair and revocation SHALL use
only the authentication, action allowlist, target schema, idempotency, and audit
rules below. They SHALL NOT expose raw managed-Credential material, managed
memory content, or reusable runtime authority, and SHALL NOT start an Agent.

#### Scenario: Generic mutation cannot forge or alter managed state

- GIVEN a caller uses generic Project, Agent, Provider, RoleBinding, Credential,
  delete, apply, sync, or bulk operations
- WHEN it attempts to create a reserved name or to alter, delete, delegate, or
  remove any part of a marked Enterprise Assistant resource set
- THEN the server rejects the mutation before writing
- AND project ownership, a global role, or omission of reserved annotations from
  the request does not bypass the managed-resource guard
- AND no partial write, cascade delete, tombstone, orphaned attachment, or
  managed-provider authority is created

#### Scenario: Generic Project delegation is rejected

- GIVEN the canonical owner holds `project:owner` on the dedicated Project
- WHEN any generic operation attempts to grant another human User a Project-,
  Agent-, or Session-scoped role covering the Enterprise Agent or one of its
  Sessions
- THEN the operation returns HTTP 403 without creating or changing a binding
- AND a platform service receives only the exact internal authority required by
  provisioning, reconciliation, or one Enterprise Agent Session

### Requirement: Owner-Only Enterprise Agent Operations

For every human read, start, message, stop, restart, Session read, and Session
mutation involving the Enterprise Agent or one of its Sessions, the server SHALL
require the caller's canonical opaque `User.id` to equal the one active
`project:owner` subject on the complete dedicated Project. Ordinary RBAC remains
necessary but is not sufficient, and a delegated Project, Agent, Session, global,
or externally impersonated identity SHALL NOT substitute for owner equality.
Session runtimes MAY act only with a cryptographically distinct exact-Session
service identity after a successful owner-authorized start.

Before Agent Start creates a Session or workload, the server SHALL rederive and
validate the complete effective managed state: Project and Agent ownership,
managed annotations, immutable template content, normalized customization,
runtime, provider list, Platform Provider shape, managed-Credential entitlement,
memory state, and the absence of unapproved payload, environment, entrypoint,
sandbox, policy, provider, or directive overrides. Drift SHALL fail closed before
Session creation; start SHALL NOT silently trust annotations or repair state.

Start SHALL also complete a synchronous, credential-free readiness preflight for
the configured OpenShell gateway, private inference proxy, and, when memory is
enabled, private managed-memory proxy. Preflight proves compatible gateway
version and features, authenticated control-plane management reachability,
required network-policy and exact-Session provider support, and proxy health. It
creates no exact-Session provider, capability, lease, sandbox, or workload.

After preflight succeeds, the API transaction SHALL create the Session and its
immutable launch snapshot. The control plane then owns idempotent creation of the
exact-Session inference provider and managed-memory proxy from that snapshot. A
post-commit provider or proxy failure SHALL terminalize the existing Session with
a bounded error and clean every partial provider, capability, lease, sandbox, and
workload artifact. It SHALL NOT be reported as a pre-commit Start failure or as
proof that no Session row exists.

#### Scenario: Delegated user cannot run or inspect the Enterprise Agent

- GIVEN another User has an ordinary role that would normally cover the Project,
  Agent, or Session
- WHEN that User attempts an Enterprise Agent operation
- THEN the server denies the operation without returning the Agent, Session,
  owner, provider, memory, or credential state
- AND no Session, workload, provider instance, token-reader grant, or memory
  capability is created

#### Scenario: Start rejects effective-state drift

- GIVEN a managed resource field, rendered instruction, runtime selector,
  provider, binding, attachment, or digest differs from the complete reviewed
  Enterprise Assistant state
- WHEN the canonical owner attempts Agent Start
- THEN start fails with an actionable credential-safe integrity error before
  creating a Session or workload
- AND the owner must use conditional provisioning or an administrator must use
  the audited repair operation to reconcile the drift

#### Scenario: Post-commit provider failure terminalizes the Session

- GIVEN readiness preflight succeeded and Agent Start committed one Session and
  immutable launch snapshot
- WHEN control-plane reconciliation cannot create or verify the exact-Session
  private provider or proxy
- THEN that same Session becomes terminal `Failed` with a bounded credential-safe
  condition
- AND cleanup revokes or deletes every partial exact-Session authority and
  workload artifact
- AND retry or reconciliation never creates a second Session or reinterprets the
  snapshot from current Agent state

### Requirement: Audited Administrative Break-Glass

Generic `platform:admin` authority SHALL NOT bypass owner-only Enterprise Agent
operations or expose managed memory or Credential material. The only break-glass
write surface SHALL be
`POST /api/ambient/internal/v1/enterprise-assistant/repair-operations`. It SHALL
not be registered in public OpenAPI, SDK, CLI, browser, MCP, generic proxy, or
declarative apply surfaces.

The endpoint SHALL accept only a fresh step-up human administrator JWT with all
of these exact properties: fixed type `ea-repair+jwt`; the configured
break-glass issuer; audience `ambient-enterprise-assistant-repair`;
`actor_class=human-break-glass`; scope `enterprise-assistant.repair`; subject
equal to the operator's canonical opaque `User.id`; unique `jti`; `amr` including
MFA; and a lifetime no greater than five minutes. A normal human access token,
`platform:admin` role alone, API key, platform-service identity, Session runtime,
delegated token, or impersonated subject SHALL fail authentication for this
endpoint. HTTP and gRPC service credentials have no equivalent bypass.

Every request SHALL carry an `Idempotency-Key` of 16 to 128 characters from
`[A-Za-z0-9._~-]` and this closed JSON object:

```json
{
  "schema_version": "1",
  "action": "<allowlisted-action>",
  "target": {},
  "expected_state_digest": "sha256:<64 lowercase hex>",
  "reason": "<1..512 UTF-8 bytes>",
  "ticket": "<1..128 UTF-8 bytes>"
}
```

Unknown or duplicate fields SHALL be rejected. `target` SHALL contain exactly
the action-specific fields in this table; every listed field is required and
SHALL match live state under one transaction lock. Only fields explicitly marked
nullable may be null, and null means the inspect action proved that resource is
absent.

<!-- markdownlint-disable MD013 -->

| Action | Exact `target` fields | Permitted effect |
|---|---|---|
| `managed-state.inspect` | `user_id` | Derive the deterministic managed boundary and return only bounded repair selectors, versions, generations, and canonical state digest for a later compare-and-swap action. |
| `credential-designation.inspect` | `logical_name` | Return only presence, generation, eligibility state, and canonical state digest; never Credential ID or material. |
| `managed-set.repair` | `user_id`, nullable `project_id`, nullable `agent_id`, nullable `provider_id` | Restore only reviewed provenance, sole ownership, internal consumer binding, and typed configuration; a null selector permits creation only when inspect proved absence. |
| `managed-set.revoke` | `user_id`, nullable `project_id`, nullable `agent_id`, nullable `provider_id` | Disable the inspected managed set and terminalize and clean only its active exact-Session authority. |
| `credential-designation.initialize` | `logical_name`, `replacement_credential_id` | Create the absent singleton at generation one with one eligible `vertex` Credential. |
| `credential-designation.rotate` | `designation_generation`, `replacement_credential_id` | Atomically select one eligible `vertex` Credential and increment the designation generation. |
| `credential-designation.revoke` | `designation_generation` | Atomically clear the designation and increment its generation. |
| `credential-designation.restore` | `designation_generation`, `replacement_credential_id` | Restore one eligible `vertex` Credential and increment the generation. |
| `memory-attachment.quarantine` | `attachment_id`, `attachment_version`, `desired_generation` | Block new leases and begin exact attachment drain. |
| `memory-attachment.repair` | `attachment_id`, `attachment_version`, `desired_generation` | Repair only validated metadata for the same attachment identity and generation. |
| `memory-lease.revoke` | `session_id`, `capability_generation` | Revoke only the named exact-Session capability generation and its live lease authority. |

<!-- markdownlint-enable MD013 -->

No action may accept a generic patch, replacement owner, destination, provider
type, endpoint, credential material, memory content, query, selector, script, or
arbitrary JSON merge. `managed-set.repair` SHALL preserve the canonical User,
and every non-null Project, Agent, and Provider ID. A null inspected selector may
create only the missing reserved resource with a server-generated ID; ownership
transfer or replacement of an existing ID is not a repair.

An inspect action SHALL require
`expected_state_digest="sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`,
the SHA-256 of zero bytes, and SHALL return the current digest needed by a later
write. This makes corrupt, partial, absent, and tombstoned state repairable
without guessing or exposing secrets.

The server SHALL hash the canonical request and bind that hash to the
Idempotency-Key, operator, and a durable pending repair-operation record before
mutation. Repeating the same key with identical bytes SHALL return the stored
bounded result without
another mutation; reusing it with different bytes SHALL return HTTP 409. The
transaction SHALL compare `expected_state_digest` and every target version or
generation, apply at most one allowlisted action, and append before and after
digests plus outcome to the immutable audit event. Indeterminate external cleanup
SHALL resume from the stored operation ID and SHALL not repeat a committed DB
mutation.

The response SHALL contain only `operation_id`, `action`, `status`, redacted
target IDs, inspect-only `repair_selectors`, `audit_event_id`, and
`resulting_state_digest`. `repair_selectors` SHALL be absent for write actions and
contain only the versions and generations required by the action table. The
response SHALL expose no raw
credential, memory content, human or Session bearer, provider placeholder,
endpoint, upstream error, or reusable capability. This requirement is the single
normative break-glass authority for Enterprise Assistant identity, managed
Credential/provider, and managed-memory repair and revocation.

#### Scenario: Administrator repair remains non-delegating

- GIVEN a platform administrator invokes the exact repair-operations endpoint
  with a valid step-up JWT, idempotency key, closed request, and matching digest
- WHEN the operation repairs or revokes managed state
- THEN it grants no standing role to the administrator or another User
- AND it returns no raw credential, memory content, human bearer, Session bearer,
  provider placeholder, or reusable capability
- AND ordinary Enterprise Agent use remains restricted to the canonical owner
