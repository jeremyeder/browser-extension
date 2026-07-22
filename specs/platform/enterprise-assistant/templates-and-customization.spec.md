# Enterprise Assistant Templates and Customization Specification

## Purpose

This specification defines the authoritative Artoo starter template, bounded
Enterprise Assistant customization, server-owned setup modes, immutable
template content, and managed Vertex AI inference entitlement. An Enterprise
Agent remains an ordinary ACP Agent. Its template and setup mode do not
introduce another Agent type or orchestrator.

## Requirements

### Requirement: Authoritative Artoo Starter Template

The deployment SHALL embed one closed allowlisted Artoo bundle registry that
retains every supported immutable revision and marks exactly one revision as
the active default. The initial active bundle SHALL have:

- string `schema_version` value `"1"`;
- initial string `revision` value `"1"`;
- `template_key` value `ambient-code/enterprise-agent/artoo`;
- reserved Agent name `enterprise-agent`;
- default display name `Artoo`;
- runtime `gemini-cli`;
- model `gemini-3.5-flash`;
- managed provider name `enterprise-agent-default`;
- managed provider type `vertex`; and
- structured customization only.

Each registry entry SHALL bind revision, template digest, embedded bundle path,
and Boolean active state. The registry SHALL reject duplicate revisions, zero
or multiple active entries, missing historical bytes, and digest mismatch. Each
bundle SHALL contain the exact platform policy, platform-owned memoryless
persona template, lower-priority user-instruction template, customization
schema, prompt contract, starter setup mode, disabled managed-memory setting,
and Agent runtime, model, and provider metadata needed to render and start
Artoo. Runtime operations SHALL read only the verified embedded registry and
selected bytes, never an external template repository.

The normalized default customization SHALL have this exact shape:

```json
{
  "display_name": "Artoo",
  "custom_instructions": "",
  "dispositions": {
    "empathy": 4,
    "skepticism": 2,
    "literalism": 2
  }
}
```

#### Scenario: Starter provisioning uses reviewed defaults

- GIVEN an eligible user requests starter setup
- WHEN the server previews or provisions the Enterprise Agent
- THEN the effective customization equals the normalized Artoo defaults
- AND Agent name is `enterprise-agent` and display name is `Artoo`
- AND runtime is `gemini-cli` and model is `gemini-3.5-flash`
- AND the Platform Provider list is exactly
  `["enterprise-agent-default"]`
- AND that Provider has exact type `vertex`
- AND provisioning creates no Session or workload
- AND starter setup has no managed agentic-memory attachment
- AND starter instructions contain no recalled context, mental model,
  memory-tool instruction, or claim that agentic memory is configured

### Requirement: Closed Customization Schema

The bundle's `customization_schema` SHALL be the canonical JSON Schema Draft
2020-12 schema for customization. It SHALL define a closed object containing
required `display_name`, `custom_instructions`, and `dispositions` members.
`dispositions` SHALL be a closed object containing required integer `empathy`,
`skepticism`, and `literalism` members. Both objects SHALL set
`additionalProperties:false`.

This embedded schema SHALL describe the complete normalized customization
returned to clients and used to render UI. It SHALL NOT be used directly as
the raw preview or provisioning request schema. The lifecycle API SHALL own a
separate closed partial-input schema that accepts `{}` or omitted members as
requests for defaults, then produces an object conforming to this required
normalized-output schema.

`display_name` SHALL contain 1 through 32 Unicode code points after
normalization and SHALL contain no C0 or C1 control code point, including CR,
LF, or tab. `custom_instructions` SHALL contain at most 2,000 Unicode code
points, MAY be empty, and SHALL remain subordinate to platform policy. Each
disposition SHALL be an integer from 1 through 5. Input members MAY be omitted
only to request their documented defaults. Nulls, unknown members, and
non-I-JSON input SHALL be rejected.

Managed agentic-memory choices SHALL be validated and persisted as the
separate `memory_configuration` contract. Memory SHALL NOT be a customization
schema member, persona default, prompt placeholder, template digest input, or
customization digest input.

#### Scenario: Unbounded or forbidden input is rejected

- GIVEN customization contains an unknown member, null, wrong type,
  replacement policy, replacement template, runtime or model selector,
  provider selector, credential, detected secret, over-limit value,
  non-integer disposition, or out-of-range disposition
- WHEN the server validates the request
- THEN the server returns HTTP 422
- AND it performs no write, Session start, workload creation, or model call

### Requirement: Deterministic Normalization and Canonicalization

The server SHALL execute customization processing in this exact order:

1. Decode JSON while rejecting duplicate member names, non-I-JSON strings or
   numbers, unknown members, nulls, and invalid types.
2. Merge omitted members over the reviewed Artoo defaults.
3. Normalize `display_name` and `custom_instructions` to Unicode NFC.
4. Remove only Unicode White_Space code points `0009-000D`, `0020`, `0085`,
   `00A0`, `1680`, `2000-200A`, `2028`, `2029`, `202F`, `205F`, and `3000`
   from both edges of `display_name`. Preserve its internal whitespace and all
   edge and internal whitespace in `custom_instructions`.
5. Enforce post-normalization code-point limits, reject every C0 or C1 control
   in `display_name`, and enforce disposition ranges.
6. Apply the deployment's server-side secret detector to both normalized
   strings. Every replica in one deployment SHALL use the same detector
   revision. Browser detection remains advisory and is never authoritative.
7. Produce the complete normalized three-member customization object.
8. Apply RFC 8785 JSON Canonicalization Scheme and SHA-256 to produce the
   `sha256:<64 lowercase hex>` customization digest.

Secret-detector matches SHALL reject the request before canonicalization and
shall not become digest inputs. Canonicalization SHALL preserve normalized
strings and exact integer values. Implementations SHALL share conformance
vectors covering decomposed Unicode, every trimmed code point, code-point
limits, member-order differences, nulls, unknown members, and integer bounds.

#### Scenario: Equivalent inputs have one digest

- GIVEN semantically equivalent valid customization inputs
- WHEN each server performs the ordered processing contract
- THEN each produces the same normalized object
- AND each produces the same canonical bytes
- AND each produces the same customization digest

### Requirement: Separated System and User-Instruction Rendering

The bundle's `prompt_contract` SHALL contain exactly:

```json
{
  "renderer": "literal-replacement-v1",
  "system_prompt_placement": "gemini-system-prompt",
  "system_prompt_separator": "\n---\n\n",
  "user_instruction_placement": "session-user-instruction-context",
  "allowed_user_placeholders": [
    "display_name",
    "empathy",
    "skepticism",
    "literalism",
    "custom_instructions"
  ]
}
```

The platform-owned `instruction_template` SHALL contain no runtime
placeholders. Its Agent identity and directives SHALL come only from verified
bundle bytes. User-controlled display name, dispositions, and custom
instructions SHALL NOT alter that template or the system-prompt bytes.

`literal-replacement-v1` SHALL validate the separate
`user_instruction_template`, reject every placeholder outside the ordered
allowlist, require every allowlisted placeholder, and replace every exact
`{{placeholder_name}}` occurrence in one pass over the original template.
Integers SHALL use base-10 ASCII without leading zeroes. Strings SHALL be
inserted literally with no HTML escaping, recursive expansion, trimming, or
other transformation. Unmatched, malformed, nested, or triple-brace delimiters
SHALL be rejected.

The exact template-owned standing instructions SHALL be the UTF-8 bytes of:

```text
platform_policy + "\n---\n\n" + instruction_template
```

Both embedded system source strings SHALL end in one LF. The separator is
additional and exact. The server SHALL persist those immutable bytes as the
template-owned Agent system prompt. Agent Start SHALL snapshot and supply them
through Gemini CLI's privileged system-prompt input.

The rendered `user_instruction_template` bytes SHALL be persisted separately
from the system prompt as the normalized customization context. Agent Start
SHALL snapshot that exact context into a lower-priority
`session-user-instruction-context` field and SHALL NOT concatenate it into,
prepend it to, or otherwise alter the system bytes. Browser state, environment
variables, model tools, and user messages SHALL never become alternative
system-prompt sources.

#### Scenario: Rendering is byte reproducible

- GIVEN the same verified registry entry, bundle, and normalized customization
- WHEN two conforming servers render Artoo
- THEN they produce identical immutable platform system bytes
- AND customization changes never alter those system bytes
- AND they replace only the five allowlisted user-context placeholders
- AND they produce byte-identical lower-priority user-instruction context
- AND platform policy and platform-owned persona remain the only Artoo content
  at the Gemini system-prompt boundary

### Requirement: Server-Authoritative Setup Mode

The exact `enterprise_assistant_configs.setup_mode` field SHALL be the single
persisted authority for `starter` or `customized`. The reserved
`ambient-code.io/enterprise-agent/setup-mode` Agent annotation SHALL be a
validated projection of that field, mirrored atomically in the provisioning
transaction and never an independent source. Reads SHALL fail closed on a
missing or mismatched projection. Only Enterprise Assistant provisioning may
write the authoritative field and projection. Generic Agent create, patch,
declarative apply, and Application sync SHALL reject attempts to create, alter,
or remove the reserved annotation.

`starter` identifies the exact Artoo defaults provisioned through the starter
flow. Successful full-onboarding confirmation SHALL reconcile the same Agent
and set `customized`, including when confirmed customization equals defaults.
Setup mode describes completed workflow provenance only. Clients SHALL NOT
infer it from presentation, prompt text, digests, memory state, or local
storage.

#### Scenario: Customization preserves one Agent identity

- GIVEN the canonical user owns an Enterprise Agent in `starter` mode
- WHEN the user completes Enterprise Assistant onboarding
- THEN the server reconciles the same Agent ID in its existing Project
- AND it sets setup mode to `customized`
- AND it does not create, replace, rename, or clone an Agent
- AND existing Sessions remain unchanged

#### Scenario: Stale starter intent never downgrades customized state

- GIVEN the current Enterprise Agent is already `customized`
- WHEN a client reads current state, previews starter desired state, or submits
  a starter provisioning PUT
- THEN current-state GET continues to expose the customized state
- AND preview remains non-authoritative desired-state computation only
- AND PUT rejects the downgrade under the conditional provisioning contract
- AND no Agent, Session, workload, or memory attachment is created or changed

### Requirement: Immutable Template Bytes and Digests

Generated `bundle.json` SHALL contain exactly `schema_version`, `revision`,
`template_key`, `agent`, `setup_mode`, `managed_memory`, `prompt_contract`,
`customization_schema`, `persona_defaults`, `platform_policy`,
`instruction_template`, and `user_instruction_template`.

`agent` SHALL contain exactly `name`, `default_display_name`, `runner_type`,
`llm_model`, `provider_name`, and `provider_type`. `managed_memory` SHALL
contain exactly Boolean `enabled:false`. `prompt_contract` SHALL have the exact
shape above. `persona_defaults` SHALL contain exactly `display_name`,
`dispositions`, `directives`, and `custom_instructions`. The bundle SHALL
reject unknown members at every object level.

Generated `registry.json` SHALL contain exactly string `schema_version:"1"`
and non-empty array `revisions`. Each revision entry SHALL contain exactly
string `revision`, `sha256:<64 lowercase hex>` `template_digest`, relative
`v<revision>/bundle.json` `bundle_path`, and Boolean `active`. Revisions SHALL
be unique positive decimal strings, every path and digest SHALL match retained
embedded bytes, and exactly one entry SHALL be active.

The template digest SHALL be SHA-256 over exact generated UTF-8 `bundle.json`
bytes, including serialization whitespace and final LF. ACP API and annotation
values SHALL use `sha256:<64 lowercase hex>`. A source checksum file MAY use
conventional checksum syntax, but ACP SHALL vendor and verify exact bundle
bytes rather than a source path or checksum-file representation.

The initial allowlisted Artoo revision `"1"` SHALL have exact compiled template
digest
`sha256:0014ddedf3b60576e5e32cc640759c332eb27bbf84e72fad4121fc13caae0def`.
The server SHALL compile that expected digest independently from the embedded
bundle bytes and SHALL require the compiled value, embedded-byte digest,
bundle revision, and bundle content to match before reporting readiness or
serving current-state GET, preview, provisioning, reconciliation, or Agent
Start.

The embedded registry SHALL retain prior allowlisted revision bytes and SHALL
mark exactly one verified revision as the active default. Generated revisions
SHALL be append-only. Generation SHALL write to
`bundles/artoo/v<revision>/` and SHALL refuse to replace different bytes or a
different checksum at an existing revision. Any content change SHALL increment
string `revision` and produce a new digest. A schema-shape change SHALL also
increment string `schema_version`. Prior revision bytes SHALL remain available
for validation and controlled upgrade. Generation SHALL verify every existing
registry digest before adding a revision and SHALL refuse to rewrite a recorded
digest to bless changed historical bytes.

Template digest and customization digest SHALL remain independent. Setup mode
and managed agentic-memory state SHALL alter neither digest. State and preview
digests that authorize or compare an effective Enterprise Agent SHALL include
setup mode, memory state, template digest, and customization digest.

#### Scenario: Embedded bytes fail closed on tampering

- GIVEN ACP embeds exact bundle bytes and an independently generated expected
  template digest
- WHEN startup verification finds a byte, digest, checksum, schema, revision,
  key-set, renderer, model, provider, or memoryless-contract mismatch
- THEN the affected server fails readiness
- AND current-state GET, preview, provisioning, reconciliation, and Agent Start
  fail with an unavailable result without mutation or workload creation
- AND the server never trusts a digest recomputed from unverified bytes
- AND it never falls back to a repository, ConfigMap, browser asset, network
  location, or user-controlled file

#### Scenario: Source relocation preserves runtime identity

- GIVEN the declarative source and generator move into the ACP repository
- WHEN exact generated bundle bytes remain unchanged
- THEN the template digest and runtime behavior remain unchanged
- AND the relocation removes the prior authoring writer in the same change
- AND no runtime source switch, second orchestrator, or dual authority exists

#### Scenario: Template upgrade preserves generated identity

- GIVEN a newer allowlisted Artoo revision retains its template key
- AND current Project and Agent annotations contain one known prior allowlisted
  template digest with complete canonical ownership and provenance
- WHEN conditional provisioning upgrades the Enterprise Agent
- THEN one transaction updates template-owned Agent content and both the
  Project and Agent template-digest annotations to the new digest
- AND Agent ID, Agent name, Project ID, owner binding, and provider entitlement
  remain unchanged
- AND existing Sessions retain snapshotted content and runtime context
- AND an unknown, partial, or tampered prior digest remains a conflict requiring
  audited administrative repair

### Requirement: Managed Vertex Inference Entitlement

The deployment SHALL maintain the protected singleton
`managed_credential_designations` row whose `logical_name` is
`enterprise-agent-default`, whose `credential_id` resolves to exactly one
active administrator-managed Credential with exact provider `vertex`, and
whose unsigned `generation` is greater than zero. That designation is distinct
from the selected global Credential, the Project-scoped Platform Provider, and
the OpenShell Provider instance projected at runtime. Credential name, labels,
annotations, creation order, and generic list results are non-authoritative.
An absent row, null Credential, invalid generation, deleted or revoked
Credential, or differently typed Credential makes the managed provider
unavailable.

Provisioning SHALL create exactly one Platform Provider with:

```text
{
  project_id: <Enterprise Project.id>,
  name: "enterprise-agent-default",
  type: "vertex",
  secret: null,
  namespace: null,
  annotations: {"ambient-code.io/enterprise-agent/managed":"true"}
}
```

It SHALL also create exactly one Agent-specific use-only RoleBinding with:

```text
{
  role_id: <credential:consumer Role.id>,
  scope: "credential",
  user_id: null,
  project_id: <Enterprise Project.id>,
  credential_id: <managed Credential.id>,
  agent_id: <Enterprise Agent.id>,
  session_id: null
}
```

The control plane SHALL map `vertex` to OpenShell `google-vertex-ai` and project
it only for an exact authorized Session of the Enterprise Agent. The
`credential:consumer` role SHALL be platform-internal and non-grantable. It
shall authorize only exact-Session resolution and supervisor-private or
OpenShell-proxy use, never human or Agent credential reads, mutation,
rebinding, or delegation.

Provider revision SHALL be `sha256:<64 lowercase hex>` over RFC 8785 canonical
JSON with exact logical shape:

```text
{
  "designation": "enterprise-agent-default",
  "designation_generation": <integer from 1 through 9007199254740991>,
  "credential_type": "vertex",
  "credential_id": "<immutable ID>",
  "credential_updated_at": "<UTC RFC 3339 timestamp>",
  "revoked": false,
  "entitlement": {
    "role": "credential:consumer",
    "scope": "credential",
    "agent_specific": true
  }
}
```

`credential_updated_at` SHALL use the UTC `Z` designator, exactly nine
fractional digits, and a seconds field from `00` through `59`; leap seconds are
invalid.

Public representations SHALL expose provider name, exact type `vertex`, and
revision, but never Credential ID or secret material. The provider revision
SHALL bind the exact designation generation even when a later rotation selects
the same Credential again.

#### Scenario: Provider is revalidated before every authority transition

- GIVEN the managed Vertex Credential and designation are valid
- WHEN preview, provisioning, reconciliation, or Agent Start runs
- THEN the operation locks or rechecks the exact positive designation
  generation, selected non-revoked Credential, Provider shape, Agent-specific
  binding, and provider revision
- AND Agent Start snapshots `gemini-cli`, `gemini-3.5-flash`, and provider
  context only after successful validation
- AND the non-secret Session snapshot records logical designation name,
  designation generation, and provider revision
- AND rotate, revoke, and restore cannot recreate earlier authority through an
  ABA sequence
- AND drift fails before Session or workload creation

#### Scenario: Forbidden authentication modes remain absent

- GIVEN an Enterprise Agent is previewed, provisioned, reconciled, or started
- WHEN managed inference policy is evaluated
- THEN non-Vertex providers, Gemini API-key, Google-account, Code Assist OAuth,
  cached interactive login, and Anthropic runtime modes are rejected
- AND no provider secret, OAuth credential, API key, service-account material,
  or long-lived credential is accepted from or returned to the client
- AND long-lived material is absent from Agent-readable environments, files,
  arguments, tools, logs, and model-invoked processes
- AND Agent Start fails if supervisor-private OpenShell proxy injection is
  unavailable
- AND unrelated or child Agents never inherit this runtime or entitlement
