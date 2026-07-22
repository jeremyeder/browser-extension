# Credential Binding

Credentials are global resources. Access to a credential's token at session runtime is governed by `scope=credential` RoleBindings that link a credential to a project or a specific agent within a project. The control plane resolves which credentials a session receives by walking these bindings from most-specific to least-specific scope. A credential with no binding covering the session's project and agent is not injected.

This spec defines the resolver algorithm, authorization rules for creating bindings at each level, and the `credential:token-reader` grant lifecycle.

## Terminology

- **Agent-level binding**: A `scope=credential` RoleBinding with `credential_id`, `project_id`, and `agent_id` all set. Grants the credential to one specific agent.
- **Project-level binding**: A `scope=credential` RoleBinding with `credential_id` and `project_id` set, `agent_id` NULL. Grants the credential to all agents in the project.
- **Global binding**: A `scope=credential` RoleBinding with `credential_id` set, `project_id` NULL, `agent_id` NULL. Grants the credential as a platform-wide default.
- **Session OIDC service identity**: A machine identity provisioned by the control plane at session start via OIDC `client_credentials` grant. Materializes as a `user_id` in RoleBinding records (e.g., `service-account-<client-id>`). The control plane uses this identity to grant `credential:token-reader` bindings on behalf of the session pod.
- **Managed Enterprise Credential**: The one platform-reserved `vertex`
  Credential designated for Enterprise Assistant inference. It is never a
  project or global default and is consumable only through internal
  `credential:consumer` bindings for completely provenanced Enterprise Agents.

## Dependencies

- **Global credential binding pattern**: The `scope=credential` binding with both `project_id=NULL` and `agent_id=NULL` is documented as valid for credential scope in `data-model.spec.md`.

## Requirements

### Requirement: Hierarchical Credential Resolution

The control plane SHALL resolve credentials for a session by walking `scope=credential` RoleBindings from most-specific to least-specific scope: **agent → project → global**.

For each credential provider (github, gitlab, google, jira, kubeconfig, vertex):

1. If a `scope=credential` binding exists where `credential_id` references a credential of this provider, `project_id` matches the session's project, AND `agent_id` matches the session's agent — use that credential (**agent-level binding**).
2. Otherwise, if a `scope=credential` binding exists where `credential_id` references a credential of this provider, `project_id` matches the session's project, AND `agent_id` is NULL — use that credential (**project-level binding**).
3. Otherwise, if a `scope=credential` binding exists where `credential_id` references a credential of this provider, `project_id` is NULL, AND `agent_id` is NULL — use that credential (**global binding**).
4. Otherwise, no credential is injected for this provider.

The API server SHALL reject creation of duplicate bindings at the same scope level for the same provider (same `credential.provider`, same `project_id`, same `agent_id`). If duplicates exist despite this (e.g., from prior data), the binding with the earliest `created_at` timestamp wins.

The Managed Enterprise Credential is a fail-closed exception to hierarchical
fallback. The resolver SHALL consider it only when the RoleBinding role is
exactly `credential:consumer`, `project_id` and `agent_id` exactly match a
completely provenanced Enterprise Agent, the requested logical Platform Provider
is exactly `enterprise-agent-default`, the initiating human was that Agent's
canonical sole owner, and the exact Session service identity is valid. It SHALL
never resolve this Credential from a project-level or global binding.

For a provenanced Enterprise Agent, this exception replaces the ordinary
hierarchical resolver in full. Its effective provider list SHALL be exactly one
logical inference Provider, `enterprise-agent-default`, backed only by the one
designated managed `vertex` Credential. The control plane SHALL NOT enumerate or
attach other Agent-, Project-, or global-level credentials, fan out to all bound
providers, or fall back to a same-provider ordinary Credential. Any additional,
duplicate, broad, or foreign provider or binding is managed-state drift and SHALL
fail Start before Session commit, or terminalize and clean the committed Session
if detected during post-commit reconciliation.

#### Scenario: Agent-level binding overrides project-level

- GIVEN credential A (provider=github) is bound to project P with `agent_id=NULL`
- AND credential B (provider=github) is bound to project P with `agent_id=agent-1`
- WHEN a session starts for agent-1 in project P
- THEN the session receives credential B (agent-level wins)

#### Scenario: Project-level binding used when no agent-level exists

- GIVEN credential A (provider=github) is bound to project P with `agent_id=NULL`
- AND no agent-level github binding exists for agent-1 in project P
- WHEN a session starts for agent-1 in project P
- THEN the session receives credential A (project-level fallback)

#### Scenario: No binding means no injection

- GIVEN credential A (provider=github) is bound to project P
- AND no github credential is bound to project Q at any level
- WHEN a session starts in project Q
- THEN no github credential is injected into the session

#### Scenario: Multiple providers resolved independently

- GIVEN credential A (provider=github) is bound to project P at project-level
- AND credential B (provider=jira) is bound to project P at agent-level for agent-1
- AND no google credential is bound to project P
- WHEN a session starts for agent-1 in project P
- THEN the session receives credential A (github, project-level) and credential B (jira, agent-level)
- AND no google credential is injected

#### Scenario: Global binding provides default

- GIVEN credential A (provider=github) has a `scope=credential` binding with `project_id=NULL` and `agent_id=NULL`
- AND no project-level or agent-level github binding exists for project P
- WHEN a session starts in project P
- THEN the session receives credential A (global fallback)

#### Scenario: Agent-level binding overrides global

- GIVEN credential A (provider=github) has a global binding (`project_id=NULL`, `agent_id=NULL`)
- AND credential B (provider=github) is bound to project P with `agent_id=agent-1`
- WHEN a session starts for agent-1 in project P
- THEN the session receives credential B (agent-level overrides global)

#### Scenario: Managed Enterprise Credential never falls back

- GIVEN the reserved Vertex Credential has an invalid project-level, global,
  foreign-Agent, non-consumer, or duplicate binding
- WHEN Enterprise Agent preview, provisioning, reconciliation, or Start validates
  the designation
- THEN validation fails closed before Credential resolution or Session creation
- AND ordinary hierarchical fallback never makes the Credential available

#### Scenario: Enterprise Agent receives no generic provider fanout

- GIVEN ordinary GitHub, Jira, Google, Anthropic, or other inference credentials
  are bound to the dedicated Project or visible globally
- WHEN the Enterprise Agent's effective providers are resolved
- THEN none of those bindings is selected or attached
- AND only the exact managed `enterprise-agent-default` Vertex path is eligible

### Requirement: Reserved Managed Enterprise Credential

The deployment SHALL designate exactly one non-revoked `vertex` Credential as
the Managed Enterprise Credential. Its identifier and secret material SHALL be
platform-private. It SHALL have exactly one protected administrative
`credential:owner` binding to a non-human platform service identity, no human
owner, no global or project-level use binding, and no binding for an
unprovenanced or foreign Agent. Every active use binding SHALL be an internal
`credential:consumer` binding for one completely provenanced Enterprise Agent
and its exact dedicated Project.

Generic Credential and RoleBinding create, get, list, patch, delete, apply, sync,
and bulk operations SHALL neither select the designation nor read or mutate the
designated Credential or its internal bindings. Human-facing generic RoleBinding
responses SHALL omit internal bindings rather than expose their existence. A
public Enterprise Assistant projection MAY return a bounded binding descriptor
containing only binding ID, role ID, scope, Project ID, and Agent ID; it SHALL
never return Credential ID, secret metadata, owner metadata, token state, or raw
material. Normal Enterprise Assistant provisioning MAY create or reconcile only
the exact Agent-specific `credential:consumer` row; it SHALL never create,
rotate, restore, or delete the designation. The designation SHALL be initialized,
rotated, revoked, or restored only through the closed, authenticated, idempotent
action contract in
[Audited Administrative Break-Glass](../platform/enterprise-assistant/identity-and-provisioning.spec.md#requirement-audited-administrative-break-glass);
that same contract's `managed-set.repair` or `managed-set.revoke` action is the
only administrator path for a consumer row. No operation deletes the singleton,
and this specification defines no generic administrator or service bypass.

#### Scenario: Broad or foreign binding invalidates the designation

- GIVEN the designated Credential has a global, project-level, human-owned,
  foreign-Agent, non-consumer, or otherwise ambiguous active binding
- WHEN the managed designation is validated
- THEN the operation reports an actionable administrative integrity failure
- AND creates no Session, workload, provider instance, token-reader grant, or
  public Credential reference

#### Scenario: Human reads remain redacted

- GIVEN a human caller can read the Enterprise Agent's dedicated Project
- WHEN the caller uses a generic Credential or RoleBinding read or list operation
- THEN the managed Credential and internal `credential:consumer` binding are not
  returned
- AND the Enterprise Assistant self projection exposes only its redacted binding
  descriptor and opaque provider revision

### Requirement: Credential Binding Authorization

**Binding** (creating) and **unbinding** (deleting) `scope=credential` RoleBindings have asymmetric authorization rules. Binding grants access to a secret and requires ownership of both sides. Unbinding revokes access from a project and only requires ownership of the destination.

#### Binding (create)

**All ordinary credential bindings** require the caller to hold
`credential:owner` on the target credential. You can only bind credentials you
own. Managed Enterprise Credential bindings are not ordinary bindings and are
created only by the platform-owned operations defined above.

**Project-level and agent-level bindings** additionally require the caller to hold `project:editor` or higher on the target project.

**Agent-level bindings** additionally require:
1. The specified agent to belong to the project specified in the binding (`project_id`), validated by the API server
2. The `project_id` to be non-NULL (agent-credential bindings without a project are invalid)

**Global bindings** additionally require the caller to hold `platform:admin`.

#### Unbinding (delete)

**Ordinary project-level and agent-level bindings** require the caller to hold
`project:editor` or higher on the binding's project. The caller does NOT need
`credential:owner` — a project editor/owner can remove an ordinary credential
from their project regardless of who bound it. This rule SHALL NOT authorize
reading, patching, or deleting a platform-internal role binding or any binding
for the Managed Enterprise Credential.

**Global bindings** require the caller to hold `platform:admin`.

#### Scenario: Project owner binds own credential to project

- GIVEN user A holds `credential:owner` on credential C
- AND user A holds `project:owner` on project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`, `agent_id=NULL`
- THEN the binding is created (201)

#### Scenario: Project owner binds own credential to specific agent

- GIVEN user A holds `credential:owner` on credential C
- AND user A holds `project:owner` on project P
- AND agent-1 belongs to project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`, `agent_id=agent-1`
- THEN the binding is created (201)

#### Scenario: Non-credential-owner cannot bind

- GIVEN user A does NOT hold `credential:owner` on credential C
- AND user A holds `project:owner` on project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`
- THEN the request returns 403 Forbidden

#### Scenario: Project editor binds own credential to project

- GIVEN user A holds `credential:owner` on credential C
- AND user A holds `project:editor` on project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`
- THEN the binding is created (201)

#### Scenario: Project viewer cannot bind credentials

- GIVEN user A holds `credential:owner` on credential C
- AND user A holds `project:viewer` on project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`
- THEN the request returns 403 Forbidden

#### Scenario: Non-project-member cannot bind credential

- GIVEN user A holds `credential:owner` on credential C
- AND user A has no role on project P
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`, `agent_id=agent-1`
- THEN the request returns 403 Forbidden

#### Scenario: Agent-credential binding requires project_id

- GIVEN user A holds `credential:owner` on credential C
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `agent_id=agent-1`, `project_id=NULL`
- THEN the request returns 400 Bad Request
- AND the error indicates that agent-scoped credential bindings require a project_id

#### Scenario: Agent must belong to the specified project

- GIVEN user A holds `credential:owner` on credential C
- AND user A holds `project:owner` on project P
- AND agent-1 belongs to project Q (not P)
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=P`, `agent_id=agent-1`
- THEN the request returns 400 Bad Request

#### Scenario: Platform admin creates global credential binding

- GIVEN user A holds `platform:admin`
- AND user A holds `credential:owner` on credential C
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=NULL`, `agent_id=NULL`
- THEN the binding is created (201)

#### Scenario: Non-admin cannot create global credential binding

- GIVEN user A holds `credential:owner` on credential C
- AND user A does NOT hold `platform:admin`
- WHEN user A creates a RoleBinding with `scope=credential`, `credential_id=C`, `project_id=NULL`, `agent_id=NULL`
- THEN the request returns 403 Forbidden

#### Scenario: Project editor unbinds credential they don't own

- GIVEN user B (not credential owner) holds `project:editor` on project P
- AND credential C (owned by user A) is bound to project P
- WHEN user B deletes the `scope=credential` RoleBinding for credential C on project P
- THEN the binding is deleted (204)

#### Scenario: Project viewer cannot unbind

- GIVEN user A holds `project:viewer` on project P
- AND credential C is bound to project P
- WHEN user A deletes the `scope=credential` RoleBinding for credential C on project P
- THEN the request returns 403 Forbidden

#### Scenario: Project owner cannot mutate a managed binding

- GIVEN a caller holds `project:owner` on an Enterprise Agent's dedicated Project
- WHEN the caller uses a generic RoleBinding operation against the internal
  `credential:consumer` binding
- THEN the operation returns HTTP 403 without exposing its Credential ID
- AND the binding remains unchanged

### Requirement: credential:token-reader Grant Lifecycle

The control plane SHALL grant `credential:token-reader` to the session's OIDC service identity for each credential resolved by the hierarchical resolver. This grant SHALL be scoped to the specific credential and SHALL be revoked when the session terminates.

The control plane authenticates with its platform service identity and invokes an
internal RoleBinding service operation. The public generic `POST /role_bindings`
route SHALL reject `credential:token-reader`, including from a human
`platform:admin`. Only the authenticated control plane operation may create it.

For the Managed Enterprise Credential, the service identity and bearer profile
SHALL be cryptographically unique to one Session and bound to exact audience,
purpose, Project, Agent, Session, workload generation, and bounded expiry. The
grant is usable only by the supervisor-private inference proxy or exact-Session
provider helper; the Runner, Agent, model, browser, user tools, and arbitrary
Session processes SHALL receive neither the bearer nor the raw Credential. The
grant and exact-Session provider instance SHALL be revoked during every terminal,
failed-start, cancellation, and partial-provisioning cleanup path.

Before the API commits an Enterprise Agent Session, synchronous readiness
preflight SHALL verify the compatible gateway and private proxy control surface
without creating a token-reader grant or provider instance. After the Session and
immutable launch snapshot commit, the control plane SHALL create or reconcile the
grant and exact-Session provider idempotently from that snapshot. Failure after
commit SHALL mark that existing Session `Failed` and revoke every partial grant or
provider artifact; it SHALL NOT claim the Session transaction was rolled back.

#### Scenario: Token-reader granted at session start

- GIVEN credential A is resolved for a session via the hierarchical resolver
- WHEN the control plane provisions the session pod
- THEN a RoleBinding is created with `role=credential:token-reader`, `scope=credential`, `credential_id=A`, `user_id=<session-oidc-service-account>`

#### Scenario: Token-reader revoked at session end

- GIVEN a session was provisioned with `credential:token-reader` for credential A
- WHEN the session terminates (Completed, Failed, or Stopped)
- THEN the `credential:token-reader` RoleBinding for credential A is deleted

#### Scenario: Sidecar can fetch token with granted role

- GIVEN the control plane granted `credential:token-reader` for credential A to the session's service identity
- WHEN the credential sidecar calls `GET /credentials/{A}/token` with the session's bearer token
- THEN the API server returns the decrypted token (200)

#### Scenario: Sidecar cannot fetch unbound credential token

- GIVEN credential B was NOT resolved for this session (no binding)
- AND no `credential:token-reader` was granted for credential B
- WHEN the credential sidecar calls `GET /credentials/{B}/token`
- THEN the API server returns 404

#### Scenario: Managed provider capability is exact-Session only

- GIVEN an owner-authorized Enterprise Agent Start resolves the managed Vertex
  Credential
- WHEN the control plane creates runtime authority
- THEN it creates one bounded token-reader grant for the exact Session service
  identity and one exact-Session provider instance or proxy binding
- AND replay from another User, Project, Agent, Session, workload generation,
  audience, purpose, or process is denied without revealing Credential metadata
- AND terminal or failed provisioning cleanup revokes both artifacts

#### Scenario: Managed provider creation fails after Session commit

- GIVEN readiness preflight passed and one Session plus launch snapshot committed
- WHEN the control plane cannot create or verify the exact-Session provider
- THEN the existing Session becomes terminal `Failed`
- AND any token-reader binding, provider instance, or capability created by that
  attempt is revoked or deleted idempotently
- AND reconciliation does not create a replacement Session

### Requirement: Binding Deletion Does Not Affect Running Sessions

Deleting a `scope=credential` RoleBinding SHALL NOT terminate running sessions that were provisioned with the previously-bound credential. The credential remains available for the session's lifetime via its existing `credential:token-reader` grant. New sessions started after the binding deletion SHALL NOT receive the credential.

This ordinary snapshot rule does not prevent audited revocation of the Managed
Enterprise Credential. Revoking its designation or internal binding SHALL make
the exact-Session provider proxy deny further requests and SHALL revoke associated
token-reader grants; it SHALL never leave long-lived managed material in a
Session.

#### Scenario: Running session keeps credential after binding deleted

- GIVEN a session is Running with credential A (bound at project-level)
- WHEN the project-level binding for credential A is deleted
- THEN the running session continues to use credential A
- AND the `credential:token-reader` grant for this session is NOT revoked

#### Scenario: New session does not receive deleted binding's credential

- GIVEN the project-level binding for credential A on project P was deleted
- WHEN a new session starts in project P
- THEN credential A is NOT injected (resolver finds no matching binding)

## Migration

### Existing consumers

| Consumer | Current behavior | Required change |
|----------|-----------------|-----------------|
| Control plane `resolveCredentialIDs` | Lists all credentials via `sdk.Credentials().ListAll()`, picks first per provider | Query `scope=credential` RoleBindings filtered by `project_id` and `agent_id`, implement hierarchical resolution |
| RBAC middleware (credential binding creation) | Validates `credential:owner` + `project:owner` for project-level bindings | Relax bind check to `project:editor`+, add agent-level validation (verify agent belongs to project), global bindings (require `platform:admin`), reject `agent_id` without `project_id`, and asymmetric unbind auth (`project:editor`+ can unbind without `credential:owner`) |
| Credential sidecar entrypoint | Fetches token via bearer token from CP token exchange | No change — consumes `CREDENTIAL_IDS` produced by CP |
| Runner `populate_runtime_credentials` | Fetches tokens from `CREDENTIAL_IDS` env var | No change — consumes `CREDENTIAL_IDS` produced by CP |
| UI binding matrix | Creates RoleBindings with `credential_id` + `project_id` ± `agent_id` | No change — already creates correct binding structure |
| Enterprise Assistant managed provider | No reserved designation or private provider path | Add Vertex-only designation validation, internal redacted bindings, exact-owner Start validation, and exact-Session proxy lifecycle; never add it to `CREDENTIAL_IDS` |

### Specs requiring amendment

| Spec | Amendment |
|------|-----------|
| `rbac-enforcement.spec.md` | Relax credential binding from `project:owner` to `project:editor`+; document bind/unbind asymmetry (editors can unbind without `credential:owner`) |
| `data-model.spec.md` | Document global credential binding pattern (`scope=credential` with `project_id=NULL`, `agent_id=NULL`); add credential binding scope terms (agent-level, project-level, global) |
| `identity-boundaries.spec.md` | Exempt the managed Vertex designation from direct mounts and ordinary provider fallback; require the exact-Session private proxy. |

---
