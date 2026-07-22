---
name: full-stack-pipeline
description: >
  Implements spec-driven changes across ACP with field-level gap analysis,
  dependency-ordered waves, parallel work within a wave, and cross-component
  verification. Use for end-to-end features and reconcile execution.
---

# Full-Stack Pipeline

Implement ACP features from the modular spec corpus. This skill provides the
execution pattern used by `/reconcile`; it does not replace the spec registry,
the reconcile checkpoint, or component-owned build and test targets.

## User input

```text
$ARGUMENTS
```

## Authorities

Read these before planning a wave:

1. `specs/index.spec.md` for the spec registry and dependencies.
2. Every applicable platform, security, and UI leaf spec in full.
3. `skills/RECONCILE.md` for current gap IDs and wave state.
4. The affected component's live source, tests, and local guidance.

Do not assume a monolithic `ambient-model.spec.md`; it does not exist.

## Dependency order

```text
Spec registry and applicable leaf specs
  -> OpenAPI contract
  -> SDK generation and verification
  -> API server and control-plane services
  -> CLI, reconciler, and runners
  -> Ambient UI and browser extension
  -> Kind and packaged-browser integration
```

Downstream code must not stabilize against an unsettled upstream contract.
Independent lanes within the same wave should run in parallel.

## Mandatory preflight

Before cluster work, make Docker and the Kind provider explicit, then derive the
reserved cluster identity from the current branch. Never discover a cluster by
grepping container names.

```bash
export CONTAINER_ENGINE=docker
export KIND_EXPERIMENTAL_PROVIDER=docker
export CLUSTER_SLUG="$(git rev-parse --abbrev-ref HEAD 2>/dev/null | \
  tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; \
  s/^-//; s/-$//' | cut -c1-20)"
export KIND_CLUSTER_NAME="ambient-$CLUSTER_SLUG"

git branch --show-current
git status --short
docker info >/dev/null
kind get clusters
kubectl config current-context
make kind-status
```

The Makefile now binds each worktree to exactly `ambient-<branch-slug>` unless
the caller deliberately overrides it. Confirm that `make kind-status` names
that cluster before mutation.

For Enterprise Agent work, `/reconcile` must first implement the protected
administrator bootstrap or designation target described by `/dev-cluster`.
Until that exact repository surface exists, managed-provider integration is
blocked. Do not replace it with generic Credential CRUD, list, apply, binding,
or token-read operations, and do not treat a Credential name as authority.

After bootstrap, verify only through authenticated-self preview and current
state. Require public provider name `enterprise-agent-default`, type `vertex`,
positive designation generation, and non-secret revision with no Credential ID
or material. Missing bootstrap, unavailable self surfaces, or
`managed_provider_unavailable` fails the wave closed.

## Workflow

### Step 1: Read desired state

Extract the following from the applicable specs:

- entities, fields, defaults, and required values;
- relationships, ownership, and authorization boundaries;
- API routes, status codes, and concurrency behavior;
- CLI and UI behavior;
- migration and compatibility requirements;
- observable acceptance scenarios.

Treat design documents and prototypes as evidence, not implemented behavior.

### Step 2: Build a field-level gap table

Check every affected layer:

- API: routes, schemas, defaults, and `required` arrays.
- SDK: generated types, builders, and clients in all supported languages.
- API server: models, migrations, DAOs, handlers, and presenters.
- Control plane: middleware, reconciliation, Jobs, and child resources.
- CLI: commands, arguments, output, and error behavior.
- Runners: startup context, credentials, MCP configuration, and events.
- Ambient UI: ports, adapters, queries, components, and proxy routes.
- Browser extension: runtime, storage migration, package contract, root targets,
  CI gates, and packaged browser scenarios.

Check all three directions for each contract value:

1. Spec to code.
2. Code to spec.
3. OpenAPI to spec.

Record each gap with a stable ID, layer, severity, spec reference, code
reference, and verification gate. Merge it into `skills/RECONCILE.md` when
running through `/reconcile`.

### Step 3: Execute dependency-ordered waves

#### Wave 1: Spec consensus

- Resolve ambiguities and divergences.
- Confirm the gap table and verification gates.
- Freeze the applicable contract for this run.

#### Wave 2: API contract

- Update `components/ambient-api-server/openapi/openapi.yaml`.
- Regenerate API artifacts through the component-owned generator.
- Register routes and add handler seams.
- Require user-token authorization and credential-safe errors.

Acceptance:

```bash
make -C components/ambient-api-server test binary
make lint
```

#### Wave 3: SDKs

- Regenerate Go, Python, and TypeScript clients.
- Verify nested resource paths and URL encoding.
- Keep generated and hand-written extension boundaries explicit.

Acceptance:

```bash
make -C components/ambient-sdk verify-sdk
```

#### Wave 4: API server and control plane

Run independent API server and control-plane gaps in parallel after SDK
verification. Cover migrations, persistence, services, reconciliation, RBAC,
security contexts, and owner references. Run each component's tests, build,
vet, and lint gates.

#### Wave 5: CLI, reconciler, and runners

Run independent lanes in parallel after their upstream contracts stabilize.
Verify CLI behavior, runner configuration, event ordering, and Job behavior.

CLI acceptance:

```bash
make -C components/ambient-cli lint test build
```

Runner acceptance uses the repository's `uv` environment and focused pytest
suite for the changed runtime bridge.

#### Wave 6: Ambient UI and browser extension

Run these consumers in parallel after API behavior stabilizes.

- Ambient UI uses current ports, adapters, queries, and Shadcn components.
- Browser work includes versioned local-state migration and package contracts.
- No client may infer server ownership, readiness, or authorization from local
  browser state.
- Browser acceptance includes keyboard, theme, narrow-width, and failure-path
  scenarios required by the UI spec.

Acceptance:

```bash
cd components/ambient-ui
npm run build

cd ../browser-extension
npm run check
npm run qa:browser
```

#### Wave 7: Integration

- Run root tests and lint for affected surfaces.
- Reload changed cluster components through `/dev-cluster`.
- Reconcile managed port forwards and inspect the connection registry.
- Test the packaged extension against the explicitly selected Kind cluster.
- Run `/ui-audit`, `/align`, and `/acp-review-guidance` as applicable.

Do not treat a build or rollout as the user-facing acceptance gate.

### Step 4: Re-gap after each wave

- Re-run gap analysis for that wave's IDs.
- Retry unresolved implementation gaps up to the reconcile limit.
- Update `skills/RECONCILE.md` with evidence and coverage changes.
- Do not start a downstream wave until upstream verification passes.

## Code generation

Run the Kind generator from the API server component directory:

```bash
cd components/ambient-api-server
go run ./scripts/generator.go \
  --kind Agent \
  --fields "project_id:string:required,name:string:required,prompt:string" \
  --project ambient \
  --repo github.com/ambient-code/platform/components \
  --library github.com/openshift-online/rh-trex-ai
```

For protobuf changes:

```bash
make -C components/ambient-api-server proto
```

Verify generated files and wire every new field through presenters and clients.

## Kind integration

Delegate cluster operations to `/dev-cluster`. With the mandatory environment
still exported, use only the target for the changed component:

```bash
make kind-reload-ambient-api-server
make kind-reload-ambient-control-plane
make kind-reload-ambient-ui
make kind-reload-runner-openshell
make kind-port-forward
make -s kind-connections
```

Do not hand-build or import a reused `latest` tag followed by
`kubectl rollout restart`. The Make targets use unique tags, the correct engine
loading path, Deployment image updates, and rollout waits.

For a new cluster that must run all local component code, use
`make kind-up LOCAL_IMAGES=true`. For an existing cluster, prefer the focused
reload target. Browser-extension changes are not cluster images; run their
package and browser QA gates instead.

## Cross-layer invariants

- All user operations use the authenticated user's token and authorization.
- Tokens and credentials never appear in logs, errors, or responses.
- Child Kubernetes resources have controller owner references.
- Containers use restricted security contexts.
- Persistent state is namespace or project scoped.
- Partial failures propagate; reconciliation never silently skips them.
- Nested path segments are URL encoded in every SDK and UI client.
- Protocol additions are mapped through model, OpenAPI, proto, presenter, SDK,
  CLI, runner, and UI consumers as applicable.
- Browser-local state never substitutes for server-owned identity or readiness.

## Constraints

- One active wave at a time; parallelize independent lanes within it.
- Specs remain frozen during execution unless a divergence returns to Wave 1.
- Use component-owned generators and verification commands.
- Keep changes scoped to the approved gaps and required compatibility work.
- Preserve unrelated worktree changes.
- Never bypass hooks, force-push, push, or merge without authorization.
