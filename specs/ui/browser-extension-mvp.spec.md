# Browser Extension MVP Specification

## Purpose

The ACP Browser Extension is a Chrome side-panel surface that provides a
persistent Enterprise Assistant powered by ACP. It authenticates users via
Keycloak, discovers (or provisions) a per-user Enterprise Agent, maintains a
persistent chat session, and renders Artoo's responses with markdown formatting.
It connects exclusively through the ACP API server — no direct LLM API access.

## Architecture

```
Browser Extension (Chrome Side Panel)
  → Keycloak (password grant, inline form)
  → ACP API Server (sessions, agents, messages)
  → ACP Control Plane (sandbox provisioning)
  → OpenShell Gateway (inference routing via Vertex AI)
```

The extension stores only: ACP server URL, auth tokens, theme preference,
notification toggle, and the current session ID. All agent configuration,
prompts, memory, and session state live server-side in ACP.

## Chrome Manifest

- Manifest V3 with `sidePanel` permission
- `side_panel.default_path` points to the main HTML
- `action.default_popup` SHALL NOT be set
- `setPanelBehavior({ openPanelOnActionClick: true })` on install
- Pinned extension ID via `key` field for stable Keycloak redirect URIs
- Permissions: `storage`, `tabs`, `activeTab`, `scripting`, `notifications`, `sidePanel`
- No `identity` permission (inline login, not launchWebAuthFlow)

## Settings

The settings page shows three sections only:

### Agent Control Plane
- **ACP Server URL** — single text field, no placeholder text
- Default: deployment-specific (blank for distribution, pre-filled for dev builds)
- Keycloak issuer derived automatically: replace `ambient-api-server-` with
  `keycloak-` in the hostname, append `/realms/ambient-code`

### Behavior
- **Enable notifications** — toggle (default: on)

### Appearance
- **Theme** — select: system / light / dark
- Instant preview: changing the select immediately applies `data-theme` attribute
  on `:root` before save

No Anthropic API key, no SSO provider picker, no client ID field, no model
selector in the main settings. Advanced/dev fields may exist in a collapsed
section but are not shown by default.

## Authentication

### Inline Keycloak Login
The login view shows inside the side panel:
- ACP Server URL field (pre-filled from settings)
- Username field
- Password field
- Inline error message (red, below fields)
- Sign In button

Authentication uses Keycloak's Resource Owner Password Credentials grant
(direct `POST` to `{keycloak-issuer}/protocol/openid-connect/token`).
No external popup, tab, or `chrome.identity.launchWebAuthFlow`.

Client ID: `acp-browser-extension` (registered in Keycloak with
`directAccessGrantsEnabled: true`, `publicClient: true`).

Tokens stored via `chrome.storage.local`. Refresh via `grant_type=refresh_token`.
Expired tokens trigger silent refresh; permanent failures return to login view.

## Enterprise Agent Discovery

After login, the extension discovers the user's Enterprise Agent:

1. Try `GET /api/ambient/v1/users/me/enterprise-agent` (future API)
2. Fallback: `GET /api/ambient/v1/projects/enterprise-assistant/agents` — use first agent
3. If no agent found: show onboarding wizard (see Onboarding section)

The agent's `id`, `name`, and `project_id` are used to find or create sessions.

## Session Management

### Persistent Sessions
The extension maintains one persistent session per Enterprise Agent.

**Find or create**: On each chat interaction:
1. `GET /api/ambient/v1/sessions` — find existing session where
   `agent_id` matches and `phase` is `Running`, `Creating`, or `Pending`
2. If found: reuse it (session survives extension reloads, browser restarts)
3. If not found: `POST /api/ambient/v1/sessions` with:
   ```json
   {
     "agent_id": "<agent-id>",
     "project_id": "enterprise-assistant",
     "name": "browser-<timestamp>",
     "prompt": "Enterprise Assistant session"
   }
   ```

**First session boot**: Takes ~90 seconds (sandbox provisioning). The extension
polls for up to 5 minutes. The typing indicator stays visible during this time.

**Subsequent messages**: Respond in seconds (session already Running).

### Session Discovery via Annotations (future)
Sessions annotated with `ambient-code.io/enterprise-agent: true` enable
multi-client discovery (browser, CLI, UI find the same session).

## ACP Message API

Messages use ACP's event format, not OpenAI-style role/content:

| ACP Field | Maps To |
|-----------|---------|
| `event_type` | `role` (`user` or `assistant`) |
| `payload` | `content` (message text) |
| `seq` | sequence number |

### Sending: `POST /api/ambient/v1/sessions/{id}/messages`
```json
{ "event_type": "user", "payload": "user's message text" }
```

### Receiving: `GET /api/ambient/v1/sessions/{id}/messages`
Returns array of event objects. The extension:
1. Filters to `event_type === 'user' || 'assistant'` only
2. Skips bootstrap messages (system prompt, agent instructions injected at
   session start) — conversation starts from the assistant's greeting
3. Maps to `{ role, content }` for rendering

### Reply polling
After sending, poll `GET .../messages` every 1.5 seconds for up to 5 minutes.
Show typing indicator while polling. New assistant message = reply found.

## Onboarding Wizard

When no Enterprise Agent exists, show the onboarding wizard from
`personal-assistant/onboarding/wizard-schema.json`:

### Steps
1. **Welcome** — "Assemble Your Enterprise Assistant" with Start / Skip buttons
2. **Persona** — display_name, custom_instructions, warmth/certainty/interpretation sliders
3. **Memory** — personal_enabled and coding_enabled toggles
4. **Security Policies** — read-only policy list with acknowledgment checkbox
5. **First Chat** — inline conversation with Artoo using the first-conversation template

### Skip (Artoo Starter)
Provisions the default Artoo template immediately without customization or memory.

### First Conversation
Artoo sends first:
> Hi! I'm {display_name}, your Enterprise Assistant. I'm here to help you
> with your work. {memory_status_text}
>
> To get started, I'd love to learn a bit about you. What are you currently
> working on?

Follow-up prompts after user responds:
- What tools, languages, or frameworks do you use most?
- Are there any workflows or conventions you'd like me to follow?
- Is there anything you'd like me to always do (or never do)?

## Chat View

### Header
- Agent name (bold, left)
- Icon buttons (right): page context, new chat, settings

### Messages
- User messages: right-aligned, accent color background
- Assistant messages: left-aligned, secondary background, markdown rendered
- Error messages: left-aligned, red background
- Typing indicator: animated dots while waiting for reply

### Bootstrap Message Filtering
The first few messages in a session are ACP bootstrap (system prompt, agent
instructions). These SHALL NOT be shown to the user. The conversation starts
from the assistant's greeting message.

### Input Area
- Multiline textarea with auto-grow (max 120px)
- Send button (accent color, disabled when empty or busy)
- Page context button (toggles page content inclusion for the next message)
- Enter to send, Shift+Enter for newline

### Page Context
- Disabled by default (no global toggle)
- "Attach page context" button in the input area
- When active: shows "Page context will be included" banner with Remove button
- On send: appends page URL, title, selected text, and truncated body text
- Context cleared after sending (one-shot per click)
- Content script extracts: `{ url, title, selectedText, bodyText }`

## Dark Theme

CSS custom properties on `:root` with `[data-theme="dark"]` overrides.
Both side panel and options page support dark mode.

Applied via:
- `data-theme` attribute on `<html>` element
- On popup load: read theme from storage, apply
- On settings change: apply immediately (before save)
- `prefers-color-scheme: dark` media query as fallback for `system` theme

## Build System

- TypeScript + Webpack + ts-loader
- CSS imported in TypeScript (MiniCssExtractPlugin)
- HtmlWebpackPlugin for popup and options HTML
- CopyPlugin for manifest.json and assets
- Jest for tests with Chrome API mocks
- Output: `dist/` directory (load unpacked in Chrome)
- PNG icons generated from placeholder (16, 32, 48, 128px)

## File Structure

```
src/
  background/
    service-worker.ts    — Chrome service worker, setPanelBehavior
    storage-manager.ts   — chrome.storage.local wrapper for settings/tokens
  lib/
    auth.ts              — KeycloakAuth class (password grant, refresh, expiry)
    acp-client.ts        — ACPClient class (agents, sessions, messages)
  popup/
    index.html           — Side panel HTML (login + chat + settings views)
    popup.ts             — Main UI logic, view routing, message rendering
    popup.css            — All styles with dark theme support
  options/
    index.html           — Settings page HTML
    options.ts           — Settings form logic, instant theme preview
    options.css          — Settings styles with dark theme
  content/
    content-script.ts    — Page context extraction
  utils/
    markdown.ts          — Simple markdown-to-HTML renderer
  types.ts               — Shared interfaces
manifest.json            — Chrome Manifest V3 with side_panel + pinned key
webpack.config.js
tsconfig.json
package.json
```

## ACP Server Prerequisites

For the extension to work, the ACP cluster needs:
1. **Project** `enterprise-assistant` with a gateway and vertex provider
2. **Agent** `enterprise-agent` with Artoo persona prompt
3. **Keycloak client** `acp-browser-extension` with:
   - `publicClient: true`
   - `directAccessGrantsEnabled: true`
   - `redirectUris: ["https://<extension-id>.chromiumapp.org/*"]`
   - Default scopes: `openid`, `profile`, `email`
4. **Keycloak hostname** set correctly (`KC_HOSTNAME` matching the route)
5. **SSO credentials** secret with correct `SSO_FRONTEND_ISSUER_URL` and `SSO_REDIRECT_URI`

## Persona Content (External)

The Enterprise Agent's prompt, persona, and security policies come from the
`personal-assistant` repository — NOT from the browser extension codebase.
The extension never contains Artoo's prompt text. Loading persona content into
ACP is a deployment step (`acpctl apply` or GitOps Application sync from the
`personal-assistant` repo).

## Verification

### Build Gate
```bash
npm install && npm run build   # must exit 0
npm run typecheck              # must exit 0 (tsc --noEmit)
npm test                       # must exit 0 (Jest)
```

### Automated E2E (Playwright + Chrome Extension)
The following scenarios SHALL be automated using Playwright with Chrome
extension loading. No manual screenshots required.

#### Scenario: Extension loads in side panel
- Load extension from `dist/` in Chrome via Playwright
- Click toolbar action
- Assert: side panel opens with login view visible
- Assert: ACP Server URL field is present

#### Scenario: Login with valid credentials
- Enter ACP Server URL, username `developer`, password `developer`
- Click Sign In
- Assert: chat view becomes visible within 5 seconds
- Assert: agent name is displayed in header
- Assert: login form is hidden

#### Scenario: Login with invalid credentials
- Enter wrong password
- Click Sign In
- Assert: error message appears inline (not an alert dialog)
- Assert: login form remains visible

#### Scenario: Send message and receive reply
- Login successfully
- Type "Hello" in the input
- Click send
- Assert: user message appears right-aligned
- Assert: typing indicator is visible
- Assert: assistant message appears within 5 minutes (first boot) or 30 seconds (warm session)

#### Scenario: Session persistence across reload
- Login and send a message
- Reload the extension
- Assert: previous messages are visible (session reused, not recreated)

#### Scenario: Dark theme applies instantly
- Open settings
- Change theme to Dark
- Assert: background color changes immediately (before save)
- Assert: `data-theme="dark"` is set on `<html>`

#### Scenario: Page context opt-in
- Click the attach-page-context button
- Assert: "Page context will be included" banner appears
- Send a message
- Assert: the sent message includes page URL and content
- Assert: the banner disappears after sending (one-shot)

#### Scenario: Bootstrap messages hidden
- Login to a session that has bootstrap messages
- Assert: no message containing "You are Artoo" or system prompt text is visible
- Assert: first visible message is the assistant greeting

### Manual QA (Demo Checklist)
For demo purposes, verify visually:
- [ ] Side panel renders at full height, no fixed width
- [ ] Dark theme colors are readable (contrast ratio)
- [ ] Markdown renders correctly (bold, lists, code blocks, links)
- [ ] Extension icon is visible in toolbar

### Toolbar Pinning
Chrome does not expose an API for auto-pinning extensions to the toolbar.
The extension SHALL use `setPanelBehavior({ openPanelOnActionClick: true })`
so clicking the extension icon (even from the puzzle-piece menu) opens the
side panel directly without requiring pinning. The onboarding wizard or
first-run experience SHOULD include a visual instruction telling the user
to pin the extension: "Click the puzzle piece icon → find Enterprise
Assistant → click the pin icon."
