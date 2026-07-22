# Browser Extension Reconciliation Evidence

<!-- markdownlint-disable MD013 MD060 -->

Sanitized, repository-portable evidence for reconciling
[`browser-extension.spec.md`](browser-extension.spec.md). This checkpoint records
commands and aggregate results only. It intentionally excludes credentials, ACP
URLs, account identifiers, Agent identifiers, Session identifiers, and untracked
screenshots or logs.

The 2026-07-12 checkpoints below predate the Enterprise Assistant and Artoo
implementation. They remain valid historical Personal Assistant and packaging
baseline evidence, but they are superseded for Enterprise Assistant acceptance
and do not prove Start, Skip, Artoo provisioning, memory boundaries,
cross-profile discovery, or browser-state migration.

## Source and test surfaces

- Runtime: `components/browser-extension/manifest.json`, `background.js`,
  `index.html`, `app.js`, `styles.css`, `lib/kind-connections.js`,
  `lib/personal-assistant.js`, and `lib/security.js`.
- Unit and contract tests: `components/browser-extension/test/*.test.mjs` and
  `.github/scripts/release-browser-extension-contract.test.mjs`.
- Packager and verifier: `components/browser-extension/scripts/build-package.mjs`,
  `package-artifact.mjs`, `verify-package.mjs`, and `zip-store.mjs`.
- Browser QA: `components/browser-extension/scripts/browser-qa.mjs` and
  `browser-qa-watchdog.mjs`.
- Repository integration: root `Makefile`, `.github/workflows/unit-tests.yml`,
  and `.github/workflows/prod-release-deploy.yaml`.

## 2026-07-12 checkpoint

All commands ran from `components/browser-extension/` with Node.js 24.

| Gate | Command | Sanitized result |
|------|---------|------------------|
| Unit tests | `npx --yes node@24.18.0 --test test/*.test.mjs` | PASS, 65 tests passed, 0 failed |
| Package build | `npx --yes node@24.18.0 scripts/build-package.mjs` | PASS, deterministic version `0.1.1` ZIP and checksum produced |
| Package verification | `npx --yes node@24.18.0 scripts/verify-package.mjs` | PASS, runtime allowlist, version, checksum, and archive structure verified |
| Exact artifact digest | `shasum -a 256 dist/acp-session-manager-browser-extension-0.1.1.zip` | `56c219bc44342a4a7d11edbc6d185704ae369dd137bbaa83cf35d14b9834ac3a` |
| Exact-prebuilt mock browser QA | `QA_RUN_ID=post-review-mock npx --yes node@24.18.0 scripts/browser-qa-watchdog.mjs --mode mock --prebuilt-zip dist/acp-session-manager-browser-extension-0.1.1.zip --prebuilt-checksum dist/acp-session-manager-browser-extension-0.1.1.zip.sha256 --expected-version 0.1.1 --extension-dir dist/qa-extracted-post-review` | PASS, exact prebuilt artifact, 22 captures, 5 responsive viewports plus dark mode, 0 page or worker console errors |

The browser QA result also covered the Chrome side-panel action, connection
configuration, optional host permission handling, Session list and ordinary
Session lifecycle, Personal Assistant states and restart flow, transcript
navigation, and notification read/unread states.

## Live ACP gate

The final exact-artifact live gate ran with `QA_RUN_ID=final-post-review-live`
through the root `make test-browser-extension-live` target.

| Gate | Sanitized result |
|------|------------------|
| Exact artifact | PASS, prebuilt version `0.1.1`, SHA-256 `56c219bc44342a4a7d11edbc6d185704ae369dd137bbaa83cf35d14b9834ac3a` |
| Chrome integration | PASS, runtime extension identity matched, side-panel action opened the panel, optional host permission was granted through the native prompt |
| Live ACP Personal Assistant | PASS, restart completed and a causally later assistant reply was observed |
| Live ordinary Session | PASS, create/start/chat/stop/delete lifecycle was observed |
| Responsive and error gate | PASS, 5 responsive viewports plus dark mode, 0 page or worker console errors |
| Cleanup | PASS, run-owned browser/profile state and the disposable ordinary Session were cleaned up |

This gate intentionally used sanitized identifiers and does not preserve the
ACP URL, project, bearer token, Agent identifier, or Session identifiers.
Requirement U22 remains partial because this successful run does not prove
page-independent server cleanup after a deliberate post-create browser crash or
parent watchdog termination.

## 2026-07-12 final closeout checkpoint

This checkpoint is attributable to product/CI commit
`e2a68035d47d00316eae624f769c0ce48ac29f9e`. The branch-owned Kind deployment
used the locally built API server and control plane, including the control-plane
terminal-phase guard at `c63e1a03` and the API-side serialized phase transition
boundary at `db58449a`.

| Gate | Sanitized result |
|------|------------------|
| Unit and security tests | PASS, 68 tests passed, 0 failed |
| Release/CI contracts | PASS, 15 tests passed, including root `Makefile` routing and fail-closed change detection |
| Exact artifact | PASS, prebuilt version `0.1.1`, SHA-256 `ef63e942fe0ed140a7b2fe7e2928d0602414de64b81528512ecde744fcff27d3` |
| Exact-prebuilt mock | PASS, run `final-closeout-mock`, 22 captures, representative CJK content, 5 responsive viewports plus dark mode, 0 page or worker console errors |
| Exact-prebuilt live ACP | PASS, run `final-closeout-live`, native optional-host grant, strict PA ownership confirmation and reply, ordinary create/start/chat/stop/delete lifecycle, 5 responsive viewports plus dark mode, 0 page or worker console errors |
| Control plane | PASS, race/shuffle reconciler and OpenShell tests plus live branch deployment |
| Session phase serialization | PASS, deterministic Stop-versus-status concurrency test repeated 10 times under the race detector; live Stop produced `Stopping`, a later `Failed` status PATCH returned HTTP 409, and the Session remained `Stopping` |

The live gate used a dedicated test PA and intentionally replaced its active
Session. Credentials, URLs, project names, Agent/Session identifiers, browser
profiles, and raw logs are not retained here. U22 remains partial solely for
the page-independent post-create failure cleanup gap described above.

## 2026-07-18 provisioning-only source checkpoint

This dirty-worktree checkpoint proves the buildable API provisioning slice. It
does not claim a live deployment, managed chat, managed inference, or Hindsight
attachment. All API commands ran from `components/ambient-api-server/`.

| Gate | Command | Sanitized result |
|------|---------|------------------|
| PostgreSQL Artoo journey | `go test ./plugins/enterpriseAssistant -run 'TestEnterpriseAssistantCompositeServiceOnPostgres/starter_provisioning_journey_has_no_runtime_side_effects' -count=1 -v` | PASS, selected top-level test and subtest; absent state, preview, conditional create, authoritative final GET, strong ETag, and zero Sessions, messages, schedules, snapshots, leases, memory attachments, and memory outbox rows |
| Enterprise Assistant unit suite | `go test ./plugins/enterpriseAssistant -short -count=1` | PASS |
| Guard and HTTP boundary | `go test ./pkg/enterpriseassistantguard ./pkg/enterpriseassistanthttp -short -count=1` | PASS, both packages |
| OpenAPI contract | `go test ./openapi -run 'EnterpriseAssistant' -count=1 -v` | PASS, 7 top-level tests and 10 subtests |
| Go static analysis | `go vet ./plugins/enterpriseAssistant` | PASS, no diagnostics |
| Focused built-by-QA packaged Skip | `QA_RUN_ID=artoo-skip-contract-5 QA_FOCUS=artoo-skip HEADLESS=1 node scripts/browser-qa-watchdog.mjs --mode mock --extension-dir dist/qa-extracted-artoo-skip-5` | PASS against package digest `e2735485d1fbcb09ea2a69df7a10dc650dcadea34f6dd6c96d4a18057f0203bf`; 12 extracted entries, all Enterprise Assistant rollups true, 14 captures, 0 page/worker errors, and observer counts of 0 Sessions, workloads, and memory attachments |

The focused package summary is retained locally at
`.qa/artoo-skip-contract-5/browser-qa.json` and records
`artifact.prebuilt: false`. It proves the focused extracted-package behavior,
but it is not release-prebuilt acceptance. Further dirty-worktree edits or a
different current ZIP require a fresh exact-candidate run; this checkpoint does
not claim source/package equivalence after the recorded digest.

## Enterprise Assistant evidence contract

No full Enterprise Assistant browser-acceptance checkpoint has been recorded
yet. Add one only after the exact release-prebuilt candidate passes the
Enterprise Assistant browser scenarios. Do not relabel or reuse the historical
Personal Assistant digests above.

A new checkpoint must validate its evidence directory with:

```shell
.github/scripts/validate-browser-extension-evidence.sh \
  "$evidence_dir" "$credential_sentinel" enterprise-assistant-v1 mock
```

Use the same command with final argument `live` for a live checkpoint. CI and
pre-tag release validation require the mock variant explicitly; a historical
legacy summary cannot satisfy either gate.

The summary must set `evidenceSchema` to `enterprise-assistant-v1`. It must add
the seven Boolean rollups required by the Browser Extension specification and the
exact supporting object under `checks`:

```json
{
  "enterpriseAssistantStartSkip": true,
  "enterpriseAssistantSelfDiscovery": true,
  "enterpriseAssistantMemoryStates": true,
  "enterpriseAssistantMigration": true,
  "legacyPersonalAgentSelfServiceNeverShipped": true,
  "ordinarySessionContinuity": true,
  "vteamContinuity": true,
  "enterpriseAssistant": {
    "artooProvisioned": true,
    "crossProfileDiscovery": true,
    "interruptedMigrationResume": true,
    "persistentMemoryNotice": true
  }
}
```

The summary must also contain this sanitized result from the test-only mock
observer or the live environment's read-only admin observer:

```json
{
  "observer": {
    "attribution": "skip-provisioning",
    "kind": "test-only",
    "managedMemoryAttachmentCount": 0,
    "result": "passed",
    "sessionCount": 0,
    "workloadCount": 0
  }
}
```

Live evidence uses `kind: "admin"` and must additionally contain
`live.enterpriseAssistantTurnObserved` and
`live.ordinarySessionLifecycleObserved`, both true. The observer result contains
only the named counts and classification strings. It must never contain a User,
Project, Agent, Session, workload, managed Credential, token, prompt, response,
or managed-memory identifier or content.

Mock evidence must contain exactly the following PNG names, with both themes for
every acceptance state:

- `sidepanel-enterprise-onboarding-{light,dark}.png`
- `sidepanel-enterprise-pending-{light,dark}.png`
- `sidepanel-enterprise-failure-{light,dark}.png`
- `sidepanel-enterprise-starter-memory-note-{light,dark}.png`
- `sidepanel-enterprise-customized-memory-state-{light,dark}.png`
- `sidepanel-enterprise-ordinary-session-{light,dark}.png`
- `sidepanel-enterprise-vteam-{light,dark}.png`

Live evidence must contain exactly:

- `sidepanel-enterprise-live-ready-{light,dark}.png`
- `sidepanel-enterprise-live-turn-{light,dark}.png`
- `sidepanel-enterprise-live-ordinary-session-{light,dark}.png`

`captureSha256` must map every exact `.qa/<run-id>/<name>` screenshot path, and
only those paths, to the SHA-256 digest of the retained PNG bytes. Validation
recomputes each digest and rejects renamed, missing, extra, or changed captures.

Those values must come from executed assertions against the exact candidate:
verified canonical Artoo server state; zero provisioning-attributable Sessions,
workloads, and managed-memory attachments; discovery from a clean second browser
profile without seeded Enterprise Assistant identifiers; successful idempotent
resume after each supported browser-state migration interruption point; and the
truthful Artoo memory notice after reload and second-profile discovery. The
ordinary Session and vTeam rollups must also remain false until their continuity
assertions complete. `legacyPersonalAgentSelfServiceNeverShipped` must come from
release-history plus deployed route and OpenAPI assertions proving that generated
Personal Agent self-service routes were never shipped; it must not claim a
runtime adoption or migration that has no deployed legacy server state. The
schema declaration is an evidence contract, not evidence by itself.

## Reproducible repository gates

From the repository root:

```shell
make test-browser-extension
make package-browser-extension
make test-browser-extension-qa
```

The live gate requires explicit `ACP_BASE_URL`, `ACP_PROJECT`, and `ACP_TOKEN`
environment variables. `ACP_EA_EXPECTED_AGENT_ID` is an optional test oracle;
the extension must discover the Enterprise Agent through authenticated self
GET. Live QA must refuse to restart, stop, or message a pre-existing Enterprise
Agent Session. Any runtime probe must use a newly created, immediately tracked
Session and cleanup must address only tracked run-owned Sessions. Before upload,
retained captures must pass through DOM redaction and the evidence scan must
reject the configured ACP URL, Project name or ID, tokens, credential IDs, the
expected-Agent oracle, and all private IDs observed in authenticated discovery
or run-owned resources. Never record any of those values in this evidence file.
