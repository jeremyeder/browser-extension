# Enterprise Assistant Managed-Memory Backend Specification

## Purpose

This specification defines the vendor-neutral ACP boundary between managed
Enterprise Assistant memory state and one deployment-selected memory backend.
It defines protected backend registration, an immutable reviewed memory bundle,
deterministic per-facet provider resources, the provider service-provider
interface (SPI), the private exact-Session MCP surface, and the API-server to
control-plane outbox protocol. The control plane remains the sole reconciler.

An implementation-specific adapter MAY translate this contract to a supported
backend. The set of adapter identifiers SHALL be a closed, code-owned allowlist;
deployment configuration may select an allowlisted adapter but SHALL NOT add an
adapter. ACP specifications, public APIs, Agent state, browser state, prompts,
and tool schemas SHALL NOT depend on that adapter's vendor-specific resources,
identifiers, credentials, endpoints, or terminology.

## Requirements

### Requirement: One Protected Deployment Backend Registration

Each deployment that advertises managed Enterprise Assistant memory SHALL have
exactly one active `ManagedMemoryBackendRegistration`; a deployment that does
not advertise the feature MAY have none. More than one active registration is
always invalid. The registration is internal platform configuration, not a
public ACP resource. It SHALL contain exactly:

```text
{
  logical_name: "enterprise-assistant-memory-default",
  adapter_id: <non-empty code-allowlisted string>,
  configuration_reference: <protected opaque reference>,
  credential_reference: <protected opaque reference or null>,
  bundle_reference: {
    profile: "enterprise-assistant-managed-memory",
    schema_version: "1",
    revision: "1",
    digest: "sha256:4ed8f3239bcf2acd84ff000f6a686bfb07e1f2c46833d5169ec3e7a0680479e8"
  },
  registration_generation: <positive integer>,
  enabled: <Boolean>
}
```

`adapter_id`, both protected references, and registration generation SHALL be
available only to the API server, control plane, and the internal implementation
of the canonical audited repair operation. They SHALL never be returned by that
operation. Generic Credential, Provider, Project, Agent, RoleBinding, apply,
sync, browser, SDK, CLI, MCP, and model operations SHALL neither discover nor
mutate the registration. The two references SHALL be encrypted at rest or held
in an equivalently protected secret store and SHALL never appear in logs,
errors, prompts, Session snapshots, retained evidence, or provider resource
metadata.

The active registration SHALL be selected by protected deployment
configuration, never by a user-editable name, annotation, request field,
environment value inside an Agent workload, or provider response. Zero active
registrations, more than one active registration, a disabled registration, an
unallowlisted adapter, an unreadable protected reference, or a bundle-reference
mismatch SHALL make only the managed-memory feature unavailable. It SHALL NOT by
itself make an API-server or control-plane process unready, fail a pod-level
readiness probe, block memoryless Artoo, or interrupt an ordinary or other
memory-disabled Session.

#### Scenario: Generic callers cannot select a memory backend

- GIVEN a caller controls customization, Agent fields, browser storage, MCP
  arguments, payloads, environment, Provider declarations, or repository files
- WHEN it supplies a backend name, endpoint, credential, template, bank,
  namespace, collection, tenant, or provider resource identifier
- THEN the value confers no managed-memory authority and is rejected where it
  collides with a reserved field or name
- AND only the protected active deployment registration selects the adapter

#### Scenario: Registration drift fails closed

- GIVEN an attachment was reconciled under one registration generation and
  bundle reference
- WHEN the active registration or bundle no longer matches that attachment's
  recorded generation and digest
- THEN status is not reported as ready
- AND no new Session route is issued
- AND reconciliation reports a bounded registration-drift failure rather than
  adopting or relabeling provider resources

### Requirement: Immutable Reviewed Managed-Memory Bundle

ACP SHALL consume only an independently reviewed immutable bundle matching the
active registration's exact closed `bundle_reference` above. The digest is
SHA-256 over the exact generated UTF-8 bytes, including serialization whitespace
and final LF. Revisions are append-only; different bytes SHALL never replace an
existing revision. Replacing any reference member requires a new reviewed
revision and a coordinated ACP contract change.

For this profile, ACP SHALL recognize exactly these reviewed facet bindings, in
this order:

| Configuration field | Bank role |
|---|---|
| `personal_enabled` | `personal` |
| `coding_enabled` | `coding` |

Each enabled field creates exactly one isolated bank with its corresponding
role. The adapter SHALL configure each bank in this exact order:
`configure-bank`, `configure-mental-models`, `allow-retain`. It SHALL not permit
retain before both preceding steps succeed. Each provider endpoint SHALL bind
exactly one bank. ACP MAY bind up to two such endpoints to one exact Session,
but its proxy SHALL fan out server-side in reviewed facet order and SHALL expose
no bank or facet selector. The model cannot select a bank or override the
document ID; ACP supplies the exact Session ID as the stable `document_id` for
retain. These semantics correspond to `bank_isolation`
`one-bank-per-enabled-facet`, `endpoint_mode` `single-bank`, `bank_binding_source`
`acp-server-side-session-binding`, and `stable_document_id_source`
`acp-session-id`; `model_can_select_bank` and
`model_can_override_document_id` are both false.

The reviewed model-access contract permits only `retain`, `recall`, and
`reflect`; direct provider access and every other provider operation remain
outside the Agent/model boundary. Adapter-specific members inside the reviewed
bytes are private to the adapter. ACP contracts and public state SHALL use only
the profile, digest, facet bindings, bank contract, and allowed-tool contract
defined here.

The API server and control plane SHALL verify the exact bytes against the
independently supplied registration digest before marking the managed-memory
adapter ready or accepting memory-enabled preview or configuration. This gate is
feature-scoped and SHALL NOT participate in global API-server or control-plane
pod readiness. Recomputing a digest from untrusted bytes does not establish
trust. A new bundle reference reconciles only through a new desired generation
and SHALL NOT reinterpret an existing Session lease or launch snapshot. The
managed-memory bundle remains independent of the memoryless Artoo bundle and
SHALL NOT change Artoo's prompt, starter setup mode, template or customization
digest, or disabled-memory contract.

### Requirement: One Opaque Provider Resource Set per Attachment

Each non-retired managed attachment SHALL own exactly one internal
`ManagedMemoryProviderResourceSet`. The set SHALL bind the attachment ID,
attachment version, desired generation, backend registration generation,
bundle reference, protected ACP ownership provenance, and zero to two facet
resources. It SHALL contain no publicly visible or client-supplied provider
identifier.

For an enabled facet, ACP SHALL derive the internal deterministic logical
resource key as:

```text
mmr-<lowercase unpadded RFC 4648 Base32(
  SHA-256(
    UTF-8("managed-memory-resource-v1") + 0x00 +
    UTF-8(attachment_id) + 0x00 + UTF-8(bank_role)
  )
)>
```

Attachment IDs SHALL be opaque server-assigned values without NUL. `bank_role`
SHALL be the reviewed role mapped from the enabled configuration field. The
resulting key is internal and SHALL never be returned by a public API or
accepted as input from a browser, Agent, Runner, model, MCP argument, or generic
ACP resource operation.

One attachment MUST NOT own more than one bank for an enabled field or more than
two banks in total. Because the deterministic key excludes desired generation,
a retry or later desired generation SHALL reconcile the same matching resource.
After verifying the recorded attachment binding, protected ACP ownership
provenance, and reviewed facet-template binding, the adapter SHALL atomically
advance the recorded generation to a higher requested generation. Equal
generation is idempotent; a lower requested generation is stale and SHALL make
no change.

For this rule, attachment binding means the immutable attachment ID and its
protected ownership provenance. Attachment version and desired generation are
monotonic reconciliation metadata, not immutable key provenance; a verified
newer request advances both recorded values atomically.

A keyed resource conflicts only when its attachment binding, protected
ownership provenance, or reviewed facet-template binding mismatches. It SHALL
not be adopted, relabeled, overwritten, or exposed. Desired-generation mismatch
alone is never a resource conflict. Multiple physical resources claiming the
same logical key are ambiguous provenance and SHALL fail closed.

Each logical facet resource SHALL contain exactly one bank. The adapter MAY use
other opaque vendor resources to support that bank, but SHALL NOT create another
bank for the same enabled field. Their references SHALL be sealed into the
attachment's protected provider reference and SHALL NOT enter a public
representation, Session snapshot, tool schema, model-visible file, environment
variable, CLI argument, or retained evidence.

#### Scenario: Equivalent reconciliation converges

- GIVEN the same attachment, desired generation, enabled facets, registration
  generation, and bundle reference are delivered more than once
- WHEN the adapter reconciles provider resources
- THEN every delivery resolves the same logical resource set and per-facet keys
- AND no duplicate provider namespace, collection, bank, index, or authority is
  created

#### Scenario: A later generation advances the matching resource

- GIVEN one deterministic facet resource has matching attachment, ownership,
  and reviewed template provenance at desired generation N
- WHEN generation N+1 reconciles the same attachment and facet
- THEN the adapter reuses that resource and atomically records generation N+1
- AND it creates no replacement bank
- AND a later replay of generation N is rejected as stale, not as a resource
  conflict

### Requirement: Versioned Managed-Memory Provider SPI

The control plane SHALL be the only caller of provider SPI version
`managed-memory-provider-v1`. Every call SHALL use the protected active backend
registration and one server-assembled request. The adapter SHALL reject unknown
members, missing members, duplicate members, stale desired generations, and any
identity or resource selector not derived by ACP.

The SPI SHALL expose exactly these operations:

1. `ensure`
2. `status`
3. `configure`
4. `cleanup`
5. `issue-private-session-route`

Every SPI request SHALL use this exact closed envelope:

```text
{
  spi_version: "managed-memory-provider-v1",
  operation: <exact operation name>,
  outbox_idempotency_key: <authoritative sha256 digest or null>,
  idempotency_key: <derived sha256 digest>,
  registration: {
    adapter_id: <allowlisted adapter id>,
    registration_generation: <positive integer>,
    registration_handle: <short-lived sealed handle>,
    bundle_reference: <the active registration's exact closed bundle reference>
  },
  attachment: {
    id: <opaque attachment id>,
    version: <positive integer>,
    desired_generation: <positive integer>,
    resource_set_reference: <protected opaque reference or null>
  },
  operation_input: <operation-specific closed object>
}
```

`ensure` and `status` use an empty `operation_input`. `configure` uses exactly
`enabled_facets` and `draining_facets`. Each array is ordered
`personal_enabled`, then `coding_enabled`; each entry is a closed object
containing exactly its reviewed `enabled_field` and `bank_role` mapping.
`cleanup` uses exactly `{"mode":"release-runtime-resources"}`.
`issue-private-session-route` uses exactly `session_id`,
`capability_generation`, `workload_generation`, `enabled_facets`, `audience`,
and `expires_at`, with the same ordered facet-entry schema.

The envelope SHALL contain no User, Project, Agent, endpoint, Credential,
tenant, provider bank identifier, namespace, collection, or client-selected
resource field. The reviewed `bank_role` inside a facet entry is the only bank
semantics permitted. ACP SHALL validate identities before calling the adapter,
and the adapter SHALL bind access only through the protected registration and
deterministic attachment resource keys.

For `ensure`, `status`, `configure`, and `cleanup`,
`outbox_idempotency_key` SHALL equal the one authoritative key on the claimed
outbox event and SHALL remain unchanged across the complete operation sequence,
worker retries, and lost acknowledgements. It SHALL NOT be independently
recomputed or replaced by an SPI operation key.

Each operation-level or facet-level adapter key SHALL be the
`sha256:<64 lowercase hex>` digest of RFC 8785 canonical JSON containing exactly:

```text
{
  contract: "managed-memory-provider-v1",
  outbox_idempotency_key: <the authoritative outbox key>,
  method: <"ensure", "status", "configure", or "cleanup">,
  facet: <"personal_enabled", "coding_enabled", or null>
}
```

The request envelope's `idempotency_key` SHALL use `facet:null`. Each
facet-specific adapter action SHALL derive its child key from the same outbox
key, method, and exact enabled-field value. The adapter SHALL reject a derived
key mismatch and honor every key across retries; a child key delegates no
authority beyond its root outbox event.

`issue-private-session-route` SHALL additionally bind Session ID, attachment
version, lease capability generation, workload generation, enabled facets,
fixed audience `managed-agentic-memory`, and route expiry. Repeating the same
complete request SHALL return or reestablish only the same exact-Session route
set. A changed field SHALL use a different idempotency key and SHALL not widen
the old route set. Its idempotency preimage SHALL be the complete SPI envelope
with the `idempotency_key` member omitted, and its
`outbox_idempotency_key` SHALL be null because route issuance is not an outbox
operation.

#### Closed SPI response envelope

Every operation SHALL return exactly:

```text
{
  spi_version: "managed-memory-provider-v1",
  operation: <the request operation>,
  idempotency_key: <the request idempotency key>,
  outcome: <"succeeded" or "failed">,
  result: <the exact operation result or null>,
  failure: <ProviderFailure or null>
}
```

On success, `result` SHALL be non-null and `failure` null. On failure, `result`
SHALL be null and `failure` contain exactly:

```text
{
  code: <one stable allowlisted provider failure code>,
  message: <sanitized string of at most 512 UTF-8 bytes>,
  retryable: <Boolean fixed for the code>,
  retry_after: <UTC RFC 3339 timestamp or null>,
  enabled_field: <"personal_enabled", "coding_enabled", or null>
}
```

`retry_after` SHALL be non-null only for a retryable failure. `enabled_field`
SHALL be non-null only when the failure is isolated to that reviewed facet. A
facet state is the following exact closed object:

```text
{
  enabled_field: <"personal_enabled" or "coding_enabled">,
  bank_role: <the reviewed matching role>,
  state: <"provisioning", "ready", "failed", "draining", or "absent">,
  recorded_attachment_version: <positive integer or null>,
  recorded_generation: <positive integer or null>,
  configuration_complete: <Boolean>,
  failure: <ProviderFailure or null>
}
```

Every `facet_states` result SHALL contain exactly the two reviewed entries,
ordered `personal_enabled`, then `coding_enabled`. For `absent`, both recorded
values SHALL be null,
`configuration_complete` false, and `failure` null. For every other state both
recorded values SHALL be non-null. `configuration_complete` SHALL be true for
`ready` and `draining`, and false otherwise. `failure` SHALL be non-null exactly
for `failed`, and its `enabled_field` SHALL match the containing facet. Unknown
members, unknown enum values, invalid null combinations, and a response whose
operation or key does not match its request SHALL be rejected.

#### `ensure`

`ensure` SHALL verify or create the attachment-owned provider resource set under
the active registration. It SHALL NOT create a bank; only `configure` may do so
from the reviewed facet bindings. On success, `result` SHALL contain exactly:

```text
{
  resource_set_reference: <non-empty protected opaque string>,
  recorded_attachment_version: <the requested attachment version>,
  recorded_generation: <the requested desired generation>,
  facet_states: [<exactly two FacetState objects>]
}
```

#### `status`

`status` SHALL read only the exact attachment-owned set. It SHALL report
`provisioning`, `ready`, `failed`, or `absent` for each desired facet and SHALL
never list unrelated provider resources. A disabled resource recorded by ACP as
draining MAY be reported only for its exact prior attachment version. Any other
extra resource, mismatched template, or ambiguous match SHALL return a conflict
rather than a best-effort selection. On success, `result` SHALL contain exactly:

```text
{
  resource_set_reference: <non-empty protected opaque string or null>,
  recorded_attachment_version: <positive integer or null>,
  recorded_generation: <positive integer or null>,
  backend_health: <"ready", "degraded", or "unavailable">,
  private_route_capable: <Boolean>,
  facet_states: [<exactly two FacetState objects>]
}
```

If `resource_set_reference` is null, both top-level recorded values SHALL be null
and both facets absent. Otherwise both top-level recorded values SHALL be
non-null.

#### `configure`

`configure` SHALL reconcile exactly one bank per enabled facet for the current
desired generation, using only the reviewed bank template embedded for that
facet in the verified bundle. For each new or changed bank it SHALL complete
`configure-bank`, then `configure-mental-models`, then `allow-retain`. It SHALL
create or update no more than two deterministic facet resources. Removing a
facet from new desired state SHALL detach it from future routes but SHALL NOT
erase retained data or invalidate an older exact-Session route before the
platform lease permits.

On success, `configure.result` SHALL contain exactly:

```text
{
  resource_set_reference: <non-empty protected opaque string>,
  recorded_attachment_version: <the requested attachment version>,
  recorded_generation: <the requested desired generation>,
  facet_states: [<exactly two FacetState objects>]
}
```

#### `cleanup`

`cleanup` SHALL run only after ACP proves that no active lease may issue or
renew a route for the affected attachment version. It SHALL revoke provider
runtime authority and release live provider resources idempotently. Ordinary
cleanup SHALL NOT claim that retained user data was erased.

On success, `cleanup.result` SHALL contain exactly:

```text
{
  resource_set_reference: null,
  runtime_authority_revoked: true,
  runtime_resources_released: true,
  retained_data_erasure: "not-requested",
  facet_states: [<exactly two absent FacetState objects>]
}
```

#### `issue-private-session-route`

`issue-private-session-route` SHALL create one short-lived, nondelegable
provider route for the exact active Session lease. For each enabled facet, it SHALL
bind the reviewed role to exactly one single-bank provider endpoint; no endpoint
may address more than one bank. The returned adapter-private route material
SHALL be delivered only to the authenticated control plane, which SHALL pass it
directly to the API-owned private route ledger's `issue` operation. It SHALL be
absent from Runner and Agent environment, files, arguments, logs, prompts, tool
results, browser APIs, and public ACP APIs. Route renewal SHALL
require the same exact-Session service identity, lease, attachment version,
workload generation, audience, and enabled facets.

On success, `issue-private-session-route.result` SHALL contain exactly:

```text
{
  provider_route_material: <non-empty adapter-private byte string>,
  session_id: <the requested Session ID>,
  attachment_version: <the requested attachment version>,
  capability_generation: <the requested capability generation>,
  workload_generation: <the requested workload generation>,
  audience: "managed-agentic-memory",
  expires_at: <the requested UTC RFC 3339 timestamp>,
  enabled_facets: [<the requested ordered reviewed facet entries>]
}
```

The result SHALL contain no public endpoint, public provider resource identifier,
or bank selector. ACP SHALL treat the complete `provider_route_material` value
as secret plaintext and SHALL neither inspect nor persist it outside the single
API-ledger issue request.

### Requirement: Private Reconciliation-State Operation Family

The API server SHALL expose exactly one mutually authenticated private
reconciliation-state route:

```text
POST /internal/ambient/v1/managed-memory/reconciliation-state
```

The client identity SHALL be the `ambient-control-plane` ServiceAccount at exact
SPIFFE identity
`spiffe://<configured-trust-domain>/ns/<deployment-namespace>/sa/ambient-control-plane`.
The server identity SHALL be the configured `ambient-api-server` service SPIFFE
identity and DNS SAN. In addition to successful mutual TLS verification, every
request SHALL carry a short-lived component credential with audience
`managed-memory-reconciler` and purpose
`managed-memory-reconciliation-state`. The API server SHALL derive the caller
identity from the authenticated transport and credential; a request member
SHALL NOT select or override it.

Every request SHALL be a closed tagged union containing exactly
`contract: "managed-memory-reconciliation-state-v1"`, `action`,
`idempotency_key`, `selector`, and `input`. Every HTTP 200 response SHALL contain
exactly the same `contract`, `action`, and `idempotency_key`, plus `result`.
Unknown or duplicate members, an unknown action, an invalid selector, or an
action/result mismatch SHALL be rejected before state changes. The exact actions
and their closed selector, input, and result objects are:

<!-- markdownlint-disable MD013 -->

| Action | Exact `selector` | Exact `input` | Exact success `result` |
|---|---|---|---|
| `registration-resolve` | `{registration_generation,authority}` | `{adapter_id,bundle_reference,registration_handle}` | `{adapter_id,registration_generation,bundle_reference,configuration,credential,expires_at}` |
| `reference-seal` | `{attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{reference_kind,plaintext_reference}` | `{sealed_reference,reference_digest,expires_at}` |
| `reference-verify` | `{attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{reference_kind,sealed_reference}` | `{valid,reference_digest,expires_at}` |
| `resource-set-load` | `{resource_set_id,attachment_id,attachment_version,desired_generation,registration_generation}` | `{}` | `{resource_set}` |
| `resource-set-load-by-attachment` | `{attachment_id,attachment_version,desired_generation,registration_generation}` | `{}` | `{resource_set}` |
| `resource-set-put-if-absent` | `{attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{resource_set_write}` | `{created,resource_set}` |
| `resource-set-cas-save` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{expected_resource_version,fencing_token,resource_set_write}` | `{resource_set}` |
| `resource-set-fence` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{expected_resource_version,fencing_token}` | `{resource_set}` |
| `resource-set-delete` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{expected_resource_version,fencing_token,cleanup_receipt_id}` | `{deleted_resource_set_id,deleted_resource_version}` |
| `cleanup-receipt-put` | `{cleanup_receipt_id,resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{fencing_token,provider_receipt_digest,runtime_authority_revoked,runtime_resources_released,retained_data_erasure}` | `{cleanup_receipt_id,resource_version,recorded_at}` |
| `cleanup-receipt-load` | `{cleanup_receipt_id,resource_set_id,attachment_id,attachment_version,desired_generation,registration_generation}` | `{}` | `{cleanup_receipt_id,resource_version,provider_receipt_digest,runtime_authority_revoked,runtime_resources_released,retained_data_erasure,recorded_at}` |
| `fencing-lease-acquire` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{lease_duration_seconds}` | `{lease_id,fencing_token,expires_at}` |
| `fencing-lease-renew` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{lease_id,fencing_token,lease_duration_seconds}` | `{lease_id,fencing_token,expires_at}` |
| `fencing-lease-release` | `{resource_set_id,attachment_id,attachment_version,desired_generation,outbox_id,outbox_attempt,registration_generation}` | `{lease_id,fencing_token}` | `{lease_id,fencing_token,released_at}` |

<!-- markdownlint-enable MD013 -->

Every identifier is a non-empty opaque string; every version, generation,
attempt, and fencing token is a positive integer; every digest is
`sha256:<64 lowercase hex>`; every expiry or recorded time is a UTC RFC 3339
timestamp; `lease_duration_seconds` is the fixed value `30`;
`reference_kind` is exactly `registration-configuration`,
`registration-credential`, or `provider-resource-set`; and
`retained_data_erasure` is exactly `not-requested` for this family.
`bundle_reference` and the ordered facet state use their closed schemas in this
specification. `configuration` and `credential` are adapter-private byte strings
and `credential` MAY be null only when the registration's credential reference
is null. A `resource_set_write` contains exactly `sealed_provider_reference`,
`recorded_attachment_version`, `recorded_generation`, and `facet_states`. A
returned `resource_set` contains exactly those members plus API-assigned
`resource_set_id`, monotonically increasing `resource_version`, and
`last_fencing_token`, which is a positive integer or null before the first
successful fence.

The `registration-resolve` authority is a closed tagged union. Outbox work uses
exactly `{kind:"outbox",outbox_id,outbox_attempt,attachment_id,
attachment_version,desired_generation}`. Session route issuance uses exactly
`{kind:"session-route",session_id,attachment_id,attachment_version,
desired_generation,capability_generation,workload_generation}`. The API server
SHALL verify every member against live committed state and the registration
handle; neither variant grants authority to the other.

`registration-resolve` SHALL resolve only the exact active registration and
SHALL return plaintext configuration or credential bytes only in that one
authenticated control-plane response with `Cache-Control: no-store`. No other
action returns those bytes. The control plane MAY supply them only to the
selected in-process code-owned adapter for that call and SHALL discard them
before responding or retrying. `reference-seal` SHALL authenticate all selector
members as associated data and return deterministic ciphertext for the same
key version, plaintext, reference kind, and selector; `reference-verify` SHALL
authenticate those bindings without returning plaintext. The API server SHALL
own key selection, encryption, decryption, and ciphertext persistence.

Resource-set mutations SHALL run in API-owned PostgreSQL transactions. The API
server SHALL assign every `resource_set_id` and monotonically increasing
`resource_version`. `resource-set-put-if-absent` is idempotent for an identical
attachment, version, generation, and idempotency key; an existing non-identical
row returns HTTP 409. CAS save, fence, and delete SHALL require the current
resource version and a live matching fencing token. A stale resource version,
expired or lower fencing token, selector mismatch, or already-deleted row SHALL
return HTTP 409 without mutation. No result may disclose an unrelated row, and
there is no list, search, prefix, pagination, or arbitrary-query action.
`resource-set-fence` SHALL atomically record its token as
`last_fencing_token` and increment `resource_version`. The private
`resource_version` is the resourceVersion/CAS token for this contract: every
compare failure maps to HTTP 409 `MEMORY_RECONCILIATION_STATE_CONFLICT`, never a
best-effort overwrite.

Fencing tokens SHALL increase monotonically per resource set and SHALL never be
reused. Acquire, renew, and release SHALL be bound to the authenticated
control-plane instance, exact outbox row and attempt, registration, attachment,
version, and desired generation. A lease expires after 30 seconds without a
valid renewal; after expiry a later acquire receives a higher fencing token and
the crashed holder can no longer save, fence, delete, or record cleanup.
Cleanup receipt writes are put-once and identical-replay idempotent. Deletion
requires the exact receipt and is permitted only when that receipt proves
runtime authority revoked and runtime resources released.

All action idempotency keys SHALL be server-verifiable SHA-256 digests over the
RFC 8785 canonical request with `idempotency_key` omitted and the authenticated
caller identity included. An identical replay returns the prior result; reuse
for different bytes returns HTTP 409. Failures SHALL use only the stable
feature-scoped codes in this specification, redact all plaintext, ciphertext,
handles, adapter payloads, and provider identifiers, and SHALL NOT affect
process readiness or memory-disabled Sessions. The control plane SHALL never
connect to PostgreSQL or persist registration plaintext, provider-reference
plaintext, API encryption keys, resource-set rows, leases, or cleanup receipts.
Every non-success response SHALL contain exactly `contract`, `action`,
`idempotency_key`, `outcome: "failed"`, and the closed `ProviderFailure` object;
authentication failures MAY omit action and key when they were not safely
parsed. Responses SHALL contain no row-existence or selector-match oracle.

#### Scenario: A crashed reconciler is fenced from later state

- GIVEN control-plane instance A acquired fencing token N for one exact outbox
  attempt and then crashed
- WHEN its lease expires and instance B acquires the same resource set
- THEN instance B receives a fencing token greater than N
- AND every later CAS, delete, or receipt write using N returns HTTP 409
- AND the API server remains the only transaction and ciphertext authority

### Requirement: Private Exact-Session Route Ledger Operation Family

The API server SHALL expose exactly one mutually authenticated private route:

```text
POST /internal/ambient/v1/managed-memory/session-route
```

It SHALL require the same exact client and server mTLS identities as the
reconciliation-state family plus a short-lived component credential with
audience `managed-memory-reconciler` and purpose
`managed-memory-session-route`. Every request SHALL contain exactly
`contract: "managed-memory-session-route-v1"`, `action`, `idempotency_key`,
`selector`, and `input`. `action` SHALL be exactly `issue`, `resolve`, or
`release`. Every success response SHALL contain exactly the matching
`contract`, `action`, `idempotency_key`, and `result`; failures SHALL use the
same closed failure envelope as the reconciliation-state family. The closed
`selector` for every action SHALL contain exactly:

```text
{
  session_id: <opaque exact Session ID>,
  attachment_id: <opaque attachment ID>,
  attachment_version: <positive integer>,
  desired_generation: <positive integer>,
  capability_generation: <positive integer>,
  workload_generation: <positive integer>,
  audience: "managed-agentic-memory",
  caller_identity: <exact supervisor-private Session service SPIFFE ID>,
  resource_set_reference: <authenticated sealed reference>,
  resource_set_revision: <positive integer>,
  expires_at: <UTC RFC 3339 timestamp>
}
```

`issue.input` SHALL contain exactly `provider_route_material`, an
adapter-private byte string returned by the matching provider-SPI issuance.
`issue.result` SHALL contain exactly `route_handle`, the complete selector,
`route_revision`, and `state: "active"`. `resolve.input` SHALL contain exactly
`route_handle`; `resolve.result` SHALL contain exactly `route_handle`,
`provider_route_material`, `call_lease_id`, `call_lease_expires_at`, and the
complete selector. `release.input` SHALL contain exactly `route_handle` and
`reason`, where reason is `session-terminal`, `lease-revoked`,
`generation-superseded`, `attachment-draining`, or `expired`.
`release.result` SHALL contain exactly `route_handle`, `route_revision`,
`state: "released"`, `released_at`, and `drain_complete_at`.
`resource_set_revision` SHALL equal the current API-owned resource set's
`resource_version`; an older or future value is a conflict.

The API server SHALL serialize issue and release for the exact Session and
store a durable encrypted route ledger in its PostgreSQL database. The unique
ledger key SHALL be the complete selector; a different expiry,
attachment version, desired, capability, or workload generation, audience,
caller identity, resource-set reference, or resource-set revision is a distinct
route and SHALL NOT widen, renew, or replace the old one. The idempotency key
SHALL be the SHA-256 digest of RFC 8785 canonical action, selector, input digest,
and authenticated control-plane identity. Identical issue or release replays
return the prior result; key reuse for different input returns HTTP 409.

The route handle SHALL be a random opaque lookup capability bound to every
selector member and SHALL contain no plaintext credential, endpoint, provider
identifier, bank selector, attachment identifier, or self-describing claim.
Provider route material SHALL be plaintext only inside the authenticated issue
request and resolve response, SHALL be encrypted before the issue transaction
commits, and SHALL never be logged, included in errors, or persisted by the
control plane. Resolve SHALL require the live Session, exact caller identity,
all selector values, an active unexpired route, and the current resource-set
revision. It SHALL return `Cache-Control: no-store` and create a server-time
call lease of at most 30 seconds.

Release SHALL be terminal and monotonic. Once release begins, no new resolve is
accepted. The API server SHALL wait only for already-issued call leases to end
or expire, then atomically erase the encrypted provider route material and mark
the ledger released. A released or expired route can never become active again;
a later eligible generation requires a new selector and handle. A stale,
cross-Session, cross-generation, wrong-caller, wrong-audience, wrong-resource,
expired, or released resolve SHALL return HTTP 409 with no plaintext or
selector oracle.

These private families and the provider SPI SHALL be implemented only by
code-owned adapter registrations and the control plane's hand-written private
client. They SHALL be absent from public OpenAPI documents, generated public Go,
Python, and TypeScript SDKs, `acpctl`, browser-extension and UI APIs, MCP tools,
generic proxy routes, apply/sync schemas, and discovery documents. A route or
state-family failure SHALL disable or degrade only managed memory for the exact
attachment or Session; it SHALL NOT create a process-readiness dependency or
affect memory-disabled workloads.

#### Scenario: Route release drains without reopening authority

- GIVEN an active exact-Session route has one unexpired call lease
- WHEN the control plane releases the route
- THEN the API server rejects every new resolve immediately
- AND it erases encrypted route material after the existing call lease ends or
  reaches its 30-second expiry
- AND replaying issue for the released selector cannot reactivate that handle

### Requirement: Backend Health, Attachment Readiness, and Stable Failures

The adapter's `status` result SHALL expose the bounded internal backend-health
value for the exact active registration and verified template bundle. Health is
deployment state, not attachment readiness and not a browser- or
provider-supplied public claim.

Managed-memory adapter readiness is an optional feature gate, not process
readiness. Missing, ambiguous, disabled, or invalid registration sets the
feature gate unavailable with `MEMORY_BACKEND_REGISTRATION_INVALID`; invalid or
mismatched bundle bytes set it unavailable with
`MEMORY_TEMPLATE_BUNDLE_INVALID`. Neither condition SHALL change global
API-server or control-plane liveness/readiness while those processes' ordinary
dependencies remain healthy.

A preview, configuration, or retry that requests `personal_enabled:true` or
`coding_enabled:true` SHALL fail closed with the corresponding bounded code
while the feature gate is unavailable. It SHALL create or mutate no attachment,
outbox event, provider resource, Session, or lease. Memory-disabled preview,
Artoo Skip/provisioning/start, ordinary Agent and Session operations, and
existing memory-disabled Enterprise Sessions SHALL not consult this feature gate.

An attachment SHALL become publicly `ready` only when:

- the protected registration and template bundle validate;
- the attachment generation and version match desired state;
- exactly one deterministic provider resource exists for every enabled facet;
- no provider resource exists for a disabled facet in the active route set;
- `status` reports every enabled resource ready and correctly configured; and
- `status.result.private_route_capable` is true for the deployment's configured
  supervisor boundary.

An enabled attachment remains `provisioning` while an idempotent ensure or
configure operation is pending or while the provider reports a bounded pending
state. A terminal or exhausted provider failure moves it to `failed`. A ready
attachment whose backend later becomes unavailable SHALL not authorize a new
Session until health and exact status are revalidated.

#### Scenario: Invalid registration is isolated to managed memory

- GIVEN the API server and control plane satisfy their ordinary process
  readiness dependencies
- AND the managed-memory registration is missing, ambiguous, disabled, or
  invalid
- WHEN readiness and Enterprise Assistant operations are evaluated
- THEN global API-server and control-plane readiness remain healthy
- AND managed-memory adapter readiness is unavailable with
  `MEMORY_BACKEND_REGISTRATION_INVALID`
- AND a memory-enabled preview or configuration fails before mutation
- AND memoryless Artoo and ordinary Sessions remain available

#### Scenario: Invalid bundle does not take the platform down

- GIVEN the API server and control plane satisfy their ordinary process
  readiness dependencies
- AND the configured managed-memory bundle fails profile, schema, revision,
  byte, or digest verification
- WHEN readiness and Enterprise Assistant operations are evaluated
- THEN global API-server and control-plane readiness remain healthy
- AND managed-memory adapter readiness is unavailable with
  `MEMORY_TEMPLATE_BUNDLE_INVALID`
- AND a memory-enabled preview or configuration fails before mutation
- AND memory-disabled preview, Artoo, and ordinary Sessions remain available

Provider and transport failures SHALL map to only these stable internal codes:

<!-- markdownlint-disable MD013 -->

| Code | Retryable | Meaning |
|---|---|---|
| `MEMORY_BACKEND_UNAVAILABLE` | true | Registered adapter or endpoint is temporarily unreachable |
| `MEMORY_BACKEND_REGISTRATION_INVALID` | false | Registration is absent, ambiguous, disabled, or untrusted |
| `MEMORY_TEMPLATE_BUNDLE_INVALID` | false | Bundle bytes, profile, digest, schema, revision, or facet mapping is invalid |
| `MEMORY_PROVIDER_PENDING` | true | Provider accepted desired state but is not ready |
| `MEMORY_PROVIDER_CONFLICT` | false | Deterministic provider resources are foreign, duplicate, or mismatched |
| `MEMORY_PROVIDER_STALE_GENERATION` | false | Requested attachment version or desired generation is older than recorded state |
| `MEMORY_PROVIDER_REJECTED` | false | Provider rejected reviewed desired configuration |
| `MEMORY_PROVIDER_RATE_LIMITED` | true | Provider requested bounded backoff |
| `MEMORY_PRIVATE_ROUTE_UNAVAILABLE` | true | Exact-Session private route cannot currently be issued |
| `MEMORY_PRIVATE_ROUTE_INVALID` | false | Route selector, caller, audience, generation, reference, revision, or handle does not match |
| `MEMORY_PRIVATE_ROUTE_RELEASED` | false | The exact route is expired, releasing, or terminally released |
| `MEMORY_RECONCILIATION_STATE_CONFLICT` | false | Resource version, selector, cleanup receipt, or idempotency binding conflicts |
| `MEMORY_RECONCILIATION_LEASE_LOST` | true | The crash-expiring fencing lease is absent, expired, superseded, or owned by another instance |
| `MEMORY_PROVIDER_INTERNAL` | true | Sanitized unclassified provider failure |

<!-- markdownlint-enable MD013 -->

The API server SHALL persist only the stable code, a sanitized message of at
most 512 UTF-8 bytes, retryability, and an optional bounded retry time under the
managed-memory failure contract. Raw upstream status, body, endpoint,
identifier, stack, credential, or user content SHALL never be persisted or
returned. Retries SHALL follow the outbox lease contract and SHALL not create a
second attachment, resource set, facet resource, or Session route.

### Requirement: Private Exact-Session MCP Surface

The supervisor-private proxy SHALL expose exactly one MCP server named
`managed-memory` and exactly three tools named `retain`, `recall`, and `reflect`.
Before every call, the control-plane private proxy SHALL use the private
route-ledger `resolve` action with the exact Session, caller identity,
attachment version, desired, capability, and workload generations, audience,
expiry, and resource-set reference and revision. It SHALL discard the resolved
provider route material when that call ends and SHALL NOT reuse it beyond the
returned call-lease expiry. A failed resolve fails that call closed without
invoking the provider.
Tool arguments SHALL NOT accept identity, facet, bank, provider, resource,
routing, credential, or template selectors.

All tool input objects SHALL reject unknown members and nulls.
For each call, the proxy SHALL invoke every enabled single-bank binding in
reviewed facet order. A partial upstream failure SHALL fail the whole call with
a bounded error; the proxy SHALL NOT silently omit a bank or expose which bank
failed.

The following schemas are the provider-independent ACP proxy contract. An
adapter MAY translate them to its private upstream protocol but SHALL NOT widen
the model-visible surface.

#### `retain`

Input SHALL contain exactly string `kind` and string `content`. `kind` SHALL be
one of `preference`, `decision`, `commitment`, `fact`, or `pattern`.
`content` SHALL contain 1 through 16,384 UTF-8 bytes after valid-Unicode
validation. The proxy SHALL set the stable internal document ID to the exact ACP
Session ID and SHALL supply that exact value to the bound endpoint as
`document_id`; the ID SHALL NOT be a tool argument and the model cannot override
it.

For ACP proxy data-plane contract v1, every distinct retain invocation SHALL be
a provider append operation with conflict behavior `on_conflict:append`. This
does not add an operation to the closed control-plane provider SPI. The adapter
SHALL map the logical append to its private upstream protocol; replacement or
ordinary upsert of the Session document is non-conformant. The proxy SHALL
assign each distinct retain invocation a durable monotonically increasing
position in the exact Session's retain queue. The adapter SHALL preserve that
order within each enabled bank.

The adapter SHALL deduplicate atomically by trusted MCP invocation ID within the
exact attachment version, bank role, and document ID. Repeating the same
invocation ID with the same kind and content SHALL return its prior result
without appending again. Reusing it with different kind or content SHALL fail
closed. If one bank accepted a call before another bank failed, retry SHALL
append only where that invocation ID has not already been accepted. An
incomplete queue head SHALL durably block every later distinct retain from
appending to any bank until the head succeeds on every enabled bank. A blocked
call SHALL retain its durable queue position and invocation mapping but return a
bounded retryable failure without appending to or otherwise mutating any bank.
The queue MAY be discarded only when the exact Session becomes terminal or its
lease is revoked; it SHALL NOT skip a failed head and reorder retained content.

Output SHALL contain exactly `document_id` and `stored`. `document_id` SHALL be
the exact ACP Session ID supplied by the proxy and SHALL reveal no provider
identifier. `stored` SHALL be true only after every enabled binding accepts the
idempotent retain. No raw provider response or resource metadata is returned.

#### Scenario: Ordered distinct retains survive duplicate delivery

- GIVEN one Session has a ready managed-memory route with one or two enabled
  single-bank bindings
- WHEN distinct retain invocation A appends to the first bank but transiently
  fails before appending to the second bank
- AND distinct invocation B arrives before A completes
- THEN B returns a retryable failure and appends to neither bank
- WHEN A is retried and completes, followed by a retry of B
- AND B is delivered again with the same trusted invocation ID, kind, and
  content
- THEN every enabled bank has one document whose ID is the exact ACP Session ID
- AND that document contains A followed by B
- AND A was not replaced and B was appended exactly once

#### `recall`

Input SHALL contain exactly string `query`, integer `max_results`, and integer
`max_total_bytes`. `query` SHALL contain 1 through 4,096 UTF-8 bytes.
`max_results` SHALL be 1 through 10, and `max_total_bytes` SHALL be 1 through
32,768.

Output SHALL contain exactly one `documents` array. Each entry SHALL contain
exactly string `document_id`, string `kind`, string `content`, and numeric
`relevance` from zero through one. Results SHALL be deterministically ordered by
descending relevance, document ID, and SHA-256 of content, limited by both
requested bounds and an absolute 32,768-byte serialized-output limit. A tie
SHALL not depend on provider order.

#### `reflect`

Input SHALL contain exactly string `topic`, integer `max_total_bytes`, and
Boolean `refresh`. `topic` SHALL contain 1 through 2,048 UTF-8 bytes.
`max_total_bytes` SHALL be 1 through 16,384. `refresh:true` MAY request
recomputation only through the exact Session's enabled bindings; it does not
select a model, bank, template, provider resource, or another attachment.

Output SHALL contain exactly string `summary` and string-array `document_ids`.
The serialized output SHALL not exceed the requested bound or 16,384 bytes,
whichever is lower. The proxy SHALL combine per-bank summaries in reviewed facet
order without exposing bank labels. Document IDs SHALL follow the stable format
above, be deduplicated, and be ordered lexicographically. Every returned
document ID SHALL be an ACP Session ID previously supplied server-side, never a
provider-selected value.

No other tool is exposed. Results SHALL not contain hidden provider identifiers
or reveal whether a forbidden target exists.

### Requirement: Disable, Drain, Cleanup, and Explicit Data Deletion

Disabling a facet SHALL prevent that facet from appearing in future Session
leases and routes as soon as the conditional desired-state transaction commits.
Existing exact-Session routes MAY continue only under their unchanged leases.
The adapter SHALL not run `cleanup` for an attachment version until every
matching lease is terminal, expired, or revoked.

Ordinary drain and cleanup revoke runtime authority and release live provider
resources. They SHALL NOT assert that provider-retained user data was erased.
Data deletion SHALL be a separate explicit owner-authorized workflow. Any future
administrator form SHALL extend the canonical Enterprise Assistant repair
endpoint and closed action allowlist rather than create a second break-glass
surface, and SHALL define its own confirmation, scope, retention result, and
evidence contract. The three MCP tools SHALL never invoke that workflow. This
specification does not add a public deletion endpoint or current repair action;
until one is separately specified and implemented, user-facing copy SHALL not
promise erasure.

#### Scenario: Disable preserves active exact leases only

- GIVEN one live Session lease references a facet resource
- WHEN the owner disables that facet
- THEN no later lease or route contains it
- AND the old route remains usable only until its exact lease ends or is revoked
- AND cleanup waits for that lease without granting it to another Session

### Requirement: API-Server to Control-Plane Outbox Protocol

The API server SHALL own managed-memory persistence and transactional outbox
mutation. The control plane SHALL remain the sole managed-memory reconciler and
the sole provider SPI caller. The control plane SHALL NOT connect directly to
the API server's PostgreSQL database. No API-server background worker SHALL call
the provider adapter. The control plane SHALL load and mutate provider resource
sets, cleanup receipts, and fencing leases only through the private
reconciliation-state family and SHALL issue, resolve, or release Session routes
only through the private route-ledger family.

Outbox operations SHALL map to SPI calls exactly as follows:

- `reconcile` calls `ensure`, then `configure`, then `status` for the same
  attachment and desired generation;
- `detach` calls `configure` with the current enabled-facet subset and then
  `status`, while preserving any exact prior resource whose lease is draining;
  and
- `garbage-collect` calls `cleanup` only after the API server proves that no
  active matching lease remains, then calls `status` to verify that no live
  route or runtime resource remains.

`issue-private-session-route` is a synchronous Session-provisioning SPI call and
is never represented as an outbox operation.

The API server SHALL expose these service-authenticated internal operations:

```text
POST /internal/ambient/v1/managed-memory/outbox/claim
POST /internal/ambient/v1/managed-memory/outbox/{id}/heartbeat
POST /internal/ambient/v1/managed-memory/outbox/{id}/ack
```

They SHALL require the exact `ambient-control-plane` client and
`ambient-api-server` server identities defined for the private
reconciliation-state family, plus a short-lived control-plane credential with
audience `managed-memory-reconciler` and purpose `managed-memory-outbox`.
Human tokens, Session runtime credentials, generic service tokens, Project
RBAC, and public SDK credentials SHALL be rejected. The authenticated
control-plane instance identity, not a request field, owns the lease.

#### Claim

Claim request body SHALL be exactly `{}`. In one database transaction, the API
server SHALL select at most one earliest available non-superseded pending event
using a concurrency-safe skip-locked claim, increment attempts, set state to
`processing`, set `locked_at` to server time, and bind the current attempt to the
authenticated control-plane instance. The fixed lease duration SHALL be 30
seconds. An event is claimable again only after `locked_at + 30 seconds` when no
valid heartbeat or acknowledgement renewed it.

When no event is available, claim SHALL return HTTP 204. Success SHALL return
HTTP 200 and exactly:

```text
{
  id: <outbox id>,
  attachment_id: <opaque internal id>,
  attachment_version: <positive integer>,
  desired_generation: <positive integer>,
  operation: <"reconcile", "detach", or "garbage-collect">,
  idempotency_key: <sha256 digest>,
  adapter_id: <allowlisted adapter id>,
  registration_handle: <short-lived sealed registration handle>,
  registration_generation: <positive integer>,
  bundle_reference: <the active registration's exact closed bundle reference>,
  enabled_facets: [<ordered reviewed enabled-field and bank-role entries>],
  draining_facets: [<ordered reviewed enabled-field and bank-role entries>],
  attempt: <positive integer>,
  lease_token: <short-lived opaque signed token>,
  lease_expires_at: <UTC RFC 3339 timestamp>
}
```

The returned `idempotency_key` is the sole authority root for every SPI call and
facet action caused by this claimed event. The control plane SHALL pass it
unchanged as `outbox_idempotency_key` and derive all narrower keys by the SPI
rule above.

The lease token SHALL bind every returned identity and generation field, the
authoritative `idempotency_key`, authenticated control-plane instance, attempt,
audience, purpose, issue time, and expiry. It SHALL not authorize provider
operations by itself and SHALL be redacted from logs and errors.

`registration_handle` SHALL bind the same control-plane identity, outbox row,
attempt, adapter, registration generation, and expiry. It MAY allow the adapter
to resolve the protected configuration and credential references through a
platform secret boundary, but SHALL reveal neither reference nor secret to the
outbox response consumer, logs, or errors. It SHALL not authorize another
attachment, operation, Session route, or provider resource.

#### Heartbeat

Heartbeat request SHALL contain exactly non-empty string `lease_token`. A valid
heartbeat for the same authenticated control-plane instance, outbox row,
attempt, and non-superseded desired generation SHALL atomically set `locked_at`
to server time and return HTTP 204. It SHALL not increment attempts or mutate an
attachment. An expired, replayed, wrong-worker, completed, or superseded lease
SHALL return HTTP 409 with no state change.

The control plane SHALL heartbeat before half the 30-second lease elapses while
one provider operation is in flight. It SHALL stop heartbeating after success,
failure, cancellation, or loss of lease.

#### Acknowledgement

Acknowledgement request SHALL contain exactly `lease_token`, `outcome`,
`provider_result`, and `failure`. `outcome` SHALL be `succeeded`,
`retryable-failure`, or `terminal-failure`. For success, `provider_result` SHALL
contain exactly `resource_set_reference`, `recorded_attachment_version`,
`recorded_generation`, `backend_health`, `private_route_capable`, and
`facet_states`, using the exact types and nullability of `status.result`. The
reference and both recorded values SHALL be non-null for `reconcile` and
`detach`, and null only after successful `garbage-collect` verification.
`facet_states` SHALL use the exact two-entry closed FacetState schema. For
success, `failure` SHALL be null. For failure, `provider_result` SHALL be null
and `failure` SHALL use the exact closed ProviderFailure schema; its
`retryable` value SHALL match the acknowledgement outcome.

The acknowledged `resource_set_reference` SHALL be the authenticated sealed
reference produced by `reference-seal`; plaintext is invalid. The API server
SHALL validate the lease, generation, and sealed-reference bindings and
atomically update the attachment and outbox row. It SHALL never log the
acknowledgement body. Success marks the event
completed and advances attachment state only when the SPI result matches the
exact desired generation. Terminal failure marks the event failed and the
attachment failed. Retryable failure sets the event back to pending with
`available_at` after `min(2^attempt, 300)` seconds. A safe provider retry hint
MAY increase that delay but SHALL be capped at 900 seconds. After eight failed
attempts the event and attachment SHALL move to terminal failure rather than
retry indefinitely.

An acknowledgement for an expired, wrong-worker, stale, superseded, or already
completed attempt SHALL return HTTP 409 and SHALL NOT alter current attachment
state. Repeating a proven identical successful acknowledgement MAY return HTTP
204 without another mutation.

#### Scenario: Control-plane crash does not create another orchestrator

- GIVEN the control plane claimed an outbox event and crashed before ack
- WHEN its lease expires
- THEN the API server makes the same event claimable without calling the provider
- AND another control-plane instance reconciles it using the same idempotency key
- AND the API server remains persistence and lease authority, not a provider
  reconciler

#### Scenario: Superseded desired state wins

- GIVEN an older desired generation is processing when a newer generation commits
- WHEN the old worker heartbeats or acknowledges
- THEN the API server rejects the stale lease without changing the newer state
- AND only the newest non-superseded event is claimable
- AND provider cleanup for obsolete resources remains an explicit ordered outbox
  operation rather than an implicit stale acknowledgement side effect

### Requirement: Conformance and Failure-Safety Verification

Contract tests SHALL run against the adapter SPI, all three private API
operation families, and a deterministic fake backend. They SHALL prove:

- exact profile, schema, revision, bundle-byte, and digest verification;
- missing or invalid registration and bundle failures that disable only
  managed-memory readiness, reject memory-enabled preview/configuration before
  mutation, and leave global process readiness, Artoo, and ordinary Sessions
  healthy;
- one registration and two-facet cardinality limits;
- reviewed `personal_enabled` to `personal` and `coding_enabled` to `coding`
  mappings;
- per-bank configuration ordering and server-side single-bank route binding;
- deterministic per-facet resource keys and foreign-resource conflict handling;
- verified later-generation advancement of the same matching attachment
  resources, with stale lower generations rejected without replacement;
- one authoritative outbox key with deterministic method and facet child-key
  derivation across retries and lost acknowledgements;
- duplicate ensure, configure, cleanup, route, outbox delivery, and lost-ack
  convergence;
- stale generation, stale attachment version, wrong worker, expired lease,
  heartbeat, and acknowledgement rejection;
- registration resolution and deterministic authenticated reference sealing
  without plaintext persistence or redaction failure;
- exact resource-set load, attachment load, put-if-absent, CAS save, fence,
  cleanup receipt, and delete behavior with HTTP 409 conflict mapping and no
  generic list path;
- crash expiry followed by a strictly higher fencing token, with the stale
  holder unable to write;
- exact-Session route issue, resolve call lease, terminal release, drain, and
  cross-caller, cross-generation, cross-revision, and expired-handle rejection;
- absence of every private family from public OpenAPI, generated public SDKs,
  CLI, browser, MCP, apply/sync, discovery, and generic proxy surfaces;
- bounded health and failure mapping without provider or user-content leakage;
- exact closed success and failure DTO members, facet ordering, nullability, and
  request-key correlation for all five SPI operations;
- exact-session route isolation, expiry, renewal, and terminal cleanup;
- selector-free proxy fanout across every enabled facet in reviewed order;
- stable ACP Session ID document binding plus strict retain, recall, and reflect
  schemas and output bounds;
- a partial first retain blocking the second until ordered recovery in every
  enabled bank, with duplicate delivery of the second producing no second
  append;
- absence of selector, list, admin, delete, and bank-management tools; and
- disable/drain behavior that is distinct from explicit data deletion.

No conformance fixture, log, error, public DTO, browser evidence, or retained
artifact SHALL contain a live endpoint, Credential, provider reference, route
handle, capability token, attachment ID, or retained user memory.
