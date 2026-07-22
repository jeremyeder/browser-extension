# Enterprise Assistant Agentic Memory Specification

## Purpose

This specification defines the vendor-neutral platform contract for managed
agentic memory on a user-owned Enterprise Agent. It separates requested memory
configuration from attachment readiness, keeps the Artoo starter usable without
managed memory, binds every runtime capability to one exact Session, and keeps
configuration changes from retrofitting existing Sessions.

## Requirements

### Requirement: Typed Server-Owned Desired State

The platform SHALL persist exactly one server-owned `EnterpriseAssistantConfig`
for each generated Enterprise Agent. The record SHALL contain the exact owning
`user_id`, `project_id`, and `agent_id`; `setup_mode`; independent Boolean
`personal_enabled` and `coding_enabled` choices; and a monotonically increasing
positive `desired_generation`. The same record SHALL persist the
schema-validated normalized customization defined by the template contract; it
MUST NOT reconstruct customization from rendered prompt text or annotations.
The three resource IDs MUST reference the same canonical ownership boundary and
MUST NOT be supplied or changed by a browser, prompt, Agent payload, MCP tool, or
model process.

The public requested configuration SHALL be represented as:

```json
{
  "personal_enabled": false,
  "coding_enabled": false
}
```

The separately derived public `memory_readiness` SHALL be one of
`not-configured`, `provisioning`, `ready`, or `failed`. Readiness SHALL be
derived from persisted desired state plus the exact matching managed attachment;
it SHALL NOT be accepted from a client or stored in browser state.

#### Scenario: Starter desired state is memoryless

- GIVEN the Artoo starter is provisioned
- WHEN the server persists its Enterprise Assistant configuration
- THEN setup mode is `starter`
- AND both requested facets are false
- AND no managed attachment, Session lease, memory capability, memory MCP
  server, or memory provider route exists
- AND public readiness is `not-configured`

#### Scenario: Browser preferences cannot enable memory

- GIVEN a browser records one or both memory facets as enabled
- WHEN the corresponding server-owned configuration has both facets disabled
- THEN Agent Start treats managed memory as not configured
- AND no attachment is discovered, created, authorized, or injected from the
  browser value

### Requirement: Exact Managed Attachment Record

When either requested facet is enabled, the platform SHALL persist exactly one
active `ManagedMemoryAttachment` for the exact configuration. The internal
record SHALL contain an opaque attachment ID, the matching `user_id`,
`project_id`, and `agent_id`, the desired generation it is reconciling, a
monotonically increasing attachment version, internal lifecycle state,
provider-owned opaque reference, bounded failure information, and timestamps.
The provider-owned reference SHALL be encrypted at rest or otherwise protected
as a secret reference and SHALL never appear in a public API, prompt, log, MCP
tool schema, model-visible file, environment variable, or CLI argument.

Internal attachment lifecycle state SHALL be one of `provisioning`, `ready`,
`failed`, `draining`, `deleting`, or `retired`. Only `provisioning`, `ready`, and
`failed` are public while either requested facet is enabled. A disabled
configuration is immediately public as `not-configured`; any former attachment
continues only as internal draining or deletion state.

There SHALL be at most one non-retired attachment per Agent. Its owner, Project,
and Agent IDs MUST equal the associated configuration and MUST be protected by
foreign keys and database constraints, not naming conventions or provider
metadata.

#### Scenario: Provision one isolated attachment

- GIVEN a customized Enterprise Agent requests either memory facet
- WHEN the desired-state transaction commits
- THEN exactly one matching attachment record exists in `provisioning`
- AND another User, Project, or Agent cannot discover, read, write, attach,
  delegate, rename, or reuse it
- AND repeated reconciliation converges on the same attachment ID and desired
  generation

#### Scenario: Inconsistent attachment state fails closed

- GIVEN an attachment is missing, duplicated, retired, mismatched, or has an
  invalid owner, Project, Agent, generation, version, or lifecycle state
- WHEN the Enterprise Agent is read, reconciled, or started
- THEN public readiness is never `ready`
- AND the platform reports a bounded state-integrity failure
- AND Agent Start creates no Session, workload, lease, capability, or model call

### Requirement: Transactional Intent and Idempotent Reconciliation

The API transaction that changes requested memory SHALL atomically persist the
Enterprise Assistant configuration, create or update the ACP-owned attachment
intent, increment `desired_generation`, and enqueue one durable outbox operation
identified by attachment ID plus desired generation. It SHALL NOT claim atomic
commit with an external memory provider.

An existing control-plane reconciliation worker SHALL consume the outbox after
database commit. It SHALL use the outbox idempotency key for provider operations,
update the same attachment record, ignore superseded generations, and record
success or bounded failure without creating a second namespace or widening
authority. A crash, timeout, duplicate delivery, or lost acknowledgement MUST be
safe to retry.

Failure information SHALL use a stable allowlisted code of at most 64 ASCII
characters, a sanitized message of at most 512 UTF-8 bytes, a Boolean
`retryable`, and an optional `retry_after` timestamp. It MUST NOT contain user
content, secrets, tokens, provider references, internal endpoints, another
User's identifiers, or raw upstream responses.

#### Scenario: Provider provisioning fails after desired state commits

- GIVEN the desired-state transaction committed an enabled configuration and a
  provisioning attachment
- WHEN provider reconciliation fails
- THEN the attachment moves to `failed` for that same desired generation
- AND requested facets remain enabled
- AND public readiness is `failed`
- AND no partial Session, workload, capability, or replacement attachment is
  created

#### Scenario: Lost acknowledgement converges

- GIVEN provider reconciliation succeeded but its acknowledgement was lost
- WHEN the same outbox operation is delivered again
- THEN reconciliation verifies or returns the existing provider resource
- AND the same attachment advances to `ready`
- AND no duplicate namespace, attachment, capability, or authority is created

### Requirement: Explicit Readiness and Stable Agent Start Failures

Readiness SHALL become `ready` only after the provider resource is usable and
the exact attachment, Agent, Project, and owner bindings have been revalidated.
When memory is requested but is not ready, Agent Start SHALL fail before Session
creation with ACP's bounded JSON error envelope and one of these stable codes:

<!-- markdownlint-disable MD013 -->

| Condition | HTTP | Code | Retryable |
|---|---:|---|---|
| Attachment is provisioning | 409 | `MANAGED_MEMORY_NOT_READY` | true |
| Attachment reconciliation failed | 409 | `MANAGED_MEMORY_FAILED` | attachment value |
| Attachment state or binding is inconsistent | 409 | `MANAGED_MEMORY_STATE_INVALID` | false |

<!-- markdownlint-enable MD013 -->

`MANAGED_MEMORY_NOT_READY` SHOULD include a bounded `Retry-After` header when a
server-derived retry time is available. No error response SHALL reveal provider
identity, attachment metadata, another User's state, or reusable authority.

#### Scenario: Provisioning blocks a new Session safely

- GIVEN either facet is enabled and readiness is `provisioning`
- WHEN the authorized owner attempts Agent Start
- THEN the response is HTTP 409 with `MANAGED_MEMORY_NOT_READY`
- AND no Session, workload, lease, capability, model invocation, or memory
  operation is created

#### Scenario: Failed provisioning remains actionable

- GIVEN either facet is enabled and readiness is `failed`
- WHEN the authorized owner reads or starts the Agent
- THEN the requested configuration remains unchanged
- AND the response exposes only the stable bounded failure descriptor
- AND Agent Start returns `MANAGED_MEMORY_FAILED` before creating a Session

### Requirement: Explicit Idempotent Retry

Retrying a failed attachment SHALL use the ordinary Enterprise Assistant
preview and conditional provisioning contract. The owner SHALL obtain a fresh
preview and submit the same desired configuration and its fresh preview digest
with the current strong precondition. A valid retry SHALL increment the desired
generation, reset the same non-retired attachment to `provisioning`, clear only
its prior bounded failure descriptor, and enqueue a new idempotent outbox
operation. It MUST NOT replace the Agent or attachment.

#### Scenario: Retry a failed attachment

- GIVEN a current failed attachment whose desired facets remain enabled
- WHEN the owner submits a fresh equivalent preview and conditional PUT
- THEN the same attachment ID begins a new desired generation in `provisioning`
- AND repeated or lost-acknowledgement retries converge through conditional
  request semantics
- AND no second attachment, namespace, or authorization is created

#### Scenario: Stale retry is rejected

- GIVEN attachment state, ownership, requested facets, or desired generation
  changed after preview
- WHEN the client submits the stale conditional PUT
- THEN the request fails under the lifecycle precondition contract
- AND no attachment or outbox state changes

### Requirement: Immutable Session Launch Snapshot

Agent Start SHALL create one immutable `SessionLaunchSnapshot` in the same
database transaction as the Session. The snapshot SHALL bind the Session to its
exact User, Project, Agent, privileged system instructions, lower-priority user
instruction context, template and customization digests, runtime selector,
non-secret provider context, requested memory facets,
attachment ID, attachment version, and memory desired generation when present,
and a positive snapshot schema version. For a memory-enabled start, all resource
IDs, versions, and generations SHALL be copied only after readiness and
ownership are revalidated under the start transaction. The snapshot desired
generation SHALL equal both the current Enterprise Assistant configuration and
the ready attachment generation; any mismatch SHALL fail Agent Start before a
Session row is created. A memory-disabled snapshot SHALL persist null attachment
ID, attachment version, and memory desired generation.

The control plane and Runner SHALL consume the launch snapshot rather than
re-reading mutable Agent, customization, requested-memory, or attachment state.
Session update paths SHALL reject changes to the snapshot or any of its bound
fields. No later Agent customization, readiness transition, provider repair, or
attachment reconciliation may rewrite or reinterpret an existing snapshot.

#### Scenario: Customization cannot race a pending Session

- GIVEN Agent Start created a pending Session and its immutable launch snapshot
- WHEN the owner changes customization or requested memory before workload
  reconciliation
- THEN the control plane provisions the pending Session only from its snapshot
- AND the Session neither gains nor loses managed memory
- AND a later Agent Start uses the new authoritative state

#### Scenario: Existing Session remains unchanged

- GIVEN a Session snapshot includes a ready managed attachment and enabled
  facets
- WHEN the Agent's attachment later becomes failed, draining, or deleted
- THEN the stored Session snapshot, messages, transcript, lineage, rendered
  instructions, runtime, and provider context remain unchanged
- AND only the separately governed live Session lease may affect continuing
  memory access

### Requirement: Exact-Session Nondelegable Capability

Every memory-enabled Session SHALL have exactly one server-owned
`ManagedMemorySessionLease` matching its launch snapshot. The lease SHALL bind
the canonical `user_id`, `project_id`, `agent_id`, `session_id`, attachment ID
and version, positive memory desired generation, enabled facets, capability
generation, fixed audience `managed-agentic-memory`, issuance time, expiry, and
revocation state. The lease MUST NOT be shared, transferred, delegated,
inherited by child Sessions, or expanded after Session creation.

The platform SHALL mint only short-lived capability tokens from an active lease.
Each token SHALL bind every lease identity field, exact enabled facets, fixed
audience, memory desired generation, unique token ID, issued-at time, and expiry.
Renewal SHALL require the platform's separately authenticated exact-Session
runtime identity and an active nonterminal lease. A token for another User,
Project, Agent, Session, attachment, attachment version, memory desired
generation, facet, audience, or capability generation SHALL fail closed. Raw
tokens SHALL not be persisted and MUST remain outside Agent/model environment,
files, CLI arguments, logs, prompts, tool results, and browser APIs.

#### Scenario: Child or peer Agent cannot inherit memory

- GIVEN a memory-enabled Enterprise Agent Session creates or contacts another
  Agent or child Session
- WHEN that peer attempts managed-memory access
- THEN no lease or token is inherited from the Enterprise Agent Session
- AND the peer cannot use the parent's attachment ID, tool connection, or token
- AND authorization reveals no attachment or owner metadata

#### Scenario: Capability renewal is exact

- GIVEN a nonterminal Session has an active matching lease
- WHEN its authenticated runtime renews the memory capability
- THEN the platform mints a short-lived token for only that exact lease and
  capability generation
- AND terminal, expired, revoked, mismatched, or replayed authority is rejected

### Requirement: Reserved Managed-Memory MCP Boundary

The MCP server name `managed-memory` SHALL be reserved to the platform. Agent
payloads, repository settings, generic MCP configuration, browser input, and
user customization MUST NOT create, replace, shadow, or merge that name. A
collision in a baked, inline payload, generic, browser, customization, bridge,
in-process, or generated source available without provisioning SHALL fail Agent
Start before a Session, lease, provider, proxy, sandbox, or workload is created.
Repository content knowable only after clone SHALL be inspected after the Session
and immutable snapshot commit but before MCP merge or Agent/model execution. A
collision there SHALL terminalize the existing Session, revoke its lease and
exact-Session provider, stop and remove its proxy, and clean its sandbox and
payload idempotently.

For a ready memory-enabled Session, the control plane SHALL project exactly one
local managed-memory proxy or sidecar derived from the immutable launch snapshot
and active lease. Runner configuration SHALL contain only the local connection;
the proxy SHALL acquire and renew capability outside the Agent/model boundary.
Tool schemas SHALL NOT accept User, Project, Agent, Session, attachment,
namespace, provider-resource, credential, endpoint, audience, bank, or facet
selectors. For every tool call, the proxy SHALL fan out server-side across all
facets enabled by the immutable snapshot, in reviewed facet order, and bind each
operation to the exact lease. The model cannot select, omit, reorder, or add a
facet.

Starter and customized memory-disabled Sessions SHALL receive no
`managed-memory` MCP entry, proxy, sidecar, route, capability, memory-specific
prompt section, or claim that managed memory is configured.

#### Scenario: Precommit MCP configuration cannot shadow managed memory

- GIVEN a baked, inline payload, generic, browser, customization, bridge,
  in-process, or generated source available without provisioning contains a
  server named `managed-memory`
- WHEN Agent Start validates its precommit runtime inputs
- THEN start fails with a bounded configuration conflict
- AND the untrusted server is not launched or merged
- AND no Session, workload, lease, provider, proxy, or capability is created

#### Scenario: Repository MCP collision revokes committed authority

- GIVEN Agent Start committed a Session and immutable launch snapshot
- WHEN repository content knowable only after clone contains a server named
  `managed-memory`
- THEN no untrusted MCP server, bridge, or Agent/model process is launched
- AND the existing Session becomes terminal `Failed`
- AND its lease and exact-Session provider are revoked and its proxy, sandbox,
  and payload are removed idempotently

#### Scenario: Tool arguments cannot select another attachment

- GIVEN a model can call a managed-memory tool
- WHEN it supplies or embeds another identity, attachment, namespace, endpoint,
  bank, facet, or disabled-facet hint
- THEN schema validation or the server-side lease binding rejects the operation
- AND the response reveals no existence or metadata for the attempted target

### Requirement: Disable, Drain, and Garbage Collection

Disabling both facets SHALL detach managed memory from future Agent Starts as
soon as the conditional configuration transaction commits. Public readiness
SHALL become `not-configured`, and no new lease or capability may be issued from
the former attachment.

The former attachment SHALL move to `draining` while any exact-Session lease is
active. Existing Sessions retain their immutable snapshots and MAY continue to
renew only their own lease until that Session becomes terminal, the lease
expires, or an authorized revocation occurs. When no active lease remains, the
outbox SHALL enqueue provider cleanup and move the attachment through
`deleting` to `retired`. Cleanup MUST be idempotent. The user-visible disable
operation SHALL NOT silently claim that provider data was deleted; any data
retention or explicit erasure workflow SHALL be governed separately.

Active lease state SHALL be the sole garbage-collection gate. An immutable
Session snapshot remains historical lineage after its matching lease becomes
terminal, expired, or revoked and SHALL NOT independently delay attachment
cleanup. A nonterminal Session whose lease expired or was revoked retains its
snapshot but has no managed-memory authority and cannot renew that lease.

If the owner re-enables memory while the matching attachment is still draining
and provider state is usable, reconciliation MAY cancel cleanup and reuse the
same attachment with a new desired generation. It MUST NOT reactivate an
expired or revoked Session lease.

#### Scenario: Disable affects only future starts

- GIVEN one live Session has a managed-memory lease
- WHEN the owner disables both facets
- THEN later Agent Starts contain no memory attachment or capability
- AND the live Session snapshot and lease remain exact and unchanged
- AND the attachment drains until that lease terminates or expires

#### Scenario: Garbage collection waits for leases

- GIVEN a disabled configuration has a draining attachment
- WHEN at least one matching Session lease remains active
- THEN provider cleanup does not run
- WHEN the last matching lease becomes terminal, expired, or revoked
- THEN cleanup is enqueued once and may retire only that attachment

### Requirement: Administrative Break-Glass

Normal administrators, services, Agents, and Sessions SHALL NOT bypass the
exact owner-and-Agent attachment boundary. Memory quarantine, attachment repair,
and exact-Session lease revocation SHALL use only the authenticated, closed,
idempotent operation and matching action schema in the
[Audited Administrative Break-Glass](identity-and-provisioning.spec.md#requirement-audited-administrative-break-glass)
contract. This specification defines no second endpoint, token profile, action
name, target shape, or administrator bypass.

Break-glass MUST NOT mint a reusable owner capability, transfer an attachment,
delegate access, or expose provider credentials. Content access, when required
for an independently authorized incident workflow, SHALL use a separate
time-bounded audited capability and is not implied by repair or revocation
authority.

#### Scenario: Emergency revocation overrides lease continuity

- GIVEN an active memory-enabled Session presents a security risk
- WHEN an authorized administrator invokes `memory-lease.revoke` through the
  canonical repair-operations endpoint
- THEN the exact affected lease `capability_generation` is revoked
- AND subsequent tool calls and renewals fail closed
- AND unrelated Users, Agents, attachments, and Sessions remain unchanged

### Requirement: Compatibility and Migration

The platform SHALL NOT infer managed memory from legacy browser state,
onboarding drafts, prompt content, display names, existing MCP configuration, or
Agent naming. Existing Sessions SHALL receive no managed-memory attachment or
capability solely from migration.

Rollout SHALL backfill the memory portion of existing Session launch state as
disabled and attachment-free without rewriting messages, transcripts, lineage,
runtime state, or provider context. Enterprise Assistant customization MUST NOT
be enabled until every nonterminal Agent-bound Session has an immutable launch
snapshot that the control plane can consume without re-reading mutable Agent
state.

#### Scenario: Existing resources are not auto-enrolled

- GIVEN an Agent or Session predates managed Enterprise Assistant memory
- WHEN the capability becomes available
- THEN no attachment, lease, capability, proxy, or MCP entry is created solely
  by migration or discovery
- AND the existing resource continues with its previously persisted behavior

#### Scenario: Authorized customization establishes desired state

- GIVEN the canonical owner customizes an eligible Enterprise Agent
- WHEN the owner enables at least one memory facet
- THEN the platform persists a new desired generation and reconciles exactly one
  isolated attachment
- AND Agent Start cannot use it until readiness is `ready`
