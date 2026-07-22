# Browser Extension Specification

<!-- markdownlint-disable MD013 MD022 MD032 -->
<!-- Compact Gherkin clauses remain one requirement per line. -->

## Purpose

The Browser Extension component in `components/browser-extension/` is ACP's canonical Chrome-compatible side-panel surface. It provides one durable Agent-backed Enterprise Assistant in a dedicated user-owned Project, including the memoryless Artoo default and a reviewable customization path, while also allowing a user to import local Kind connection choices, configure project-scoped ACP access, manage Sessions, and continue Session conversations without leaving the current browser tab. It consumes User, Project, Role, RoleBinding, Platform Provider, Agent, Session, and SessionMessage contracts and introduces no browser-extension-specific server entity.

## Requirements

### Requirement: Chrome Side Panel Surface
The Browser Extension SHALL run as a Chrome-compatible side panel opened from the extension toolbar action and SHALL preserve compact, accessible primary controls at supported side-panel sizes.

#### Scenario: Toolbar action opens side panel
- GIVEN the Browser Extension is installed and enabled
- WHEN the user activates its toolbar action
- THEN the ACP side panel opens
- AND the side panel displays the current ACP connection state

#### Scenario: Persistent navigation escape hatch
- GIVEN the user is viewing a Session chat with enough history to scroll
- WHEN the user scrolls to the end of the transcript
- THEN a keyboard-accessible Back control remains available
- AND activating Back returns to the Session list without losing connection state

#### Scenario: Compact accessible header controls
- GIVEN the side panel header is visible at a supported width
- WHEN Refresh, New Session, Settings, and Theme controls render
- THEN each control uses an inline SVG icon that inherits `currentColor`
- AND each control is a keyboard-operable `type=button` with a minimum 34 CSS-pixel target, visible focus state, accessible name, and matching tooltip
- AND the controls remain usable without an external icon dependency

#### Scenario: Theme control reflects the active theme
- GIVEN the side panel is using the light theme
- WHEN the Theme control renders
- THEN it displays a moon icon and an accessible name describing the available dark-theme action
- GIVEN the side panel is using the dark theme
- WHEN the Theme control renders after a toggle or reload
- THEN it displays a sun icon and an accessible name describing the available light-theme action

### Requirement: Connection Configuration
The Browser Extension SHALL provide explicit `Bearer token` and `Sign in with ACP` authentication modes for one ACP server origin and project, SHALL discover the selected ACP deployment's OIDC issuer, endpoints, and public-client metadata from ACP, and SHALL validate a replacement configuration before making it active. Settings SHALL NOT ask the user to supply an OIDC issuer, client ID, authorization endpoint, token endpoint, JWKS endpoint, UserInfo endpoint, or redirect URI.
`Bearer token` mode SHALL be a manual/operator fallback for an externally obtained ACP-supported bearer credential, not the normal human login path; it SHALL NOT mint human identity or provide an alternative password-authentication flow.

#### Scenario: Bearer-token local development configuration
- GIVEN the user runs `make kind-status CONTAINER_ENGINE=docker` to discover the current worktree's `KIND_FWD_API_SERVER_PORT`
- AND a local ACP API server is reachable at `http://localhost:$KIND_FWD_API_SERVER_PORT`
- WHEN the user saves that server URL, project `tenant-a`, and a valid bearer token
- THEN the Browser Extension loads ACP data from project `tenant-a`
- AND every ACP request carries the bearer token
- AND every project-scoped ACP request carries the configured project header

#### Scenario: ACP supplies public authentication metadata
- GIVEN the user supplies a valid ACP origin and project and selects `Sign in with ACP`
- WHEN the Browser Extension prepares that configuration
- THEN it reads ACP's unauthenticated, same-origin `GET /api/ambient/v1/auth/configuration` response
- AND the response identifies the exact issuer, authorization endpoint, token endpoint, JWKS endpoint, UserInfo endpoint, public client ID, supported scopes, and registered browser redirect URIs without returning a client secret or user-specific data
- AND the Browser Extension does not infer, substitute, or accept user-entered values for those fields
- AND it rejects missing, malformed, unsafe, credential-bearing, or internally inconsistent metadata before starting authorization

#### Scenario: Existing browser SSO session is reused silently
- GIVEN a valid `Sign in with ACP` configuration has no usable local token set
- AND the Browser Extension has the required runtime permissions for the ACP-advertised origins
- WHEN authentication is restored after configuration, startup, or token invalidation
- THEN it makes at most one non-interactive authorization attempt through `chrome.identity.launchWebAuthFlow` with `interactive: false` and OAuth `prompt=none`
- AND an existing browser SSO session may complete Authorization Code with PKCE without displaying a login page
- AND the Browser Extension never reads browser SSO cookies to determine whether that session exists
- AND it does not repeatedly retry silent authorization after an interaction-required result

#### Scenario: Required interaction is an explicit user action
- GIVEN the silent authorization attempt returns `login_required`, `interaction_required`, another response requiring user interaction, or a browser result indicating that interaction is required
- WHEN the side panel presents the unauthenticated state
- THEN it shows a clear `Sign in` action without opening an authorization page
- AND startup, polling, refresh, and background execution do not invoke an interactive authorization flow
- WHEN the user activates `Sign in`
- THEN the Browser Extension invokes `chrome.identity.launchWebAuthFlow` with `interactive: true`
- AND the browser displays the identity-provider-controlled authorization or login page

#### Scenario: Sign in with ACP uses public-client PKCE
- GIVEN silent or user-activated interactive authorization begins from valid ACP-supplied metadata
- WHEN the Browser Extension constructs the authorization request
- THEN it generates fresh cryptographically random state, nonce, and PKCE verifier values for that attempt
- AND includes the exact generated state and nonce in the authorization request
- AND derives the code challenge from that exact verifier with PKCE S256 and includes the challenge and `code_challenge_method=S256` in the authorization request
- AND starts OAuth Authorization Code with PKCE S256 through `chrome.identity.launchWebAuthFlow`
- AND uses the exact value returned by `chrome.identity.getRedirectURL()` as the redirect URI
- AND verifies that redirect URI is an exact registered `https://<extension-id>.chromiumapp.org/` URI advertised by ACP before opening the flow
- AND requests the `openid` scope plus only the additional scopes advertised by ACP and verifies that the returned state exactly matches the generated state before exchanging the authorization code
- AND exchanges the authorization code with the same redirect URI and PKCE verifier and without a client secret
- AND validates the ID token signature, issuer, audience, authorized party when the audience has multiple values, expiry, subject, and exact nonce after the exchange
- AND requires the UserInfo `sub` to equal the validated ID-token `sub` exactly and fails closed on a mismatch
- AND sends the access token, never the ID token, as ACP bearer authorization
- AND the extension manifest declares the browser `identity` permission
- AND activates the replacement configuration only after UserInfo identity and ACP access validation succeed

#### Scenario: Extension-owned UI never handles username or password credentials
- GIVEN either authentication mode is selected in any environment
- WHEN the user configures or authenticates the Browser Extension
- THEN extension-owned UI and code MUST NOT present username or password fields
- AND MUST NOT collect, store, log, or forward username-password login credentials
- AND any interactive credentials are entered only into the identity-provider-controlled authorization page opened by `chrome.identity.launchWebAuthFlow` and are not accessible to extension code
- AND that identity-provider page MAY authenticate the user with username and password according to issuer policy
- AND the Browser Extension never sends username-password credentials to the token endpoint or uses a resource-owner password credential grant or identity-provider direct grant

#### Scenario: Reconfiguration is atomic
- GIVEN a working ACP configuration is stored
- WHEN the user saves a different permitted server origin, project, authentication mode, or authentication material
- THEN subsequent requests use the new configuration
- AND only after the replacement is fully active does the Browser Extension delete credentials, cached authentication metadata, and runtime endpoint permissions that belonged exclusively to the replaced configuration
- AND the previous configuration remains active if metadata discovery, permission grant, validation, or authorization of the replacement fails

#### Scenario: Sign out clears only extension-local credentials
- GIVEN `Sign in with ACP` has an active token set
- WHEN the user activates `Sign out`
- THEN the Browser Extension atomically clears its local access, refresh, and ID token material and returns to its signed-out state
- AND stores a scoped local sign-out marker that suppresses silent authorization until the user explicitly activates `Sign in` or intentionally replaces the authentication configuration
- AND it does not claim to terminate or clear the browser's global SSO session or identity-provider cookies
- AND explicit `Sign in` may reuse the global SSO session without displaying a login page when that session remains valid

### Requirement: Local Kind Connection Import
ACP local-development tooling SHALL maintain one versioned, token-free registry of current local Kind connection candidates, and the Browser Extension SHALL import that registry only through an explicit user-selected file, validate and health-check its entries, and let the user choose a healthy connection without treating import as authentication. Registry `ready` means the host tooling observed the required cluster-scoped port-forward processes alive and listening; `healthy` means the Browser Extension subsequently validated ACP's public authentication-configuration response or the bounded credential-free compatibility response from the imported API origin.

#### Scenario: Local tooling maintains current connection choices
- GIVEN one or more ACP Kind clusters may be running with cluster-specific local port forwards
- WHEN local Kind startup, port-forward, stop, teardown, or status tooling reconciles connection state
- THEN it atomically updates one schema-versioned registry in the platform user-configuration directory
- AND serializes concurrent writers while rebuilding the aggregate from cluster-scoped state
- AND derives each entry and port allocation from the Kind cluster identity and that cluster's live port-forward state rather than the current Git branch name
- AND each ready entry contains only a stable local registry entry ID, cluster name, kubeconfig context name, exact loopback ACP API and UI origins in the `api_url` and `ui_url` fields, default Project name `tenant-a`, readiness, and update timestamp
- AND cluster-scoped process state prevents one worktree from overwriting another cluster's connection record
- AND private runtime directories, symlink rejection, exact process ownership and command validation, and exact per-cluster kubeconfig context binding prevent stale or hostile process state from redirecting writes or terminating an unrelated process
- AND the registry includes its own generation timestamp and remains readable by version-1 consumers for the supported version-1 lifecycle
- AND the registry contains no access token, refresh token, cookie, issuer, client configuration, authorization endpoint, credential, or arbitrary request header

#### Scenario: Import presents current local choices
- GIVEN the user activates `Upload Kind connections…` and selects a supported registry file
- WHEN the Browser Extension reads the file
- THEN it enforces a bounded file size, exact supported schema version, allowed fields, unique connection identities, normalized loopback HTTP origins, registry age no greater than 24 hours, no generation timestamp more than five minutes in the future, and absence of credential-bearing content
- AND treats imported `ready` values only as untrusted host-tooling hints
- AND when the file contains exactly one ready entry, health-checks and fills that token-free connection directly from the file-upload gesture without a second click
- AND when the file contains multiple entries, presents an accessible connection picker whose ready actions are labeled as selection rather than verification
- AND displays an unavailable entry as non-selectable rather than claiming it is connected

#### Scenario: Importing or selecting a Kind connection preserves authentication boundaries
- GIVEN the imported registry contains a ready Kind connection candidate
- WHEN a sole ready entry is imported or the user selects an entry from a multi-connection registry
- THEN the Browser Extension makes zero `chrome.permissions.request` calls for that Kind action and opens no native permission prompt
- AND the manifest's required host permissions are limited to `http://localhost/*` and `http://127.0.0.1/*` so loopback ACP and Keycloak requests work without runtime permission activation
- AND application URL validation and request construction continue to enforce the exact selected origin including its port because browser host permissions do not distinguish ports
- AND it validates the selected origin through one bounded, credential-free, redirect-rejecting `GET /api/ambient/v1/auth/configuration` request
- AND while a compatible ACP deployment does not yet expose that public endpoint, an HTTP 404 triggers one bounded, credential-free, redirect-rejecting `GET /api/ambient/v1/projects?size=1` compatibility request whose accepted response is an authenticated-required HTTP 401/403 JSON response or a valid public `ProjectList`
- AND only after that response validates does Settings fill the exact ACP API origin and default Project name `tenant-a`
- AND selection does not store a token, send any credential from the prior configuration to the candidate origin, start authorization, or activate a replacement configuration
- AND the selected values still pass the same metadata-discovery, authentication, fresh-credential, and atomic-validation flow as manually entered values
- AND a failed validation changes no host permission or active configuration
- AND authentication tokens are obtained and persisted only by the selected authentication mode

#### Scenario: Invalid or stale import leaves working state intact
- GIVEN the Browser Extension has a working ACP configuration
- WHEN the selected file is oversized, malformed, unsupported, duplicate, credential-bearing, non-loopback, stale, or contains no ready candidate
- THEN import fails closed with a credential-safe explanation
- AND the prior configuration, credentials, permissions, Enterprise Assistant binding, notifications, drafts, and active view remain unchanged
- AND existing manual ACP server and project configuration remains available without importing a registry

### Requirement: Configured-Origin Host Permissions
The Browser Extension SHALL request runtime host access only for the configured ACP origin and the exact programmatic endpoint origins advertised by ACP authentication metadata, and SHALL reject unsafe URLs before storing them.

#### Scenario: Remote HTTPS permission granted from Save
- GIVEN the user enters a remote HTTPS ACP origin without credentials, path, query, or fragment
- WHEN the user activates Save
- THEN the Browser Extension requests the narrowest normalized Chrome scheme-and-host match pattern from that user gesture
- AND enforces the configured scheme, host, and port as the exact request origin in application code because Chrome host permissions do not distinguish ports
- AND stores the configuration only after the browser grants the permission
- AND the manifest declares discoverable remote access under `optional_host_permissions`, not required `host_permissions`

#### Scenario: Local plaintext development is limited
- GIVEN the user enters an HTTP ACP URL
- WHEN the host is `localhost` or `127.0.0.1`
- THEN the required loopback host permission allows the exact application-validated origin without a runtime permission request
- WHEN the host is any other host
- THEN Save is rejected without changing the stored configuration

#### Scenario: Permission denied or revoked
- GIVEN the configured origin permission is denied or later revoked
- WHEN the user saves the configuration or the Browser Extension attempts an ACP request
- THEN the operation fails closed with instructions to grant access
- AND no request is sent to an unpermitted origin
- AND a denied replacement leaves the prior configuration and permission intact
- AND after a replacement succeeds, the Browser Extension removes the prior normalized match pattern only when it differs from and is no longer needed by the configured origin

#### Scenario: OIDC endpoint permissions are narrow and atomic
- GIVEN `Sign in with ACP` uses one or more programmatic endpoint origins distinct from the configured ACP origin
- WHEN the user saves that configuration or activates `Sign in`
- THEN the Browser Extension requests runtime host access only for each exact normalized origin required by the ACP-advertised token, JWKS, and UserInfo endpoints
- AND programmatic authentication requests target only the exact advertised HTTPS endpoints, except that loopback development endpoints may use HTTP
- AND programmatic requests reject unexpected redirects while browser-managed authorization may traverse a federated identity provider before returning only to the exact `chrome.identity.getRedirectURL()` callback
- AND a denied, off-metadata, or unsafe replacement permission leaves the previous working configuration active
- WHEN a permission required by the active OIDC configuration is revoked
- THEN the Browser Extension sends no request to that endpoint, clears the active OIDC token set, preserves the non-secret ACP origin and project, and presents the signed-out state with a `Sign in` action

### Requirement: Session List
The Browser Extension SHALL display a compact, deterministically ordered list of ordinary Sessions for the configured project after the Enterprise Assistant region, loading it through bounded projected pages.

#### Scenario: Sessions render with operational state
- GIVEN the configured project has ordinary Sessions
- WHEN the Session list loads
- THEN each Session card shows its name, model, relative age, prompt preview, and phase badge
- AND its actions reflect the current phase

#### Scenario: Empty project keeps the Enterprise Assistant
- GIVEN the configured project has no ordinary Sessions
- WHEN the Session list loads
- THEN the Enterprise Assistant region remains first and usable
- AND an ordinary-Session empty state appears after it

#### Scenario: Polling updates transitional sessions
- GIVEN an ordinary Session is `Pending`, `Creating`, or `Stopping`
- WHEN the side panel remains open
- THEN the Browser Extension polls often enough for phase transitions to appear without a manual refresh
- AND it performs no background polling after the side panel is closed

#### Scenario: Projected pagination loads all bounded results
- GIVEN the configured project has ordinary Sessions
- WHEN the Session list loads
- THEN each request asks for 25 rows and only `id,name,llm_model,created_at,prompt,repo_url,phase,agent_id`
- AND requests deterministic `created_at desc,id desc` ordering
- AND requests subsequent pages until a short or empty page is returned, including the empty probe after an exact multiple of 25 below the 500-row safety boundary
- AND deduplicates Session IDs while preserving deterministic order
- AND filters Sessions for the exact discovered Enterprise Agent only after aggregating the pages
- AND no request weakens the existing 1 MiB response-size cap

#### Scenario: Pagination remains bounded and preserves partial results
- GIVEN one or more projected Session pages loaded successfully
- WHEN a later page fails or 20 pages have been requested without a short or empty page
- THEN the Browser Extension retains and renders the successfully loaded rows
- AND displays a Session-list-scoped partial-results state with a retry control
- AND does not replace the Enterprise Assistant or previously loaded rows with a generic whole-surface error

### Requirement: Enterprise Agent Provisioning and Onboarding

The Browser Extension SHALL implement the Enterprise Assistant onboarding and default-Agent experience defined by the [Enterprise Assistant platform contracts](../platform/index.spec.md#enterprise-assistant) without duplicating authority, provider, identity, template, memory, or provisioning policy in browser state.

#### Scenario: First use offers customization or Artoo

- GIVEN ACP authentication is valid for a normalized origin and canonical user scope
- AND authoritative discovery finds no Enterprise Agent for that user
- WHEN connection setup succeeds
- THEN onboarding appears in the Enterprise Assistant region before the ordinary Session list rather than replacing the Sessions view
- AND a primary blue `Start` button opens the Enterprise Assistant customization wizard
- AND opening the wizard focuses its programmatically focusable heading while cancelling returns focus to Start without changing server or local Agent state
- AND a blue `<button type="button">` labeled `Skip for now` is visually link-styled and appears immediately below `Start` in DOM and keyboard order
- AND helper text explains that Skip provisions Artoo without managed agentic memory and that the user can customize it later
- AND both actions are keyboard-operable, have visible focus states, expose accessible names, provide at least a 44-by-44 CSS-pixel target, use a non-color affordance, and meet WCAG AA text and focus-indicator contrast in light and dark themes
- AND ordinary Session controls and `Chat with the vTeam` remain reachable before, during, and after either onboarding path
- AND neither rendering nor opening the wizard creates an Agent, Session, workload, managed agentic-memory attachment, or other ACP resource

#### Scenario: Skip provisions the memoryless Artoo default

- GIVEN authoritative discovery finds no Enterprise Agent for the canonical user
- WHEN the user activates `Skip for now`
- THEN the Browser Extension requests only the registered Artoo template, setup mode `starter`, both memory facets disabled, and the matching preview digest through the self-scoped Enterprise Agent provisioning operation
- AND ACP owns the reserved Agent resource name and starter display name and atomically provisions or returns the canonical per-user Enterprise Agent and its dedicated Project
- AND the Browser Extension does not create a Project, RoleBinding, Provider, Agent, Session, workload, or managed agentic-memory attachment through client-orchestrated writes
- AND Skip starts no Session or Agent workload
- AND the resulting server state contains no Session, active workload, or managed agentic-memory attachment attributable to Skip
- AND the Artoo starter has no managed agentic-memory integration
- AND a lost or ambiguous response triggers authoritative discovery or an exact idempotent retry rather than generic resource creation

#### Scenario: Skip is single-flight and focus-safe

- GIVEN authoritative discovery finds no Enterprise Agent for the canonical user
- WHEN the user activates `Skip for now`
- THEN Start and Skip enter one shared single-flight pending state and cannot submit a second preview or provisioning request
- AND the Enterprise Assistant region exposes an assistive-technology-visible busy state and announces bounded progress without moving focus unexpectedly
- AND ordinary Session controls and `Chat with the vTeam` remain operable while provisioning is pending
- WHEN authoritative discovery verifies the provisioned starter
- THEN focus moves to a programmatically focusable Enterprise Assistant heading and the memory-boundary note is available in the same reading sequence
- WHEN provisioning, verification, or recovery fails
- THEN the pending state clears, the user's existing view and drafts remain intact, and one escaped actionable error summary associated with Skip receives focus
- AND an explicit Retry is available after the summary, repeated activation cannot duplicate a pending retry, and no automatic non-idempotent retry occurs

#### Scenario: Skip completion is verified from server state

- GIVEN the user activated `Skip for now`
- WHEN the provisioning operation reports success or an existing result
- THEN the Browser Extension reads `GET /api/ambient/v1/users/me/enterprise-agent` and verifies its complete `EnterpriseAgentState` for the dedicated Project, sole canonical owner binding, managed Provider entitlement, reserved Agent resource name `enterprise-agent`, display name `Artoo`, registered template provenance, normalized customization, setup mode, memory configuration, memory readiness, nullable memory failure, state digest, and complete reserved Enterprise Agent annotation set
- AND the client rejects a response that omits required provenance, exposes managed Credential identity, or disagrees across Project, RoleBinding, Provider, Agent, template, or digest fields
- AND the Enterprise Assistant surface reports `Ready` only from that verified server state
- AND absent, partial, ambiguous, unauthorized, or internally inconsistent server state reports `Unavailable` with actionable recovery guidance
- AND browser-local completion, naming, or cached binding alone never establishes readiness

#### Scenario: Fresh-user Start completes customized provisioning

- GIVEN authenticated-self GET returned HTTP 404 `enterprise_agent_not_found`
- AND the user opened the declarative wizard with `Start` and confirmed a valid customized configuration
- WHEN the Browser Extension completes onboarding
- THEN it obtains a fresh customized preview, sends that exact desired representation and preview digest with `If-None-Match: *`, and accepts only the lifecycle contract's successful creation response
- AND it performs a final authenticated-self GET and binds the Agent only after validating the complete `EnterpriseAgentState` and strong entity-tag
- AND success focuses the Enterprise Assistant heading while a preview, conditional PUT, or final-GET failure focuses one escaped actionable error summary without discarding wizard input
- AND final readiness `not-configured` with both facets disabled or `ready` with an enabled facet presents `Ready` and enables the composer
- AND final readiness `provisioning` or `failed` follows the non-sendable status and retry mapping and never presents onboarding as fully ready

#### Scenario: Stale Skip retains verified customized state

- GIVEN another client already created or customized the canonical Enterprise Agent
- WHEN Skip's creation PUT returns HTTP 412 `precondition_failed` or a stale downgrade attempt returns HTTP 422 `validation_failed`
- THEN the Browser Extension performs authenticated-self GET and accepts the result only when the complete customized `EnterpriseAgentState` verifies
- AND it binds and presents that customized state without sending another write
- AND it does not claim that Skip created Artoo, display starter-success feedback, reset customization, or show the starter memoryless note
- AND an absent, conflicting, malformed, or unverifiable recovery GET remains `Unavailable` with actionable guidance

#### Scenario: Starter mode explains its memory boundary and customization path

- GIVEN authoritative discovery resolves an Enterprise Agent with resource name `enterprise-agent`, display name `Artoo`, setup mode `starter`, both memory facets disabled, and memory readiness `not-configured`
- WHEN the Enterprise Assistant surface renders
- THEN it persistently states `Artoo does not have agentic memory. When you're ready, choose Customize Enterprise Assistant to configure agentic memory during onboarding.`
- AND it provides a `Customize Enterprise Assistant` action that reopens the wizard
- AND the note and action remain visible after reload, Project changes, and authoritative discovery from another browser profile
- AND after sign-out the surface requests sign-in to verify memory state rather than presenting cached memory state as current
- AND the note does not imply that browser-local history, an ordinary Session transcript, or ACP persistence is managed agentic memory

#### Scenario: Customized memory copy follows authoritative state

- GIVEN authoritative discovery resolves the Enterprise Agent in setup mode `customized`
- WHEN the Enterprise Assistant surface renders
- THEN it derives memory copy only from the returned memory configuration and readiness rather than resource name, display name, prompt text, local preferences, or a prior starter note
- AND both facets disabled with `not-configured` states that managed agentic memory is off
- AND an enabled facet with `provisioning`, `ready`, or `failed` presents that exact server-derived state with an appropriate wait, use, retry, or repair action
- AND it never displays `Artoo does not have agentic memory` while managed agentic memory is requested or ready
- AND changing the display name does not change memory copy or Enterprise Agent identity

#### Scenario: Nullable memory failure is validated and bounded

- GIVEN authenticated-self GET returns an `EnterpriseAgentState`
- WHEN the Browser Extension validates memory status
- THEN `memory_failure` is accepted as null only when readiness is not `failed`
- AND failed readiness requires exactly bounded string `code`, bounded string `message`, Boolean `retryable`, and nullable RFC 3339 `retry_after`
- AND a missing, extra, malformed, oversized, or readiness-inconsistent failure member makes the Enterprise Assistant `Unavailable` without rendering its untrusted content
- AND displayed failure copy is escaped and bounded and never includes an attachment identifier, external provider reference, secret, token, raw upstream response, or another User's state

#### Scenario: Customization is reviewable and non-destructive

- GIVEN an Enterprise Agent, including the starter whose current display name is Artoo, is authoritatively discovered
- WHEN the user activates `Customize Enterprise Assistant`
- THEN the wizard loads the server-supported structured Enterprise Assistant defaults and the Agent's current supported preferences
- AND it permits only the bounded customization schema returned by preview
- AND it displays the dedicated Project, complete effective Agent instructions, template and customization digests, managed provider type, and requested memory configuration before enabling confirmation
- AND opening, editing, cancelling, or previewing preserves the existing Agent, Sessions, drafts, history, and current runtime behavior
- AND confirming a current preview follows the platform contract's conditional self-scoped write, precondition, redaction, verification, and retry rules
- AND customization applies only to a later Session and does not mutate an active Session's runtime or memory attachment
- AND confirmation uses one single-flight pending state, announces progress, prevents duplicate writes, and preserves the current Agent view until the self GET verifies the new composite
- AND cancellation returns focus to the control that opened the wizard, while success focuses the programmatically focusable updated Enterprise Assistant heading and failure focuses an escaped actionable error summary without discarding wizard input

#### Scenario: Enterprise Agent discovery works across browser profiles

- GIVEN ACP has provisioned a canonical Enterprise Agent for the authenticated user
- AND the user opens the same ACP origin from another browser profile or device with no local Enterprise Assistant state
- WHEN authenticated discovery calls `GET /api/ambient/v1/users/me/enterprise-agent`
- THEN the Browser Extension discovers the exact server-owned Enterprise Agent and dedicated Project from the endpoint's complete redacted composite, canonical user identity, and authoritative provenance
- AND renders the Enterprise Assistant without repeating first-use provisioning or relying on an Agent name, local completion marker, cached Project, or cached Agent ID
- AND any unsent draft remains local to its originating browser profile

#### Scenario: One onboarding notification never nags

- GIVEN a verified canonical User and normalized ACP origin have no authoritatively discovered Enterprise Agent
- WHEN discovery completes for the first time in a browser profile
- THEN discovery atomically persists the local prompted marker and creates one unread notification that opens onboarding
- AND rendering Start or opening the wizard does not create an additional notification
- AND read, dismiss, reload, sign-out/sign-in, discovery failure, or continued non-use never creates a second notification in that scope
- AND an unknown identity creates no notification state

### Requirement: Client-Side Outbound Secret Review

The Browser Extension SHALL inspect user-authored Enterprise Assistant messages, ordinary Session messages, and new-Session prompts locally before network submission as defense in depth.

#### Scenario: Potential secret requires an explicit disposition

- GIVEN outbound text matches a configured credential pattern
- WHEN the user attempts to submit it
- THEN the Browser Extension identifies only the detected credential types without rendering or logging the matched values
- AND offers `Redact & Send`, `Send Anyway`, and `Cancel`
- AND `Redact & Send` replaces each merged matching range with `[REDACTED]` before submission
- AND `Send Anyway` submits the original text only after that explicit action
- AND `Cancel` sends nothing and preserves the editable input

#### Scenario: Non-matching text follows the existing send path

- GIVEN outbound text matches no configured credential pattern
- WHEN the user submits it
- THEN the existing single-submit and ambiguous-failure rules remain unchanged

### Requirement: Persistent Enterprise Assistant Surface
The Browser Extension SHALL render exactly one durable Agent-backed Enterprise Assistant region before and outside the ordinary Session list.

#### Scenario: Enterprise Assistant identity remains prominent
- GIVEN ACP access is configured
- WHEN the side panel renders with zero or more ordinary Sessions
- THEN the Enterprise Assistant region appears before every ordinary Session card
- AND it shows the server-discovered Agent identity and an accessible `Ready`, `Working`, `Needs input`, `Set up`, or `Unavailable` state
- AND it exposes no ordinary Start, Stop, or Delete control
- AND Restart is its only runtime lifecycle control

#### Scenario: Setup and failure remain independently recoverable
- GIVEN no canonical Enterprise Agent is discovered or discovered state cannot be verified
- WHEN the Enterprise Assistant region renders
- THEN the region remains visible with the onboarding `Start` and `Skip for now` actions or actionable recovery guidance, as appropriate
- AND ordinary Session loading and actions remain available
- AND error details are escaped, bounded, and associated with the affected control for assistive technology

#### Scenario: Bound composer remains available
- GIVEN an Enterprise Agent is authoritatively discovered
- WHEN its runtime Session is ready, working, waiting for input, or unavailable
- THEN its labeled multiline composer remains visible in the Enterprise Assistant region
- AND a temporarily unavailable composer is disabled without discarding its draft

#### Scenario: Customized memory readiness controls status and composer

- GIVEN the customized Enterprise Agent has both memory facets disabled and readiness `not-configured`, or has an enabled facet and readiness `ready`
- WHEN the Enterprise Assistant region renders without an active runtime
- THEN its accessible state is `Ready` and its composer is enabled
- GIVEN the customized Enterprise Agent has an enabled facet and readiness `provisioning`
- AND no active Enterprise Assistant Session exists
- WHEN the Enterprise Assistant region renders
- THEN its accessible state is `Set up`, its composer remains visible but disabled with its draft preserved, and it never presents `Ready` or permits Agent Start or message submission
- AND it shows an accessible single-flight `Retry` status action that performs only one fresh authenticated-self GET and cannot mutate desired state
- GIVEN the customized Enterprise Agent has an enabled facet and readiness `failed`
- AND no active Enterprise Assistant Session exists
- WHEN the Enterprise Assistant region renders
- THEN its accessible state is `Unavailable`, its composer remains visible but disabled with its draft preserved, and it never presents `Ready` or permits Agent Start or message submission
- AND it presents the bounded `memory_failure` message plus `Retry` when `retryable` is true, honors a valid `retry_after`, and uses a fresh preview, current `If-Match`, and final authenticated-self GET, or presents non-retryable repair guidance otherwise
- AND Agent Start responses `MANAGED_MEMORY_NOT_READY` and `MANAGED_MEMORY_FAILED` converge on the same respective states without creating or assuming a Session

#### Scenario: Existing Session remains usable during future-memory changes

- GIVEN an active Enterprise Assistant Session has an immutable launch snapshot and ordinary Session phase that permits messaging
- WHEN the Enterprise Agent's current memory readiness is `provisioning` or `failed` after that Session started
- THEN the visible runtime state remains `Ready`, `Working`, or `Needs input` according to the ordinary Session phase and activity rather than being replaced by `Set up` or `Unavailable`
- AND any `Ready` label explicitly describes the existing Session and does not imply that Restart or another new Session can start
- AND the existing Session composer and send path remain governed by that Session's immutable launch snapshot and ordinary phase and stay usable
- AND the surface presents current memory provisioning or failure as a secondary notice that applies to future Sessions without claiming the active Session gained or lost memory
- AND Restart and any other new Agent Start remain unavailable until current authoritative readiness permits creation of a new Session
- AND memory Retry or repair leaves the active Session, transcript, draft, and snapshotted capability unchanged

#### Scenario: Enterprise Assistant reader position is retained
- GIVEN initial Enterprise Assistant history is displayed for the first time
- WHEN the transcript renders
- THEN the transcript follows the newest content
- GIVEN the reader is at any transcript position
- WHEN the user submits an Enterprise Assistant turn
- THEN the transcript follows the newest content
- GIVEN the Enterprise Assistant transcript is within 24 CSS pixels of its bottom
- WHEN assistant content is appended
- THEN the transcript follows the newest content
- GIVEN the reader has scrolled more than 24 CSS pixels from the bottom
- WHEN status polling or appended assistant content rerenders the Enterprise Assistant transcript
- THEN the prior `scrollTop` reader position is restored
- AND ordinary Session chat scrolling behavior is unchanged

### Requirement: Enterprise Assistant Discovery and Recovery
The Browser Extension SHALL discover the canonical generated Enterprise Agent and dedicated Project through authenticated `GET /api/ambient/v1/users/me/enterprise-agent`, then revalidate any ordinary Agent-bound runtime Session at startup. It SHALL consume the endpoint's complete `EnterpriseAgentState` Project, sole-owner RoleBinding, Provider, redacted provider-binding, Agent, template key and digest, normalized customization and digest, setup mode, memory configuration, memory readiness, nullable memory failure, and state digest rather than reconstructing generated state from browser-local identifiers or generic Project and Agent list scans. It MAY cache the last verified identifiers and unsent draft only within the normalized ACP-origin, canonical opaque `User.id`, and browser-profile scope, but browser-local state, external issuer/subject, Agent resource name, and display name SHALL NOT be authoritative. The Enterprise Agent's dedicated Project SHALL remain independent of the configured default Project.

#### Scenario: Authenticated self discovery returns the whole generated binding

- GIVEN the Browser Extension has authenticated one canonical User
- WHEN it discovers that User's generated Enterprise Agent
- THEN it sends one authenticated `GET /api/ambient/v1/users/me/enterprise-agent` without `X-Ambient-Project`
- AND accepts generated state only when the returned `EnterpriseAgentState` has complete matching Project, sole-owner RoleBinding, Provider, provider-binding descriptor, Agent, template key and digest, normalized customization and digest, setup mode, memory configuration, memory readiness, nullable memory failure, and state digest
- AND the redacted provider-binding descriptor contains no managed Credential identifier or secret-bearing field
- AND the strong response `ETag` matches the state digest and is retained only as the conditional validator for a later confirmed customization
- AND HTTP 404 `enterprise_agent_not_found` presents onboarding without a generic Project or Agent scan
- AND HTTP 409 `enterprise_agent_conflict` or any partial, inconsistent, unauthorized, or malformed state presents `Unavailable` without adopting a cached binding or making a write

#### Scenario: Enterprise Assistant restored after reopen
- GIVEN ACP has provisioned an Enterprise Agent for the canonical user
- WHEN the side panel opens or reloads
- THEN the Browser Extension obtains exactly one server-owned Agent from the authenticated-self Enterprise Agent composite with the authoritative `ambient-code.io/enterprise-agent/managed="true"` marker and matching template provenance in the canonically owned dedicated Project
- AND adopts its current Session or most recent eligible Agent Session
- AND rejects a `current_session_id` whose Session has a different `agent_id`
- AND restores genuine server messages and the browser-profile-scoped unsent draft
- AND displays a locally submitted initial request for a Session created by this browser profile only as a fallback until the matching persisted human `user` row is available
- AND deduplicates the local fallback against that persisted row so the human task appears exactly once

#### Scenario: Legacy browser-local assistant cache remains local

- GIVEN legacy Personal Assistant browser state can be unambiguously attributed to the current normalized ACP origin, canonical opaque User, browser profile, exact Project, exact Agent, and any referenced exact Session
- AND generated Personal Agent self-service routes never shipped in a deployment
- WHEN the Browser Extension migrates browser-local records
- THEN it treats every legacy generated-state claim as non-authoritative browser-local data and performs no legacy server-resource discovery or migration
- AND it preserves only an equivalent draft, notification, locally submitted task, trusted-startup data, or exact manual binding whose complete applicable scope is proven
- AND a current generated Enterprise Agent binding is established only by the new authenticated-self GET and its complete Enterprise Agent provenance
- AND revalidates every Project, Agent, and Session relationship before use
- AND performs no Project, RoleBinding, Provider, Agent, Session, workload, or managed agentic-memory write as part of browser-state migration
- AND ambiguous, unscoped, conflicting, cross-profile, or unverifiable legacy state is ignored or removed and cannot suppress authenticated discovery or onboarding

#### Scenario: Unshipped legacy self-service is an evidence-backed precondition

- GIVEN ACP deployment and migration gates are evaluated
- WHEN they determine whether generated Personal Agent server migration is required
- THEN repository release history, published OpenAPI and route inventories, and deployment evidence establish that `POST /api/ambient/v1/users/me/personal-agent/preview` and `PUT /api/ambient/v1/users/me/personal-agent` never shipped
- AND migration scope is limited to safely attributable manual bindings and browser-local records
- AND inability to prove that precondition fails closed for audited administrative review rather than guessing at or mutating possible legacy server state

#### Scenario: Manual legacy binding stays manual

- GIVEN a legacy browser profile contains an exact manually selected Project ID and Agent ID that are attributable to the active normalized ACP origin and canonical User
- WHEN current RBAC revalidates access to that exact Project and Agent but the authenticated-self Enterprise Agent composite does not identify it as generated state
- THEN the Browser Extension may preserve it only as a manually selected Enterprise Assistant binding
- AND it labels the binding as manually selected, does not rename it Artoo, does not add or infer generated provenance, setup mode, managed provider entitlement, or managed agentic-memory state, and does not migrate it into a generated-state cache key
- AND the manual binding does not suppress authenticated-self generated-state discovery or authorize a Project, Agent, provider, or managed agentic-memory write

#### Scenario: Per-key local migration is interrupt-safe

- GIVEN one or more safely attributable legacy browser-local records need migration
- WHEN migration processes a legacy key
- THEN it validates and writes the complete replacement record under its final scoped key before deleting only that exact legacy key
- AND each key migration is idempotent, so interruption before or after either storage operation leaves an old or new record that a later run can safely revalidate and converge
- AND conflicting old and new values fail closed rather than being merged across scopes
- AND migration never clears a storage area, deletes unrelated ordinary Session or vTeam state, or treats a partially written record as authoritative

#### Scenario: Server binding is portable but drafts are not
- GIVEN the same user opens ACP in another browser profile or device
- WHEN authenticated Enterprise Agent discovery completes there
- THEN the Browser Extension restores the canonical server-owned Enterprise Agent and dedicated Project
- AND does not infer that binding from Agent name or transfer an unsent draft, notification state, or trusted-startup digest from another browser profile

#### Scenario: Enterprise Assistant runtime is not an ordinary Session card
- GIVEN the discovered Enterprise Agent has one or more Sessions
- WHEN the ordinary Session list renders
- THEN it excludes only Sessions whose `agent_id` exactly equals the discovered Agent ID
- AND a same-named Session with a different or absent `agent_id` remains visible

#### Scenario: Bootstrap is platform context rather than user conversation
- GIVEN Session history contains a trusted `bootstrap` SessionMessage
- AND Session history contains a human-authored task
- WHEN the Enterprise Assistant or ordinary Session transcript renders
- THEN the Browser Extension presents it only within a collapsed `ACP startup context` disclosure
- AND never labels or styles the bootstrap row as `You`
- AND the genuine human task remains visible exactly once as a user-authored turn

#### Scenario: Legacy startup context uses exact-digest fallback
- GIVEN a legacy Session stores platform startup context as a `user` SessionMessage
- WHEN that complete row has an exact SHA-256 digest match to trusted startup context previously observed by this browser profile
- THEN the Browser Extension may hide it from ordinary conversation or expose it through `ACP startup context`
- AND an unknown, untrusted, or merely similar user message remains visible as user-authored text

### Requirement: Enterprise Assistant Messaging and Restart
The Browser Extension SHALL route Enterprise Assistant turns through the discovered Agent's current Session and SHALL make Restart create a distinct clean Session without claiming provider-context resume.

#### Scenario: Send through an active Enterprise Assistant Session
- GIVEN the discovered Agent has an active Session owned by that Agent
- WHEN the user submits an Enterprise Assistant turn
- THEN the Browser Extension posts the turn once to that Session
- AND preserves the draft and an actionable error if delivery is ambiguous or fails
- AND never automatically retries an ambiguous message POST

#### Scenario: First turn starts the Enterprise Assistant
- GIVEN the discovered Agent has no active Session
- WHEN the user submits the first turn
- THEN the Browser Extension starts that Agent with the turn under the bound dedicated Project scope
- AND validates that the returned Session has the discovered Agent's `agent_id`
- AND renders the one persisted human `user` task separately from the trusted `bootstrap` startup context
- AND never posts the first turn again based on prompt content or digest comparison

#### Scenario: Restart creates clean visible context
- GIVEN an Enterprise Agent is authoritatively discovered
- WHEN the user confirms Restart
- THEN the Browser Extension stops its active Session when one exists
- AND waits until that Session is terminal
- AND starts the Agent and accepts only HTTP 201 with a distinct new Session ID as a clean replacement
- AND clears the visible Enterprise Assistant transcript and draft only after the replacement Session is confirmed to belong to the Agent
- AND does not delete the previous Session or claim to resume its provider context

#### Scenario: Restart failure preserves context
- GIVEN an Enterprise Assistant transcript or draft is visible
- WHEN stopping fails, terminal state is not reached, Agent start fails, HTTP 200 reports a competing Session, or ownership validation fails
- THEN the existing transcript and draft remain visible
- AND the Enterprise Assistant reports an actionable failure without disrupting ordinary Sessions

### Requirement: Session Lifecycle Actions
The Browser Extension SHALL allow users to create, start, stop, delete, and open chat for ordinary Sessions according to ACP lifecycle rules.

#### Scenario: Create session
- GIVEN the Browser Extension is connected to a project
- WHEN the user submits a Session name, model, repository URL, and initial prompt
- THEN it creates a Session through the existing ACP Sessions API
- AND the new Session appears in the ordinary Session list

#### Scenario: Start only when startable
- GIVEN an ordinary Session is in an empty phase, `Stopped`, `Failed`, or `Completed`
- WHEN its card renders
- THEN Start is available
- AND Start is unavailable for `Pending`, `Creating`, `Running`, or `Stopping`

#### Scenario: Refetch before start
- GIVEN local state shows an ordinary Session as startable
- WHEN the user activates Start
- THEN the Browser Extension refetches that Session before calling start
- AND does not call start if the server now reports a non-startable phase
- AND updates the card to the server-reported phase

#### Scenario: Stop only from active phases
- GIVEN an ordinary Session is `Pending`, `Creating`, or `Running`
- WHEN its card renders
- THEN Stop is available and requires confirmation
- GIVEN an ordinary Session is `Stopping`
- WHEN its card renders
- THEN Stop is unavailable and cannot be invoked again

#### Scenario: Delete confirmation
- GIVEN an ordinary Session is not in `Pending`, `Creating`, `Running`, or `Stopping`
- WHEN the user activates Delete
- THEN the Browser Extension asks for confirmation before deleting the Session

### Requirement: Root-Mediated vTeam Chat
The Browser Extension SHALL offer `Chat with the vTeam` as a distinct persistent Amber-backed conversation whose active run is one coordinator Session in the authenticated user's exact catalog-bound product-swarm Project. The user-visible conversation SHALL remain one ordinary human-and-coordinator Session transcript rather than claiming a true multi-Agent-writer group Session.

#### Scenario: Resolve the exact coordinator
- GIVEN the user selects `Chat with the vTeam`
- WHEN the Browser Extension discovers the target
- THEN it requires one canonical authenticated ACP User response from `GET /api/ambient/v1/users/me` and reads only its stable opaque `User.id` for vTeam identity binding
- AND it normalizes the configured ACP URL to its serialized origin with canonical scheme and host, default port elided, and no credentials, path, query, fragment, or trailing slash
- AND it computes the Project name from the UTF-8 bytes `vteam-<lowercase RFC 4648 Base32(SHA-256(normalized ACP origin + NUL + User.id + NUL + "ambient-code/vteam/product-swarm"))>` without Base32 padding
- AND it requires exactly one Project with that exact name and `annotations["vteam.acp.dev/key"]="ambient-code/vteam/product-swarm"`
- AND it resolves the referenced Role and requires exactly one active `project:owner` RoleBinding between that Project and the exact opaque `User.id`
- AND within that Project it requires exactly one Agent whose name is exactly `amber`
- AND proves each exactly-one Project, owner-binding, and Agent result through a bounded complete traversal or an authoritative exact server filter and total
- AND any partial page, traversal cap, authorization error, or ambiguous total fails closed before a binding or write
- AND it uses the discovered Project ID and Agent ID rather than a partial name, catalog label alone, list position, or configured-default-project substitute
- AND it never derives the binding from username, email address, bearer-token bytes, or OIDC subject

#### Scenario: Missing or ambiguous catalog state makes no write
- GIVEN authenticated-self resolution fails, or the derived Project, catalog key, canonical matching owner binding, or Amber Agent is absent or has more than one exact match
- WHEN the user attempts to start vTeam chat
- THEN the Browser Extension performs no Agent start, Session message, or other ACP write
- AND a missing, malformed, or ambiguous authenticated-self response fails closed with an identity-resolution error and no fallback-derived Project name
- AND when authoritative discovery proves the derived Project is absent, it displays `acpctl apply -k examples/vteam-catalog/product-swarm --project <derived-vteam-project>` with the complete derived Project name substituted
- AND when the Project exists but catalog, owner-role, Amber, or runtime validation fails, it reports administrative repair without offering an install that could mutate that Project
- AND leaves the configured default project and any active Enterprise Assistant or ordinary chat unchanged

#### Scenario: Amber runtime is explicit and provider-safe
- GIVEN exact User, Project, owner-role, and Amber discovery succeeded
- WHEN the Browser Extension validates the coordinator before any write
- THEN Amber declares `runner_type=gemini-cli`
- AND Agent Start returns a Session whose immutable `runner_type` is also `gemini-cli`
- AND an unsupported, missing, or Anthropic coordinator runtime fails closed without Agent Start or Session-message writes
- AND the extension never receives Vertex or managed inference credential material
- AND peer child Sessions use their own Agent runtime selectors rather than inheriting Amber's runtime

#### Scenario: A new coordinator Session owns the initial turn
- GIVEN exact Project and Amber Agent discovery succeeded
- WHEN the user submits the initial vTeam prompt
- THEN the Browser Extension sends that prompt in the exact Amber Agent Start request under the discovered vTeam project scope
- AND requires an HTTP 201 response whose Session belongs to that Agent and Project
- AND opens the returned Session as the vTeam chat
- AND does not append the initial prompt again as a normal Session message

#### Scenario: An existing coordinator Session receives one follow-up turn
- GIVEN exact Project and Amber Agent discovery succeeded
- WHEN the user submits the vTeam prompt
- AND the prompt-bearing Agent Start request returns an existing active Amber Session with HTTP 200
- THEN the Browser Extension validates that the returned Session belongs to the exact Amber Agent and vTeam Project
- AND appends the prompt exactly once as a normal `user` SessionMessage in that Session
- AND opens that Session without creating a duplicate coordinator or duplicate prompt

#### Scenario: Cross-project scope follows the active vTeam chat
- GIVEN the configured default project differs from the discovered vTeam Project
- WHEN the Browser Extension starts or resumes vTeam chat, loads or sends messages, or watches the coordinator Session
- THEN Agent reads and Start plus Session confirmation, message load, message send, and stream requests use `X-Ambient-Project` with the discovered vTeam Project ID where those endpoints accept project selection
- AND Project and Agent path IDs, Session response `project_id`, Agent response ownership, and Session message targets MUST agree with that Project ID
- AND global authenticated-User and Project discovery requests do not borrow the configured default-project header
- AND the active chat retains that Project ID for subsequent reads, writes, and stream requests
- AND the configured default project remains unchanged for Enterprise Assistant and ordinary Session operations

#### Scenario: Reload resumes the same coordinator conversation
- GIVEN the browser profile has an active validated Amber coordinator Session
- WHEN the side panel closes, reloads, or reopens
- THEN the Browser Extension restores the vTeam Project and coordinator Session only within the current opaque ACP User, ACP-origin, and browser-profile scope
- AND revalidates the exact User, catalog key, project-owner binding, Agent, and Session ownership before loading messages
- AND restores the same transcript without starting another Session or reposting a prompt

#### Scenario: A later coordinator run is a distinct Session
- GIVEN the prior Amber coordinator Session is terminal and retained as history
- WHEN the user next starts `Chat with the vTeam`
- THEN Agent Start creates a distinct Amber Session under the same vTeam Project
- AND the Browser Extension replaces its active vTeam binding only after validating the new Session
- AND the prior coordinator and child Session lineage remains unchanged and inspectable

#### Scenario: Delegation is bounded and one hop
- GIVEN Amber receives a user turn in the coordinator Session
- WHEN specialist input is useful
- THEN Amber resolves peers through ACP MCP `list_agents` in the exact vTeam Project
- AND selects zero to three existing peer Agents
- AND creates at most one child Session per selected peer through ACP MCP `create_session` using the peer's exact Agent ID and `parent_session_id` equal to the Amber Session ID
- AND each child prompt forbids further delegation
- AND Amber watches each child Session only to a terminal response or bounded timeout
- AND Amber does not call `push_message` on its own Session to perform delegation

#### Scenario: Child fan-out uses ordinary provisioning
- GIVEN Amber delegates a turn to one or more peer Agents
- WHEN the child Sessions are created and started
- THEN they use the platform's ordinary Session and sandbox provisioning paths
- AND the Browser Extension presents actual progress without promising immediate or warm-start completion
- AND this MVP does not reserve or maintain a per-project warm Session or sandbox pool

#### Scenario: Amber synthesizes one attributed response
- GIVEN zero or more peer child Sessions completed, failed, or timed out for a user turn
- WHEN Amber answers the user
- THEN it emits one concise coordinator response in the Amber Session
- AND names every consulted Agent and attributes the material contribution or failure of each
- AND explicitly states when no peer was consulted
- AND does not present a failed or timed-out consultation as successful consensus

#### Scenario: Peer transcripts remain separate
- GIVEN Amber delegated a turn to one or more peer child Sessions
- WHEN the Browser Extension renders the user-visible vTeam conversation
- THEN the ordinary transcript contains the user's turns and Amber's synthesized responses from the coordinator Session
- AND does not interleave peer Session messages as if multiple Agents wrote the coordinator Session
- AND child Session lineage MAY be available through a separate disclosure
- AND the interface does not describe Amber as the product-swarm root or alter Stella's reporting position

### Requirement: Chat Transcript
The Browser Extension SHALL provide a conversation-focused chat view for an ordinary Session using persisted SessionMessages.

#### Scenario: Load visible conversation messages
- GIVEN an ordinary Session has persisted messages
- WHEN the user opens chat
- THEN the Browser Extension loads `GET /api/ambient/v1/sessions/{id}/messages?after_seq=0`
- AND renders visible user and assistant messages as transcript entries

#### Scenario: Hide non-conversation lifecycle rows
- GIVEN message history includes lifecycle or system-hook events
- WHEN the transcript renders
- THEN rows such as `run started` and `run finished` are not displayed as conversation messages
- AND hidden rows still advance the polling cursor

#### Scenario: Bootstrap is not rendered as You
- GIVEN ordinary Session history includes a `bootstrap` SessionMessage
- WHEN the chat transcript renders
- THEN the bootstrap is omitted from ordinary human bubbles
- AND an `ACP startup context` disclosure remains available for explicit inspection
- AND genuine `user` messages continue to render as `You`

#### Scenario: Localized message timestamps
- GIVEN a visible SessionMessage has a creation timestamp
- WHEN it renders
- THEN it shows a localized timestamp with seconds and the browser's local timezone

#### Scenario: Send and poll without duplication
- GIVEN the chat input contains text
- WHEN the user presses Enter
- THEN the Browser Extension sends the message immediately
- AND Shift+Enter inserts a newline
- AND subsequent `after_seq=N` polling appends new visible messages without duplicating prior messages

### Requirement: Attention Notifications
The Browser Extension SHALL surface attention-required events through a bounded header-bell popover and SHALL keep routine lifecycle feedback away from composers.

#### Scenario: Routine session stops are quiet
- GIVEN a Session changes from an active phase to `Stopped`
- WHEN the Browser Extension detects the change
- THEN it creates no in-panel or browser notification
- AND removes previously stored `ACP session stopped` notifications during normalization
- AND `Completed`, `Failed`, and input-needed events remain eligible for notifications

#### Scenario: Alerts stay out of the composer
- GIVEN unread notifications exist
- WHEN the list view renders
- THEN the header bell shows the unread count without opening the popover
- AND activating the bell opens a bounded top-layer popover that does not change the Enterprise Assistant's document position
- AND Escape, outside activation, Close, and Mark all read dismiss it
- AND explicit Close restores focus to the bell
- AND transient status feedback replaces prior status instead of stacking over an input control

#### Scenario: Alert popover exposes empty and read history states
- GIVEN no normalized notification history exists
- WHEN the user activates the bell
- THEN the popover opens and displays `No alerts yet`
- GIVEN normalized history exists and every row is read
- WHEN the user activates the bell
- THEN all recent rows render newest first
- AND the popover displays `No unread alerts`
- AND Mark all read is not offered

#### Scenario: Badge counts unread rows
- GIVEN normalized notification history contains unread rows
- WHEN the bell and rows render
- THEN the popover includes all recent read and unread rows newest first
- AND the bell opens without automatically changing read state
- AND the badge, accessible name, and tooltip report the number of unread rows rather than summed occurrences
- AND each coalesced row separately displays its own `N occurrences` count
- AND Mark all read is offered only while an unread row exists

#### Scenario: Repeated alerts coalesce
- GIVEN an unread alert exists for an attention key composed from kind and Session ID, or a safe fallback
- WHEN the same attention event occurs again
- THEN that unread row receives the latest timestamp and body and increments its occurrence count
- AND a later occurrence after mark-read creates a new unread row
- AND normalized local notification history never exceeds 50 records

#### Scenario: Enterprise Assistant input-needed deep link
- GIVEN an input-needed alert identifies the discovered Enterprise Agent's current Session
- WHEN the user activates that alert
- THEN the alert is marked read
- AND the Enterprise Assistant region is brought into view
- AND its labeled composer receives keyboard focus without clearing its draft

### Requirement: Authentication and Local Storage
The Browser Extension SHALL keep configuration, account-scoped Enterprise Assistant cache state, notifications, and the selected mode's token material in browser-local storage without exposing credentials in logs, errors, screenshots, or rendered output.

#### Scenario: Token stored locally but not rehydrated in cleartext
- GIVEN the user saves a bearer token
- WHEN the Browser Extension is reopened
- THEN the token is available for API calls without re-entry
- AND Settings exposes only a masked saved-token state and a replace-token control
- AND the stored token value is never rehydrated into a rendered form field

#### Scenario: Authentication and server failures are redacted
- GIVEN a token is invalid, expired, or repeated in an arbitrary server error body
- WHEN an ACP request fails
- THEN the Browser Extension presents generic, actionable failure text
- AND the token value is absent from rendered output, logs, and QA evidence

#### Scenario: Legacy or corrupt local state cannot cross scopes
- GIVEN stored Enterprise Assistant or notification state is unscoped, malformed, or cannot be attributed to the current canonical User, normalized ACP origin, browser profile, exact Project, exact Agent, and exact Session where applicable
- WHEN the Browser Extension loads local state
- THEN it reuses only safely attributable records whose complete applicable scope can be proven from ACP-authenticated identity and authoritative server relationships without exposing token material
- AND unverified local parsing of bearer-token claims is not sufficient to equate accounts
- AND ignores or removes unsafe records and presents Set up rather than applying them to the current scope

#### Scenario: Stable OIDC account scope survives token rotation
- GIVEN `Sign in with ACP` succeeds for an ACP-advertised issuer and validated UserInfo subject
- WHEN access or rotating refresh tokens change
- THEN the stable account identity is the exact validated issuer string plus validated `sub`, with issuer comparison performed by code-point equality and without Unicode normalization
- AND generic authentication records may use that external account identity only within the configured ACP origin and browser-profile scope
- AND the one-shot onboarding marker is scoped by normalized ACP origin, canonical opaque `User.id`, and browser profile without requiring an Enterprise Agent Project to exist
- AND the Enterprise Assistant onboarding marker, generated binding cache, and draft are keyed independently of the configured workspace Project by normalized ACP origin, canonical opaque `User.id`, and browser profile
- AND cached dedicated Project and Agent IDs are revalidated values within that account-scoped record rather than storage-key authority
- AND notification history is scoped by normalized ACP origin, canonical opaque `User.id`, and browser profile, while every operational notification also retains its exact source Project and Session for authorization and deep linking
- AND no notification, binding, or draft crosses an ACP-origin, canonical-User, Project, Agent, Session, or browser-profile boundary that applies to that record
- AND token bytes, display claims, or a mutable access token are not used as account identity

#### Scenario: OIDC token refresh is bounded and credential-safe
- GIVEN an OIDC access token is within 60 seconds of expiry and the current token set has a refresh token
- WHEN one or more ACP requests require authorization
- THEN the Browser Extension performs one single-flight refresh and adopts the rotated token set atomically
- AND retains the current refresh token when a successful refresh response omits a replacement refresh token
- AND fully validates any new ID token before adopting the response
- AND retries at most one failed idempotent GET after refresh
- AND does not automatically retry a non-idempotent request
- WHEN refresh fails with `invalid_grant`
- THEN it clears the OIDC token set, preserves the ACP origin, project, and non-secret discovered authentication metadata, and returns to the signed-out state with a `Sign in` action
- WHEN refresh instead fails because of a network, server, malformed-response, or token-validation error
- THEN the previous complete token set remains unchanged and the request fails credential-safely
- AND no authorization code or PKCE verifier is persisted
- AND no token or UserInfo payload appears in logs, errors, screenshots, or retained QA evidence

#### Scenario: Expiry without a refresh token uses bounded silent authorization
- GIVEN an OIDC access token is within 60 seconds of expiry and no refresh token was issued
- WHEN an ACP request requires authorization
- THEN the Browser Extension does not attempt a refresh-token grant
- AND performs at most one non-interactive Authorization Code with PKCE attempt with `prompt=none`
- AND atomically adopts the validated token set when that attempt succeeds
- WHEN the attempt requires interaction or fails
- THEN the request fails credential-safely and the side panel presents the explicit `Sign in` or `Retry` action without opening an interactive authorization page
- AND latches that token and authentication state as requiring user action so polling and later ACP requests start no additional silent flow until the user activates `Sign in` or `Retry` or intentionally replaces the authentication configuration

### Requirement: Existing ACP API Contract
The Browser Extension SHALL use ACP's public authentication-configuration endpoint plus the authenticated-self User and Enterprise Agent composite, Agent-provisioning, Project, Role, RoleBinding, Agent, Session, and SessionMessage REST contracts with project-scoped authorization and SHALL introduce no browser-extension-specific backend endpoint.

#### Scenario: Public authentication bootstrap
- GIVEN the Browser Extension has permission to access the configured ACP origin
- WHEN it prepares `Sign in with ACP`
- THEN it reads only public, non-user-specific OIDC and client metadata from `GET /api/ambient/v1/auth/configuration` without bearer authorization
- AND that response contains no client secret, token, cookie, user claim, or delegated credential
- AND every other user or project operation still requires the selected mode's bearer authorization

#### Scenario: Read paths
- GIVEN the Browser Extension is connected
- WHEN it needs authenticated identity, Projects, Roles, RoleBindings, Agents, Sessions, or SessionMessages
- THEN it uses ACP REST read endpoints with the active caller's bearer authorization
- AND generated Enterprise Agent discovery uses the authenticated-self Enterprise Agent GET and its complete redacted composite rather than client-side list joining
- AND supplies the active Project header only to endpoints that accept project selection
- AND it does not use a platform service-account token or backend proxy

#### Scenario: Write paths
- GIVEN the user provisions an Enterprise Agent, starts an Agent, manages an ordinary Session, or sends a message
- WHEN the Browser Extension performs the action
- THEN it uses the generic ACP REST write endpoint for that action
- AND Enterprise Agent preview and provisioning use the generic authenticated Agent-provisioning operations rather than client-orchestrated Project, RoleBinding, and Agent writes
- AND handles non-2xx responses as credential-safe user-visible errors

### Requirement: Deterministic Runtime Package
The Browser Extension SHALL produce a deterministic, runtime-only ZIP and matching SHA-256 checksum from a clean staged tree.

#### Scenario: Runtime-only archive is reproducible
- GIVEN the same tracked runtime sources and package version
- WHEN two clean package builds run
- THEN both ZIP files are byte-identical and have the same SHA-256 digest
- AND the archive contains only `manifest.json`, `index.html`, `app.js`, `background.js`, `styles.css`, `lib/security.js`, `lib/kind-connections.js`, `lib/personal-assistant.js`, and referenced `icons/*.png` at their declared relative paths
- AND normalized timestamps and modes do not vary with the build host

#### Scenario: Release version changes staged output only
- GIVEN a valid Chrome extension version is supplied for a release candidate
- WHEN the package is built
- THEN that version appears in the staged manifest and extracted ZIP
- AND tracked source files remain unchanged
- AND packaging fails if the requested version violates Chrome's extension-version grammar

#### Scenario: Artifact verifier rejects drift
- GIVEN a staged tree or ZIP contains a symlink, unexpected entry, missing manifest reference, non-root layout, package/source-manifest version drift, release-version mismatch, or checksum mismatch
- WHEN artifact verification runs
- THEN verification exits nonzero and identifies the violated invariant

### Requirement: Extracted-Artifact Browser QA
The Browser Extension SHALL provide deterministic mock QA and fail-closed live ACP QA that both load the verified extracted package rather than the source tree.

#### Scenario: Mock CI mode requires no ACP credentials
- GIVEN the verified ZIP has been extracted to a clean directory
- WHEN mock browser QA runs in CI
- THEN it supplies a deterministic local ACP mock
- AND exercises fresh-user Start through customized preview, `If-None-Match: *`, and final GET; Enterprise Assistant Skip onboarding; single-flight pending and failure states; stale Skip 412 and 422 recovery; Artoo starter provisioning and server-derived memory notices; nullable memory-failure validation; active-Session continuity while future memory is provisioning or failed; customization; authenticated-self cross-profile discovery; browser-local cache and manual-binding migration; recovery; messaging; restart; notification deep linking; ordinary Session lifecycle; vTeam reachability; chat; permission; ACP metadata discovery; silent SSO reuse; explicit interactive sign-in; validation failure; token refresh; and sign-out scenarios
- AND verifies the service worker and toolbar-to-side-panel behavior
- AND checks Start, Skip, helper text, busy and error feedback, memory copy, customization review, ordinary Session controls, and `Chat with the vTeam` at 320, 375, 420, and 560 CSS-pixel widths plus a short-height viewport in both light and dark themes for target size, contrast, accessible focus, usable scrolling, and no viewport escape
- AND fails on any page or worker console error

#### Scenario: Authoritative QA uses the exact package
- GIVEN one checksum-verified Browser Extension ZIP has been extracted to a clean directory
- WHEN the authoritative packaged browser QA runs
- THEN it loads that exact extracted candidate rather than tracked source, a stale unpacked tree, or a rebuilt package
- AND asserts every header control's inline SVG, `currentColor` inheritance, absence of an external icon dependency, action, target size, tooltip, accessible name, focus state, and both persisted theme states
- AND asserts initial, post-send, near-bottom append, detached polling, and detached assistant-append Enterprise Assistant reader behavior at the 24 CSS-pixel boundary
- AND asserts alert empty, all-read, unread, mixed-history, row-count, occurrence-count, mark-read, and focus-restoration behavior
- AND asserts Session projection, order, deduplication, 26-row and 51-row traversal, exact-multiple empty probes below the cap, 20-page cap, later-page retention, and retry behavior
- AND asserts Start and semantic `Skip for now` hierarchy and accessibility, fresh-user customized creation, single-flight pending and failure focus behavior, stale Skip recovery without a false starter claim, canonical Artoo starter provisioning without Session, workload, or managed agentic-memory side effects, authenticated-self full-provenance discovery, redacted composite and nullable memory-failure handling, exact readiness-to-status-and-composer mapping, non-destructive customization, cross-profile discovery, and safely attributable browser-local cache and manual-binding migration
- AND proves provisioning or failed current memory blocks new Agent Start and Restart while an already-active Session retains its ordinary phase status, enabled composer and send path when phase-permitted, transcript, draft, and immutable launch-snapshot behavior
- AND interrupts per-key local migration before and after the replacement write and legacy-key deletion, reruns it, and proves convergence without deleting ordinary Session, vTeam, or unrelated account state
- AND proves ordinary Session controls and `Chat with the vTeam` remain reachable while onboarding is open, Skip is pending or failed, and customization is cancelled or completed
- AND asserts ACP-owned metadata discovery, the absence of issuer and password inputs, `prompt=none` with `interactive: false`, interaction-required fallback without surprise UI, user-activated `interactive: true`, exact registered `chromiumapp.org` callback matching, state, nonce, PKCE validation, exact UserInfo subject matching and mismatch rejection, multi-audience authorized-party validation, federation return, refresh rotation and rollback, no-refresh-token expiry without repeated polling flows, sign-out suppression, local-only sign-out, successful replacement cleanup, failed replacement rollback, active endpoint-permission revocation, onboarding scope, source-Project notification isolation, both legacy-auth migration outcomes including failed-rediscovery permission cleanup, corrupt and cross-scope state rejection, bootstrap attribution, reconnect without duplicate startup rendering, and narrow and short viewports
- AND proves one visible human task, one collapsed startup-context row, and no duplicate initial transcript content across reconnect
- AND fails on any page or worker console error, credential leak, off-origin OIDC endpoint, scroll jump, oversized Session query, or duplicate initial conversation row

#### Scenario: Sanitized evidence records Enterprise Assistant acceptance

- GIVEN authoritative packaged browser QA succeeds
- WHEN it writes `browser-qa.json`
- THEN the existing sanitized summary includes Boolean `checks.enterpriseAssistantStartSkip`, `checks.enterpriseAssistantSelfDiscovery`, `checks.enterpriseAssistantMemoryStates`, `checks.enterpriseAssistantMigration`, `checks.legacyPersonalAgentSelfServiceNeverShipped`, `checks.ordinarySessionContinuity`, and `checks.vteamContinuity`, each true only after its corresponding assertion completes
- AND live QA additionally records Boolean `live.enterpriseAssistantTurnObserved` and `live.ordinarySessionLifecycleObserved` without retaining an ACP origin, User, Project, Agent, Session, managed Credential, token, prompt, response, or managed agentic-memory content
- AND screenshot paths and digests remain an exact allowlist and contain representative onboarding, pending, failure, starter-memory-note, customized-memory-state, ordinary Session, and vTeam-reachability captures in light and dark themes
- AND evidence validation fails closed when any required field, capture, digest, or credential-safety invariant is absent or false

#### Scenario: Live QA fails closed without inputs
- GIVEN any live ACP origin, ordinary-Session project, or credential required by the selected authentication mode is absent
- WHEN live QA is requested
- THEN it exits nonzero with a precise missing-input error
- AND it does not silently switch to mock mode, skip the gate, or borrow another worktree's ACP environment
- AND input validation completes before a browser profile is created or token material is copied
- AND an expected Enterprise Agent ID is optional and never replaces authenticated-self discovery

#### Scenario: Live QA exercises the configured ACP surface
- GIVEN all required live inputs are available
- WHEN live QA loads the verified extracted package
- THEN it authenticates through the selected mode and discovers the Enterprise Agent solely through `GET /api/ambient/v1/users/me/enterprise-agent`
- AND when an optional expected Enterprise Agent ID is supplied, it is used only as an equality oracle against that verified composite and a mismatch fails closed
- AND sends a unique Enterprise Assistant turn and observes the resulting server-persisted conversation
- AND creates a uniquely named ordinary Session, exercises its lifecycle and chat, and verifies the server-observed result
- AND does not scan for or substitute a same-named Agent or Session for authoritative self discovery or an exact identifier match

#### Scenario: Live QA cleans disposable state on every exit
- GIVEN live QA is requested with complete or incomplete inputs
- WHEN live QA succeeds, fails preflight, or fails after browser or ACP activity begins
- THEN it removes the temporary browser profile and locally held token material in a `finally` cleanup path
- AND deletes only ordinary Sessions created by that QA run
- AND leaves the authenticated-self-discovered Enterprise Agent and pre-existing Sessions intact
- AND retained evidence is limited to an allowlisted, credential-free JSON and PNG set

### Requirement: Pre-Tag Release Validation
The platform release workflow SHALL validate and preserve the exact Browser Extension package before it creates a tag or GitHub Release.

#### Scenario: Validated package is released unchanged
- GIVEN the workflow has calculated a platform tag
- WHEN it prepares Browser Extension assets
- THEN it derives the staged manifest version from that tag
- AND builds, checksum-verifies, extracts, and runs mock browser QA against the release candidate before tag creation
- AND attaches that exact tested ZIP and checksum unchanged to the GitHub Release

#### Scenario: Package or QA failure prevents publication
- GIVEN package verification, extraction, credential scanning, or browser QA fails
- WHEN the release workflow evaluates the pre-tag gate
- THEN no tag or GitHub Release is created
- AND the Browser Extension remains outside container-image selection and publication matrices

## vTeam Performance Non-Goal and Follow-up

The MVP makes no warm-start or fast-fan-out latency claim. A later per-Project/runtime-profile pool may target a ready-and-unclaimed reserve above zero, initially one, with identity- and credential-free warm instances, atomic claim, immediate asynchronous replenishment, zero-reserve alert/degraded state, and cold fallback. This follow-up is not an MVP acceptance condition.

## Data Model

No new public ACP entity or browser-specific backend is introduced. Internal Enterprise Assistant configuration, managed agentic-memory attachment, transactional outbox, Session snapshot, and lease persistence are required by the platform contracts but are not browser-owned entities. The Browser Extension consumes public ACP authentication configuration plus the authenticated-self Enterprise Agent composite and existing `User`, `Project`, `RoleBinding`, Platform `Provider`, `Agent`, `Session`, and `SessionMessage` representations and generic non-entity Agent-provisioning operations. The authoritative Enterprise Agent provenance designation is the exact `ambient-code.io/enterprise-agent/managed` Agent annotation and matching template provenance in the canonically owned dedicated Project; a local binding is only a cache. `enterprise-agent` is the reserved Agent resource name, while `Artoo` is the starter display name and neither value creates a distinct public entity or runtime type. Default starter provisioning creates no Session, workload, or managed agentic-memory attachment. Every run remains an ordinary Agent-bound Session linked by `agent_id`, with no Enterprise Agent Session type or required Session annotation. vTeam chat uses one ordinary Amber coordinator Session and separate ordinary peer child Sessions linked by existing `parent_session_id`; it is not a group Session. Browser-local state MAY include configuration, cached non-secret ACP authentication metadata, bearer-token material, repository history, notifications, scoped Enterprise Assistant Agent caches, onboarding-prompt state, the validated opaque ACP User ID, a scoped active-chat Project ID and Session ID, locally submitted initial tasks, trusted-startup digests, and unsent drafts. External identity claims may continue to scope general browser-local authentication state, but SHALL NOT determine an Enterprise Assistant or vTeam Project binding.

## API Paths

The Browser Extension SHALL use the following ACP paths:

- `GET /api/ambient/v1/auth/configuration`
- `GET /api/ambient/v1/users/me`
- `GET /api/ambient/v1/users/me/enterprise-agent`
- `POST /api/ambient/v1/users/me/enterprise-agent/preview`
- `PUT /api/ambient/v1/users/me/enterprise-agent`
- `GET /api/ambient/v1/projects`
- `GET /api/ambient/v1/projects/{id}`
- `GET /api/ambient/v1/projects/{id}/role_bindings`
- `GET /api/ambient/v1/projects/{id}/providers`
- `GET /api/ambient/v1/projects/{id}/providers/{provider_id}`
- `GET /api/ambient/v1/roles/{id}`
- `GET /api/ambient/v1/projects/{id}/agents`
- `GET /api/ambient/v1/projects/{id}/agents/{agent_id}`
- `POST /api/ambient/v1/projects/{id}/agents/{agent_id}/start`
- `GET /api/ambient/v1/projects/{id}/agents/{agent_id}/sessions`
- `GET /api/ambient/v1/sessions`
- `POST /api/ambient/v1/sessions`
- `GET /api/ambient/v1/sessions/{id}`
- `POST /api/ambient/v1/sessions/{id}/start`
- `POST /api/ambient/v1/sessions/{id}/stop`
- `DELETE /api/ambient/v1/sessions/{id}`
- `GET /api/ambient/v1/sessions/{id}/messages?after_seq=N`
- `POST /api/ambient/v1/sessions/{id}/messages`

## RBAC and Security

The Browser Extension SHALL rely on the selected mode's bearer authorization and ACP's existing project-scoped RBAC enforcement. A local Kind connection registry is non-authoritative configuration input and SHALL NOT contain or convey authentication material. The authentication-configuration read MAY be unauthenticated because it returns only public, non-user-specific OIDC and public-client metadata. `Sign in with ACP` SHALL supply the validated human OIDC access token; `Bearer token` mode SHALL use only an externally obtained ACP-supported credential with its existing human or service-account identity semantics. Enterprise Agent preview and PUT SHALL be available to every validated human caller mapped server-side to exactly one canonical opaque `User.id`; service accounts, platform services, Session runtimes, delegated subject parameters, and browser-supplied owner IDs SHALL be rejected. Under either mode, vTeam binding SHALL require the exactly-one opaque User ID returned by ACP's authenticated User read plus the exact project-owner RoleBinding; token contents and external identity claims are not authority for that binding. It SHALL send project context only where an ACP endpoint accepts or requires project selection and SHALL NOT treat that header as an authorization boundary; path, body, response ownership, catalog identity, and RBAC MUST agree. It SHALL NOT use a platform service-account token or backend proxy, and SHALL limit browser host access to the two required loopback HTTP patterns plus runtime optional HTTPS permissions and application-level exact-endpoint enforcement for the configured ACP and ACP-advertised authentication endpoints. The manifest SHALL require the `identity` capability for browser-managed authorization and MAY require the capabilities needed for side-panel and local-notification operation, but SHALL NOT require broad non-loopback network host access.

## Migration Plan

`components/browser-extension/` is the canonical Browser Extension component. Enterprise Agent generation adds authenticated-self discovery, non-mutating preview, and atomic provisioning operations but no new public ACP entity or browser-specific backend. Platform-owned typed configuration, managed agentic-memory attachment, transactional outbox, Session snapshot, and lease persistence are explicitly permitted and required by the Enterprise Assistant contracts. New Enterprise Agents use registered `ambient-code.io/` provenance annotations, a dedicated canonical-User-owned Project, and local binding only as a revalidated cache. The Artoo starter is provisioned from the registered template without a managed agentic-memory attachment; Enterprise Assistant onboarding remains the explicit path for configuring managed agentic memory. Deployment, release, OpenAPI, and route evidence establish that generated Personal Agent self-service routes never shipped, so there is no legacy generated server resource set to adopt or migrate. Legacy Personal Assistant migration is limited to per-key, safely attributable browser-local records and exact manually selected bindings; a current generated binding comes only from authenticated-self Enterprise Agent GET. An exact manually selected legacy Agent remains a separately labeled manual binding under current RBAC and is never relabeled, annotated, or cached as generated state. A migrated cache does not suppress authenticated-self discovery, onboarding when no generated Enterprise Agent exists, or the server-derived memory notice. vTeam binding continues to use generic authenticated-self read through `GET /api/ambient/v1/users/me`. The Browser Extension reads the Enterprise Agent composite, the additive `bootstrap` event type, and existing Agent Start, SessionMessage, and Session lineage contracts while preserving exact-digest fallback for immutable legacy startup rows stored as `user`. Existing username-valued RoleBinding subjects SHALL be mapped and migrated server-side to canonical opaque User IDs; a missing or ambiguous legacy mapping fails closed. Existing product-swarm reporting annotations remain authoritative. Ordinary Session controls use the existing direct Session compatibility endpoints; any future removal SHALL migrate the Browser Extension in the same change. Repository build, test, CI, and release surfaces SHALL consume the component's deterministic package and exact extracted-artifact QA contracts. Existing manual server/project configuration remains valid; importing local Kind connections is optional and stores no new authoritative server entity or credential. A legacy user-entered issuer value SHALL NOT remain authoritative after upgrade: `Sign in with ACP` SHALL retain the ACP origin, project, and other non-secret settings, clear legacy OIDC token material, remove the obsolete legacy issuer-origin permission immediately when no active configuration shares it, rediscover authentication metadata from ACP, and make at most one silent authorization attempt unless a scoped local sign-out marker suppresses it. Failed rediscovery presents the signed-out state without restoring the legacy issuer, tokens, or obsolete permission.
