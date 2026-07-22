# Enterprise Assistant Lifecycle Specification

## Purpose

This specification defines authenticated-self discovery, desired-state preview,
conditional provisioning, reconciliation, and runtime behavior for one
user-owned Enterprise Agent. It composes the Enterprise Assistant identity,
template, customization, and managed-memory contracts. An Enterprise Agent
remains an ordinary persistent ACP Agent, and every runtime remains an ordinary
Agent-bound Session.

## Requirements

### Requirement: Shared HTTP and JSON Contract

The Enterprise Assistant API SHALL expose these authenticated-self operations:

```text
GET  /api/ambient/v1/users/me/enterprise-agent
POST /api/ambient/v1/users/me/enterprise-agent/preview
PUT  /api/ambient/v1/users/me/enterprise-agent
```

All three operations SHALL derive the canonical User from the authenticated
principal and SHALL reject `X-Ambient-Project` in any casing or multiplicity.
They SHALL NOT accept a User, Project, Agent, owner, provider, Credential, or
attachment selector from the client.

Every response SHALL send `Cache-Control: no-store`; compatibility responses
SHOULD also send `Pragma: no-cache`. Every JSON response SHALL send
`Content-Type: application/json`. A 401 response SHALL include the deployment's
applicable `WWW-Authenticate` challenge.

POST and PUT SHALL accept only the `application/json` media type, allowing an
optional case-insensitive `charset=utf-8` parameter and no other parameter.
Their request representation data SHALL be at most 16 KiB. The server SHALL
reject an oversized declared or streamed body before allocating or logging the
complete body. `Content-Encoding` SHALL be absent or `identity`; another content
coding SHALL return HTTP 415 rather than create a size-limit bypass.

Every public `format: date-time` value reachable from these self-scoped
contracts, including canonical User `created_at` and `updated_at` fields and
Enterprise Agent `retry_after`, SHALL use RFC 3339 with a seconds field from
`00` through `59`. Leap-second values with seconds `60` SHALL be rejected at
the server boundary and by generated clients before a value is used.

Before ordinary Go unmarshalling, the server SHALL use a bounded JSON token
decoder that:

- requires well-formed UTF-8 and one complete top-level object;
- rejects duplicate member names at every object depth;
- rejects strings that do not contain valid Unicode scalar values;
- accepts numbers only for the three disposition members, only as decimal
  integer tokens without a fraction or exponent, and only from one through five;
- rejects trailing non-whitespace data, nulls where the schema is non-null, and
  unknown members; and
- retains integer values without a floating-point round trip.

The server SHALL never log a request body, rendered system instructions,
user-instruction context, custom instruction, Credential identifier, Credential
material, attachment identifier, or external memory-provider reference.

#### Scenario: Error precedence is deterministic

- GIVEN one request violates more than one rule
- WHEN the server evaluates it
- THEN authentication and actor eligibility are evaluated first
- AND header, media-type, size, strict-JSON, and schema checks follow in that
  order
- AND GET and preview then use one consistent read snapshot to validate
  ownership, provenance, cardinality, and managed-provider availability
- AND PUT acquires its mutation transaction lock before the same state checks
- AND HTTP preconditions and the recomputed preview digest are evaluated after
  those normal request checks and immediately before mutation
- AND a false HTTP conditional header returns before a stale preview digest
- AND the server returns only the first failure under that order
- AND no failure path writes partial state

### Requirement: Stable Error Contract

Failures SHALL use the existing ACP `Error` representation with a stable `code`,
a bounded non-sensitive `reason`, and `operation_id`. Enterprise Assistant
operations SHALL use these status and code pairs:

<!-- markdownlint-disable MD013 -->

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | Malformed, duplicate-member, trailing, invalid-string, or invalid-number body |
| 400 | `invalid_header` | Invalid or conflicting conditional header syntax |
| 400 | `ambient_project_forbidden` | `X-Ambient-Project` was supplied |
| 401 | `authentication_required` | Missing or invalid authentication |
| 403 | `enterprise_agent_ineligible` | Caller is not one eligible canonical human User |
| 404 | `enterprise_agent_not_found` | No generated Enterprise Agent state exists |
| 409 | `enterprise_agent_conflict` | Foreign, partial, ambiguous, tombstoned, or inconsistent state requires repair |
| 409 | `preview_stale` | Desired state, designation generation, or provider revision differs from preview |
| 412 | `precondition_failed` | `If-Match` or `If-None-Match` evaluated false |
| 413 | `request_too_large` | Request body exceeds 16 KiB |
| 415 | `unsupported_media_type` | Request media type is not supported JSON |
| 422 | `validation_failed` | Typed schema, value, or setup-and-memory validation failed |
| 428 | `precondition_required` | Provisioning request omitted its required precondition |
| 500 | `internal_error` | Internal processing or transaction failure |
| 503 | `managed_provider_unavailable` | The managed inference-provider designation is absent, ambiguous, revoked, or unavailable |

<!-- markdownlint-enable MD013 -->

Reasons MAY add safe recovery guidance but SHALL NOT disclose another User,
foreign resource metadata, a Credential identifier, attachment metadata,
system instructions, user instruction context, or unbounded user content. An
unavailable dependency MAY send `Retry-After` only when the server has a
defensible retry interval.

### Requirement: Canonical Composite Representation

The GET and successful PUT response body SHALL use one
`EnterpriseAgentState` representation containing exactly:

- `project`;
- `owner_role_binding`;
- `provider`;
- `provider_role_binding`;
- `agent`;
- `template_key`;
- `template_digest`;
- `customization`;
- `customization_digest`;
- `setup_mode`;
- `memory_configuration`;
- `memory_readiness`;
- `memory_failure`; and
- `state_digest`.

The nested transformed DTOs SHALL have these exact members:

```json
{
  "project": {
    "id": "project-id",
    "name": "ea-example",
    "annotations": {
      "ambient-code.io/enterprise-agent/managed": "true",
      "ambient-code.io/enterprise-agent/template-key": "ambient-code/enterprise-agent/artoo",
      "ambient-code.io/enterprise-agent/template-digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  },
  "owner_role_binding": {
    "id": "owner-binding-id",
    "role_id": "owner-role-id",
    "scope": "project",
    "user_id": "canonical-user-id",
    "project_id": "project-id"
  },
  "provider": {
    "id": "provider-id",
    "project_id": "project-id",
    "name": "enterprise-agent-default",
    "type": "vertex",
    "secret": null,
    "namespace": null,
    "annotations": {
      "ambient-code.io/enterprise-agent/managed": "true"
    },
    "designation_generation": 7,
    "revision": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "provider_role_binding": {
    "id": "provider-binding-id",
    "role_id": "credential-consumer-role-id",
    "scope": "credential",
    "project_id": "project-id",
    "agent_id": "agent-id"
  },
  "agent": {
    "id": "agent-id",
    "project_id": "project-id",
    "name": "enterprise-agent",
    "display_name": "Artoo",
    "runner_type": "gemini-cli",
    "llm_model": "gemini-3.5-flash",
    "system_instructions": "verified platform-owned system instructions",
    "user_instruction_context": "rendered lower-priority user instruction context",
    "providers": ["enterprise-agent-default"],
    "annotations": {
      "ambient-code.io/enterprise-agent/managed": "true",
      "ambient-code.io/enterprise-agent/template-key": "ambient-code/enterprise-agent/artoo",
      "ambient-code.io/enterprise-agent/template-digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "ambient-code.io/enterprise-agent/customization-digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "ambient-code.io/enterprise-agent/setup-mode": "starter"
    }
  },
  "template_key": "ambient-code/enterprise-agent/artoo",
  "template_digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "customization": {
    "display_name": "Artoo",
    "custom_instructions": "",
    "dispositions": {
      "empathy": 4,
      "skepticism": 2,
      "literalism": 2
    }
  },
  "customization_digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "setup_mode": "starter",
  "memory_configuration": {
    "personal_enabled": false,
    "coding_enabled": false
  },
  "memory_readiness": "not-configured",
  "memory_failure": null,
  "state_digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

These are deliberately transformed Enterprise Assistant DTOs, not the generic
ACP Project, Provider, RoleBinding, or Agent wire representations. In particular,
annotation strings are parsed and validated into string-to-string objects;
`agent.system_instructions` contains only verified platform-owned system bytes;
`agent.user_instruction_context` contains the separately rendered lower-priority
customization context; `agent.llm_model` is exactly `gemini-3.5-flash`; and the
public provider type is exactly `vertex`. The public provider
`designation_generation` is a positive integer no greater than
`9007199254740991` copied from the protected managed-Credential designation.
The cap is part of the public JSON contract and guarantees exact representation
by generated TypeScript clients; it does not cap unrelated internal database
generations. A protected designation outside this range is unavailable and
SHALL NOT be projected. The public provider binding omits `user_id`,
`credential_id`, and `session_id`. The server SHALL reject rather than present
an object whose stored annotation JSON is malformed, duplicated,
non-string-valued, incomplete, or contains an unexpected reserved value.

The generic Agent `prompt` field MAY serve only as an underlying internal
compatibility carrier for the platform-owned system bytes. It SHALL NOT appear
in the Enterprise Assistant DTO, establish public authority, contain or absorb
the user-instruction context, or replace server derivation from the verified
bundle and typed normalized customization. If used, its bytes MUST equal
`system_instructions`; drift is an Enterprise Agent conflict.

`memory_failure` SHALL be null unless `memory_readiness` is `failed`. For failed
readiness it SHALL contain exactly string `code` of at most 64 ASCII characters,
string `message` of at most 512 UTF-8 bytes, Boolean `retryable`, and nullable
UTC RFC 3339 string `retry_after`. Its values SHALL be the bounded sanitized
descriptor persisted under the managed-memory contract.

### Requirement: Exact State Digest and Strong Entity-Tag

The server SHALL compute `state_digest` as SHA-256 over RFC 8785 canonical bytes
of this exact internal logical object:

```text
{
  "user_id": <canonical User.id>,
  "project": <exact public project DTO>,
  "owner_role_binding": {
    "id": <id>,
    "role_id": <project:owner Role.id>,
    "scope": "project",
    "user_id": <canonical User.id>,
    "project_id": <Project.id>,
    "agent_id": null,
    "session_id": null,
    "credential_id": null
  },
  "provider": <exact public provider DTO including designation_generation and revision>,
  "provider_role_binding": {
    "id": <id>,
    "role_id": <credential:consumer Role.id>,
    "scope": "credential",
    "user_id": null,
    "project_id": <Project.id>,
    "agent_id": <Agent.id>,
    "session_id": null,
    "credential_id": <managed Credential.id>
  },
  "agent": <exact public agent DTO>,
  "template_key": "ambient-code/enterprise-agent/artoo",
  "template_digest": <digest>,
  "customization": <exact normalized customization>,
  "customization_digest": <digest>,
  "setup_mode": <"starter" or "customized">,
  "memory_configuration": <exact two-Boolean object>,
  "desired_generation": <positive integer>,
  "memory_attachment": null | {
    "id": <internal attachment id>,
    "user_id": <canonical User.id>,
    "project_id": <Project.id>,
    "agent_id": <Agent.id>,
    "desired_generation": <positive integer>,
    "version": <positive integer>,
    "lifecycle_state": <"provisioning", "ready", "failed", "draining", or "deleting">
  },
  "memory_readiness": <"not-configured", "provisioning", "ready", or "failed">,
  "memory_failure": <exact public failure DTO or null>
}
```

The exact public Agent DTO in this preimage SHALL bind
`system_instructions` and `user_instruction_context` as two independent string
members. The server SHALL NOT concatenate them before canonicalization.

The digest preimage SHALL omit database timestamps, soft-delete timestamps, raw
upstream error detail, and external provider identifiers. It SHALL include the
managed Credential ID and memory attachment ID only inside the server-computed
preimage; neither identifier is returned. A memory-enabled target without
exactly one correctly owned attachment SHALL be inconsistent and SHALL NOT
receive a normal representation or entity-tag. For a consistent memory-enabled
target, the attachment desired generation SHALL equal the configuration desired
generation and its version SHALL be positive.

When both configured facets are disabled, public `memory_readiness` SHALL be
`not-configured` and `memory_failure` SHALL be null. A still-persisted internal
attachment SHALL be correctly owned and in `draining` or `deleting`; any
`provisioning`, `ready`, or `failed` attachment is inconsistent. A draining or
deleting attachment SHALL remain in the private digest preimage until cleanup
completes. A `retired` attachment SHALL be omitted from the preimage by
representing `memory_attachment` as null; retirement and removal therefore
cannot expose an external attachment identifier through public state.

`desired_generation` belongs to `EnterpriseAssistantConfig` and SHALL increase
for each changed desired memory configuration and each explicit retry of a
failed attachment. Attachment `version` SHALL follow the managed-memory record
contract. A transport retry or duplicate outbox delivery for the same desired
generation SHALL increment neither value.

`state_digest` SHALL use `sha256:<64 lowercase hex>`. GET SHALL send the same
digest as the strong HTTP entity-tag value `"sha256:<64 lowercase hex>"`, with
the double quotes required by HTTP syntax. GET and PUT response bodies SHALL
carry the unquoted digest string in `state_digest`. An attachment version,
desired-generation, lifecycle-state, or bounded-failure change SHALL change the
digest and entity-tag.

### Requirement: Authenticated-Self Discovery

`GET /api/ambient/v1/users/me/enterprise-agent` SHALL be the sole authoritative
cross-profile discovery operation. It SHALL require no Project context and
SHALL derive the deterministic Project and complete Enterprise Agent state from
the canonical User.

#### Scenario: Current state is returned with a validator

- GIVEN one complete, canonically owned, internally consistent Enterprise Agent
  resource set exists
- WHEN its owner performs GET
- THEN the server returns HTTP 200 with the exact `EnterpriseAgentState`
- AND sends the exact strong `ETag` derived from `state_digest`
- AND the representation exposes normalized customization and requested memory
  configuration from typed server-owned persistence, never prompt parsing
- AND it exposes provider and memory readiness without a Credential identifier,
  attachment identifier, external bank identifier, secret, or token
- AND failed readiness includes only the bounded `memory_failure` descriptor

#### Scenario: Absence and conflict are distinct

- GIVEN no active or tombstoned deterministic Project, reserved Agent, reserved
  Provider, managed entitlement, or attachment exists for that User and template
- WHEN GET runs
- THEN it returns HTTP 404 with `enterprise_agent_not_found`
- GIVEN any matching state is foreign, partial, ambiguous, tombstoned, or
  internally inconsistent
- WHEN GET runs
- THEN it returns HTTP 409 with `enterprise_agent_conflict`
- AND neither response adopts, repairs, mutates, or reveals conflicting state

### Requirement: Exact Desired-State Preview

`POST /api/ambient/v1/users/me/enterprise-agent/preview` SHALL be a non-mutating
desired-state operation. Its request object SHALL contain exactly:

- required non-null string `template_key` with exact value
  `ambient-code/enterprise-agent/artoo`;
- required non-null string `setup_mode` with value `starter` or `customized`;
- required non-null object `memory_configuration` containing exactly Boolean
  members `personal_enabled` and `coding_enabled`; and
- optional non-null object `customization`.

The customization input SHALL be a closed partial object. Its optional members
are non-null string `display_name`, non-null string `custom_instructions`, and a
non-null closed partial `dispositions` object whose optional members are integer
`empathy`, `skepticism`, and `literalism`. Both objects SHALL reject unknown
members and null values. Every supplied value SHALL satisfy the canonical type,
normalization, length, secret-detection, and range rules.

Omitted customization, `{}`, and omitted nested disposition members request
their reviewed template defaults; supplied members override only their
corresponding defaults. The server SHALL always produce the complete normalized
three-member customization object. `setup_mode:"starter"` SHALL accept only
Artoo defaults and both memory facets disabled. `setup_mode:"customized"` SHALL
use the reviewed structured customization and requested memory settings.

On success preview SHALL return HTTP 200 with exactly `project_name`, normalized
`customization`, `customization_schema`, `effective_agent`, `template_key`,
`template_digest`, `customization_digest`, `setup_mode`,
`memory_configuration`, `provider`, and `preview_digest`.

`effective_agent` SHALL contain exactly string `name`, `display_name`,
`runner_type`, `llm_model`, `system_instructions`, and
`user_instruction_context`; string-array `providers`; and string-to-string
object `annotations`. It SHALL use Agent resource name `enterprise-agent`, Artoo
as the starter display name, `gemini-cli`, `gemini-3.5-flash`, exactly
`["enterprise-agent-default"]`, and the complete five-key Agent provenance.
`system_instructions` SHALL be the complete verified platform-owned system bytes
that would be persisted through the internal Agent compatibility mapping;
`user_instruction_context` SHALL be the separately rendered lower-priority
context and SHALL never be concatenated into the system bytes.

`provider` SHALL contain only string `name`, string `type` with exact value
`vertex`, positive integer `designation_generation`, and string `revision`. The
revision contract remains defined by the managed inference-provider
specification, SHALL bind that same designation generation, and SHALL never
disclose its Credential ID. A generation mismatch between the protected
designation, provider summary, and revision input is inconsistent.

`customization_schema` SHALL be the normalized-output and UI schema, not the
partial request-input schema. It SHALL be one JSON Schema Draft 2020-12 object
whose exact types, defaults, limits, required members, and
`additionalProperties:false` constraints encode the complete Artoo
customization contract. It SHALL include
`$schema:"https://json-schema.org/draft/2020-12/schema"` and SHALL itself be
bound by `preview_digest`.

The preview digest preimage SHALL be RFC 8785 canonical JSON with exactly:

```text
{
  "user_id": <canonical User.id>,
  "project_name": <deterministic Project name>,
  "template_key": "ambient-code/enterprise-agent/artoo",
  "template_digest": <digest>,
  "customization": <exact normalized customization>,
  "customization_schema": <exact returned schema>,
  "customization_digest": <digest>,
  "setup_mode": <"starter" or "customized">,
  "memory_configuration": <exact two-Boolean object>,
  "effective_agent": <exact returned effective_agent DTO>,
  "provider": <exact returned provider summary>
}
```

The exact returned `effective_agent` in this preimage SHALL independently bind
its `system_instructions` and `user_instruction_context` members; a change to
either SHALL change `preview_digest`.

`preview_digest` SHALL be SHA-256 over those bytes in
`sha256:<64 lowercase hex>` form. Preview SHALL return no current
representation, current entity-tag, `current_matches_preview`, attachment
readiness, or browser-derived value. Clients obtain current state and its
validator only through GET.

#### Scenario: Preview has no side effects

- GIVEN a valid desired starter or customized configuration
- WHEN preview succeeds or fails
- THEN no Project, RoleBinding, Provider, Agent, attachment intent, outbox row,
  Session, pod, sandbox, Credential, or notification is written
- AND an existing customized Enterprise Agent is neither changed nor
  represented as current starter state by the desired preview document

### Requirement: Conditional Idempotent Provisioning

`PUT /api/ambient/v1/users/me/enterprise-agent` SHALL accept exactly the preview
request fields plus `preview_digest`. Initial creation SHALL require
`If-None-Match: *`. Updating an existing Enterprise Agent SHALL require exactly
one strong `If-Match` value copied from the latest successful GET. The server
SHALL reject both headers together, wildcard `If-Match`, weak validators,
validator lists, and a missing precondition.

Under the same database transaction and per-User/template transaction lock, the
server SHALL reauthenticate, reauthorize, renormalize, reload the template,
revalidate the managed provider, recompute the complete desired preview and its
digest, load current state, and evaluate the HTTP precondition immediately
before mutation. Client-provided digests and entity-tags are freshness inputs,
never authority.

A false `If-Match` or `If-None-Match` SHALL return HTTP 412. If the HTTP
condition passes but the recomputed desired preview, designation generation, or
managed-provider revision does not match `preview_digest`, PUT SHALL return HTTP
409 with `preview_stale`.

An Enterprise Agent that has reached `customized` SHALL never transition to
`starter`. PUT SHALL return HTTP 422 with `validation_failed` for that attempted
downgrade even when its entity-tag is current.

Successful PUT SHALL return the exact `EnterpriseAgentState`: HTTP 201 with
`Location: /api/ambient/v1/users/me/enterprise-agent` for first creation, or
HTTP 200 for a successful update. A PUT whose failed `If-Match` request is
proven to have already produced the exact requested state MAY return HTTP 200
without another mutation. Because the request representation is transformed, a
successful PUT SHALL NOT send `ETag`; clients MUST perform a fresh GET before
another update.

#### Scenario: Skip provisions memoryless Artoo

- GIVEN a current starter preview and GET established that no generated target
  exists
- WHEN PUT with `If-None-Match: *` succeeds
- THEN it creates the exact canonical resource set with Agent resource name
  `enterprise-agent`, display name `Artoo`, and setup mode `starter`
- AND both requested memory facets are false and readiness is `not-configured`
- AND no managed-memory attachment, Session, workload, pod, or sandbox exists

#### Scenario: Retry recovers without duplication

- GIVEN initial creation committed but its response was lost
- WHEN the caller repeats the same PUT with `If-None-Match: *`
- THEN the server returns HTTP 412 because the target now exists
- AND the client recovers through GET without a second write
- GIVEN an update committed but its response was lost
- WHEN the exact update is retried with its prior `If-Match`
- THEN the server returns either HTTP 200 after proving the exact desired state
  already exists or HTTP 412 followed by authoritative GET recovery
- AND neither path duplicates a resource, entitlement, attachment intent, or
  external side effect

#### Scenario: Stale Skip cannot downgrade customization

- GIVEN GET returns an existing customized Enterprise Agent
- WHEN a stale client previews the starter desired state
- THEN preview remains non-mutating and returns only that desired starter preview
- AND a creation PUT with `If-None-Match: *` returns HTTP 412
- AND an update PUT with the current `If-Match` returns HTTP 422 rather than
  downgrading setup mode
- AND the client uses GET to retain and present the existing customized state

### Requirement: Atomic Database State and Asynchronous Memory Reconciliation

Enterprise Agent provisioning SHALL execute one explicit PostgreSQL transaction
that owns both the database-scoped advisory transaction lock and every resource
write. The lock key SHALL derive from exact canonical `User.id`, a NUL separator,
and exact `template_key`. Hashing that key for PostgreSQL lock arguments MAY
serialize unrelated collisions but SHALL NOT establish identity or uniqueness.

The transaction SHALL lock or recheck the canonical User, protected managed
provider designation and Credential, deterministic Project state, reserved
Agent and Provider, owner and managed-entitlement bindings, typed Enterprise
Agent configuration, and managed-memory attachment intent. It SHALL NOT compose
the write by opening independent transactions through generic resource service
methods.

Database migrations SHALL enforce active uniqueness for:

- deterministic Project name;
- Agent `(project_id, name)`;
- Provider `(project_id, name)`;
- the protected active managed-Vertex Credential designation;
- the sole active owner binding for an Enterprise Agent Project;
- the exact managed Credential entitlement for an Enterprise Agent;
- one `EnterpriseAssistantConfig` per canonical User, Project, and Agent; and
- one managed-memory attachment intent per Enterprise Agent and canonical User.

The managed provider SHALL be selected by a protected administrator-controlled
designation that resolves one immutable Credential ID and positive monotonic
generation. A Credential name, label, annotation, creation order, or generic list
result SHALL be non-authoritative and SHALL NOT establish or shadow that
designation. Preview, GET digest construction, conditional PUT, reconciliation,
and Start SHALL lock or recheck the exact observed generation so rotation,
revocation, and restoration cannot produce an ABA-equivalent authorized state.

Normalized customization, setup mode, requested memory configuration, and
desired generation SHALL be persisted in the server-owned
`EnterpriseAssistantConfig` associated with the exact Agent. Generic Agent
create, patch, apply, and sync operations SHALL neither write nor remove that
state. Prompt parsing and digest reversal SHALL never reconstruct it.

When memory is enabled, the transaction SHALL persist desired attachment state
and a transactional outbox event. It SHALL NOT call an external memory backend
or another external provider while holding the database transaction. After
commit, a reconciler SHALL consume the outbox idempotently and move the same
attachment intent among `provisioning`, `ready`, and `failed`. Duplicate
delivery SHALL converge on the same attachment ID, desired generation, version,
and authorization. The database SHALL permit at most one active outbox event for
an attachment ID and desired generation. A failed database transaction SHALL
create no committed resource or outbox event.

#### Scenario: Concurrent creation converges

- GIVEN two API replicas concurrently provision the same User and template
- WHEN both requests pass initial validation
- THEN the transaction lock and active uniqueness constraints serialize mutation
- AND at most one request creates the canonical set
- AND the other returns HTTP 412 or the already-applied success result
- AND no duplicate Agent, Provider, binding, attachment intent, or outbox event
  survives

### Requirement: Reconciliation and Customization

Self-service provisioning SHALL reconcile only complete state whose canonical
sole ownership and full reserved provenance are proven. Foreign, partial,
ambiguous, tombstoned, or inconsistent state SHALL return HTTP 409 for audited
administrative repair; self-service SHALL NOT implicitly take over, undelete, or
guess at missing authority.

Customization SHALL update the same Enterprise Agent and only its typed
customization, template-owned Agent fields, setup mode, customization digest,
and requested managed-memory state. Agent ID, Agent resource name, Project ID,
ownership, template key, and managed inference-provider entitlement SHALL remain
stable. Existing Sessions and their separately snapshotted system instructions,
user-instruction context, runtime, provider, and memory context SHALL remain
unchanged.

Disabling all memory facets SHALL detach the attachment from future Agent
starts. Physical external attachment deletion and authority cleanup SHALL be
deferred while any matching managed-memory Session lease remains active. When
every matching lease is terminal, expired, or revoked, reconciliation SHALL
garbage-collect the attachment idempotently. An immutable Session snapshot alone
SHALL NOT delay cleanup after its matching lease ceases to be active.

### Requirement: Agent Start Revalidation

Agent Start SHALL validate the complete Enterprise Agent state after acquiring
its ordinary Agent-start serialization boundary and before creating a Session.
It SHALL rederive and validate the canonical User and sole ownership, complete
Project, Agent, and Provider provenance, registered template bytes and digest,
normalized customization and digest, setup mode, exact platform-owned
`system_instructions`, separately rendered lower-priority
`user_instruction_context`, `runner_type`, `llm_model`, provider list and
revision, protected managed Credential designation and exact positive
designation generation, entitlement, requested memory configuration and desired
generation, attachment readiness, identity, version, and bounded failure state
when applicable, and the absence of unapproved payload, environment, entrypoint,
sandbox, policy, provider, or directive overrides.

After that validation and before opening the Session database transaction,
Agent Start SHALL synchronously perform a credential-free readiness preflight of
the compatible platform gateway and supervisor-private proxy control surface.
The preflight SHALL create no exact-Session provider, token-reader grant,
workload, credential material, or external memory authority. A failed preflight
SHALL return `managed_provider_unavailable` before a Session exists.

In the same database transaction that creates the Session, Agent Start SHALL
create its immutable launch snapshot with a positive schema version, canonical
User, Project, and Agent IDs, exact `system_instructions`, exact
`user_instruction_context`, `runner_type`, `llm_model`, template and
customization digests, non-secret provider context and revision, requested memory
facets, nullable `memory_desired_generation`, nullable attachment identity and
version, and nullable managed-memory audience. The non-secret provider context
SHALL contain the exact logical designation name, positive
`designation_generation`, and provider revision, and no Credential ID or
material.

Gemini CLI SHALL receive snapshot `system_instructions` only through its
privileged system-prompt input and snapshot `user_instruction_context` only
through the lower-priority `session-user-instruction-context` channel. The
control plane and Runner SHALL NOT concatenate, reorder, promote, demote, or
re-render either channel after the snapshot commits.

For a ready memory-enabled start, the Session transaction SHALL lock and
revalidate the current Enterprise Assistant configuration and matching ready
attachment, set snapshot `memory_desired_generation` to the positive current
`EnterpriseAssistantConfig.desired_generation`, require it to equal the
attachment desired generation, populate attachment identity and version, set the
audience to `managed-agentic-memory`, and atomically create exactly one matching
active `ManagedMemorySessionLease`. The lease SHALL bind the same User, Project,
Agent, Session, attachment identity and version, desired generation, enabled
facets, and audience as the snapshot. Session, snapshot, and lease SHALL all
commit or all roll back, so a concurrent disable or garbage-collection action
cannot race a committed pending Session.

For a memoryless or memory-disabled start, snapshot
`memory_desired_generation`, attachment identity, attachment version, and memory
audience SHALL all be null, both facet Booleans SHALL be false, and the
transaction SHALL create no `ManagedMemorySessionLease`.

Only after the Session transaction commits the Session, launch snapshot, and
managed-memory lease when applicable, the control plane SHALL create or
reconcile the exact-Session token-reader grant and provider or proxy binding
idempotently from that immutable snapshot. A post-commit creation or verification
failure SHALL terminalize that existing Session as `Failed`, revoke
or delete every partial grant, provider, capability, and workload artifact,
terminalize or revoke its managed-memory lease when present, and do so
idempotently. It SHALL NOT create a replacement Session or claim that the Session
transaction rolled back. No model invocation or managed-memory access may begin
before the exact-Session provider path is ready.

Any synchronous failure returned by Enterprise Agent Start SHALL use the
existing ACP `Error` shape with:

<!-- markdownlint-disable MD013 -->

| HTTP | Code | Meaning |
|---|---|---|
| 409 | `enterprise_agent_conflict` | Non-memory Enterprise Agent state is inconsistent |
| 409 | `MANAGED_MEMORY_STATE_INVALID` | Attachment state or binding is inconsistent |
| 409 | `MANAGED_MEMORY_NOT_READY` | Requested attachment is still provisioning |
| 409 | `MANAGED_MEMORY_FAILED` | Requested attachment reconciliation failed |
| 503 | `managed_provider_unavailable` | Managed provider or private injection path is unavailable |

<!-- markdownlint-enable MD013 -->

Validation, memory-readiness, and gateway or proxy preflight failures SHALL occur
before a Session row, message, workload, sandbox, short-lived Credential binding,
model invocation, or memory access is created. A post-commit exact-Session
provider failure retains only the terminal `Failed` Session, its immutable launch
snapshot, and required audit history after cleanup. A retryable response MAY send
`Retry-After` only when the platform can derive a safe interval. A memoryless
Artoo starter SHALL start without a memory capability.

A post-commit provider failure detected after the Start response SHALL be
reported through the existing Session `Failed` state and event stream; it SHALL
not attempt to retroactively replace that response with an HTTP error.

Enterprise Assistant `Restart` remains a client composite that stops or kills
the current runtime and performs a distinct Agent Start. It is not Session
resume and does not reuse prior scrollback as new runtime context.

### Requirement: Enterprise Assistant Discovery and One-Shot Onboarding

Clients SHALL use authenticated-self GET to discover generated state across
browser profiles. A locally selected legacy Agent MAY continue to back the
Enterprise Assistant surface only after exact Project and Agent RBAC
revalidation; it SHALL be labeled manually selected and SHALL NOT be represented
as generated Artoo.

The one-shot onboarding marker SHALL be scoped by the composite of normalized
ACP origin, canonical opaque `User.id`, and browser profile. Marker and local
notification creation SHALL be one atomic browser-storage update, or a durable
retry record SHALL preserve eventual notification delivery without duplicates.
Unknown identity or failed discovery SHALL create neither.

After successful PUT, the client SHALL GET and verify the exact authoritative
state before pinning the Agent ID. The dedicated Enterprise Agent Project SHALL
remain separate from the configured workspace and vTeam Projects. Binding SHALL
not start a Session, create a workload, or infer managed memory from browser
state.

### Requirement: OpenAPI, SDK, and Route Compatibility

Implementation SHALL define all three operations and every request, response,
header, and error in the canonical OpenAPI 3.0 documents with stable operation
IDs `getCurrentEnterpriseAgent`, `previewEnterpriseAgent`, and
`putEnterpriseAgent`. The users router SHALL register `/users/me` and its
Enterprise Agent descendants before generic `/users/{id}` handling.

OpenAPI SHALL define a distinct closed partial customization input component
whose properties and nested disposition properties are optional but non-null
when supplied. It SHALL not reuse the complete normalized customization schema,
whose three top-level members and three disposition members are all required in
responses and in the returned UI `customization_schema`.

The API-server OpenAPI client and the Go, Python, and TypeScript ACP SDKs SHALL
expose typed self, discovery, preview, and conditional PUT methods. The custom
ACP SDK generator SHALL be extended to support multiple non-resource DTO schemas,
self-scoped paths, request bodies, response headers, 201-or-200 success, and
conditional headers. It SHALL NOT misclassify an Enterprise Assistant DTO as the
primary User resource or emit a hard-coded `/{id}/{action}` method.

Generated clients SHALL preserve exact strong entity-tag syntax, expose GET
`ETag` and 201 `Location`, and allow callers to distinguish every documented
status and stable error code. Browser-facing CORS configuration, when active,
SHALL expose `ETag` and `Location`. OpenAPI generation and all three SDK drift
checks SHALL pass in the same change as the routes.

#### Scenario: Contract tests cover recovery and safety

- GIVEN the API and SDK implementation is reconciled to this specification
- WHEN contract and integration tests run
- THEN they cover strict duplicate rejection at every depth, invalid UTF-8,
  trailing JSON, 16 KiB boundaries, media-type parameters, header multiplicity,
  401 challenge, 404 absence, 409 conflict, 412 races, 413, 415, 422, and 428
- AND they cover exact DTO serialization, digest preimages, entity-tag quoting,
  provider rotation, attachment-readiness changes, lost responses, concurrent
  creation, transaction rollback injection, atomic Session-snapshot-lease
  creation versus disable and garbage collection, and outbox redelivery
- AND they prove every failed preview or PUT and every pre-commit Agent Start
  failure has no forbidden resource or external side effect
- AND they prove a post-commit provider failure retains exactly one terminal
  Session and immutable snapshot, terminalizes or revokes its lease when present,
  and cleans every partial authority and workload artifact without creating a
  replacement Session
