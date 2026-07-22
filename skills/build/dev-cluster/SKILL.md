---
name: dev-cluster
description: >
  Manages Ambient Code Platform development clusters (Kind) for testing changes
  locally. Use when deploying changes to Kind, bringing up local clusters,
  rebuilding images, troubleshooting pods, or running benchmarks.
---

# Development Cluster Management

Use the repository Make targets as the cluster operator surface. Do not replace
them with raw `kind`, container-engine, or `kubectl` deployment recipes: the
Make flow also configures ACP secrets, SSO, MinIO, OpenShell tenants, test
credentials, port forwards, and the browser-extension connection registry.

## Mandatory preflight

On macOS, use Docker explicitly. Derive the reserved cluster identity from the
current branch so every worktree operates only on its own cluster.

```bash
export CONTAINER_ENGINE=docker
export KIND_EXPERIMENTAL_PROVIDER=docker
export CLUSTER_SLUG="$(git rev-parse --abbrev-ref HEAD 2>/dev/null | \
  tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; \
  s/^-//; s/-$//' | cut -c1-20)"
export KIND_CLUSTER_NAME="ambient-$CLUSTER_SLUG"

git branch --show-current
docker info >/dev/null
kind version
kind get clusters
kubectl config current-context
make kind-status
```

The Makefile now resolves exactly `ambient-<branch-slug>` unless the caller
deliberately overrides it. Confirm the status output before mutation. Never
infer cluster identity from container names or the first `kind get clusters`
result.

## Cluster lifecycle

```bash
make kind-up                 # Create/deploy with published images
make kind-up LOCAL_IMAGES=true  # Create/build/deploy local images
make kind-status             # Show resolved cluster and deterministic ports
make kind-login              # Start forwards and configure acpctl
make kind-port-forward       # Reconcile managed background forwards
make kind-port-forward-stop  # Stop only this cluster's managed forwards
make kind-down               # Delete the explicitly selected cluster
```

`kind-up` starts managed background port forwards. Re-running
`kind-port-forward` reconciles them; do not use broad `pkill` commands or launch
another unmanaged set in the background.

Test credentials are written to `tests/cypress/.env.test`. Preserve the file as
secret-bearing local state and never print its token in reports.

## Component reloads

The hot-reload targets build a unique image tag, load it into the selected Kind
node, update the Deployment image, and wait for rollout completion.

```bash
make kind-reload-ambient-api-server
make kind-reload-ambient-control-plane
make kind-reload-ambient-ui
make kind-reload-runner-openshell
```

`make kind-rebuild` reloads only the three deployed core services: Ambient UI,
control plane, and API server. It does not rebuild the runner, MCP servers,
credential sidecars, or browser extension. Reload or verify those separately.

Do not hand-roll image import commands. The Makefile owns the Docker loading
path, assigns a unique tag, patches `imagePullPolicy`, and updates all required
containers, including the API server migration container.

## Vertex AI and Enterprise Agent designation

Use Google Application Default Credentials or the explicitly selected
credential file. Never request or configure `ANTHROPIC_API_KEY` for the Vertex
path.

```bash
make kind-setup-vertex \
  VERTEX_CRED="$HOME/.config/gcloud/application_default_credentials.json"
```

The target handles gateway and non-gateway modes. Verify provider declarations
and subsequent session behavior rather than treating command success as proof.
It does not establish the Enterprise Assistant managed-Credential designation.

Prepare ADC for the protected platform bootstrap without printing its contents:

```bash
set -euo pipefail
set +x
export GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/\
application_default_credentials.json"
test -s "$GOOGLE_APPLICATION_CREDENTIALS"
```

Enterprise Assistant Kind setup must use the protected administrator bootstrap
or designation target implemented by `/reconcile`. That surface must consume
the ADC path through protected input and atomically maintain the singleton
`managed_credential_designations` row for logical name
`enterprise-agent-default`, exact provider `vertex`, one immutable Credential
ID, and a positive monotonic generation. Replace this instruction with the
exact repository target or tool when reconcile implements it.

Until that protected surface exists, mark managed-provider setup blocked and
fail closed. Do not invent a command or substitute generic `acpctl credential`
list, get, create, apply, update, bind, token, or delete operations. Credential
name, labels, annotations, ordering, and generic list results are explicitly
non-authoritative and must never select or prove the managed provider.

After protected bootstrap, verify readiness only through the authenticated-self
Enterprise Assistant surfaces:

- `POST /api/ambient/v1/users/me/enterprise-agent/preview` must return a
  provider summary with name `enterprise-agent-default`, type `vertex`, a
  positive `designation_generation`, and a valid non-secret revision.
- Once provisioned, `GET /api/ambient/v1/users/me/enterprise-agent` must return
  the same public provider state without a Credential ID or secret material.

An absent bootstrap tool, unavailable endpoint, `managed_provider_unavailable`,
zero or ambiguous designation, generation mismatch, or any Credential detail in
public state blocks preview, provisioning, and Agent Start tests. Report only
the bounded public readiness result; never inspect or expose the protected
Credential ID or material.

## Testing changes in Kind

### 1. Map changed files to runtime surfaces

```bash
git diff --name-only main...HEAD
```

- `components/ambient-api-server/` -> API server
- `components/ambient-control-plane/` -> control plane
- `components/ambient-ui/` -> Ambient UI
- `components/runners/ambient-runner/` -> OpenShell runner
- `components/browser-extension/` -> packaged browser extension, not a cluster
  image

### 2. Deploy only changed cluster components

Use the component reload targets above. Use `kind-rebuild` only when all three
core services changed. For browser-extension-only work, keep the existing
cluster and run the extension's package and browser QA gates.

### 3. Verify the selected cluster explicitly

```bash
kubectl --context "kind-$KIND_CLUSTER_NAME" get pods -n ambient-code
kubectl --context "kind-$KIND_CLUSTER_NAME" get deployments -n ambient-code
kubectl --context "kind-$KIND_CLUSTER_NAME" \
  get events -n ambient-code --sort-by='.lastTimestamp'
```

For a changed deployment, also run its `kubectl rollout status` command with the
same explicit context.

### 4. Reconcile access and prove reachability

```bash
make kind-port-forward
make -s kind-connections
```

Read the selected connection's `api_url`, `ui_url`, and `ready` fields from the
JSON output. Curl the reported URL and perform the relevant browser workflow
before reporting the environment ready. Do not use `KIND_FWD_*` as shell
variables; they are Make variables and are not exported automatically.

### 5. Run the relevant gates

```bash
make local-test-quick
make test-e2e
```

For browser-extension changes:

```bash
make test-browser-extension
make package-browser-extension
make verify-browser-extension-package
```

Run packaged browser QA as required by the feature spec. A successful image
build or rollout is not a user-facing verification gate.

## Fast frontend loop

Use the maintained dev target; it generates the current `API_SERVER_URL` and SSO
configuration and forwards the API server's actual port.

```bash
make dev COMPONENT=ambient-ui
```

Do not create `.env.local` with the retired `OC_TOKEN` or `BACKEND_URL` recipe.

## Logs and health

```bash
kubectl --context "kind-$KIND_CLUSTER_NAME" logs -f \
  -l app=ambient-api-server -n ambient-code
kubectl --context "kind-$KIND_CLUSTER_NAME" logs -f \
  -l app=ambient-ui -n ambient-code
kubectl --context "kind-$KIND_CLUSTER_NAME" logs -f \
  -l app=ambient-control-plane -n ambient-code
```

Use current labels: `ambient-api-server`, `ambient-ui`, and
`ambient-control-plane`. The old `backend` and `operator` labels do not select
these workloads.

## Troubleshooting

### Image is stale or cannot be pulled

Use the corresponding `kind-reload-*` target. It creates a unique tag and sets
`IfNotPresent`; a plain `kubectl rollout restart` does not prove that new code is
running.

### Pod is crashing

```bash
kubectl --context "kind-$KIND_CLUSTER_NAME" logs \
  -l app=<current-label> -n ambient-code --tail=100
kubectl --context "kind-$KIND_CLUSTER_NAME" describe pod \
  -l app=<current-label> -n ambient-code
```

### MinIO bucket is missing

```bash
make setup-minio
```

Recreate the cluster only when reconciliation cannot repair the root cause.

### Port forwarding is unhealthy

```bash
make kind-port-forward-stop
make kind-port-forward
make -s kind-connections
```

### Cluster identity is surprising

Stop before changing anything. Re-run the branch-derived preflight, compare the
current kube contexts with `make kind-status`, and operate only on the exact
worktree cluster. Use an explicit override only when the user deliberately
selects a different cluster.

## Benchmarking

```bash
make benchmark
make benchmark FORMAT=tsv
make benchmark COMPONENT=ambient-control-plane MODE=cold
```

Prefer `FORMAT=tsv` for agent-readable output.
