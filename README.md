# Enterprise Assistant Browser Extension

AI-powered browser extension that brings Claude into your enterprise workflow.

## Features

- **AI Chat** — Ask questions about the current page or anything else; includes optional page context
- **Page Summarization** — One-click summaries with key points and action items
- **Task Management** — Create, track, and complete tasks with priority levels
- **Enterprise SSO** — OIDC/OAuth2 with PKCE via Azure AD, Okta, Google Workspace, or custom IdP
- **Context Sidebar** — Keyboard-accessible sidebar that pushes page content
- **Auto-Summarize** — Optional automatic page summaries on navigation
- **Secure Token Storage** — Tokens stored in `chrome.storage.session` (cleared on browser close)
- **Dark mode** — Follows system preference via CSS `prefers-color-scheme`

## Architecture

```
src/
├── types.ts                    # Shared types across all contexts
├── background/
│   ├── service-worker.ts       # MV3 service worker — message routing hub
│   ├── auth-manager.ts         # OIDC PKCE flow, token refresh
│   ├── storage-manager.ts      # chrome.storage wrappers (sync/local/session)
│   ├── assistant-client.ts     # Anthropic API client (chat + summarize)
│   ├── auto-summarize.ts       # Tab-navigation watcher
│   └── notifications.ts        # Notification click routing
├── content/
│   └── content-script.ts       # Sidebar injection, keyboard shortcut, context extraction
├── popup/
│   ├── index.html              # Popup HTML (also used as sidebar iframe)
│   ├── popup.ts                # Popup controller — chat, summary, tasks tabs
│   └── popup.css               # Styles (light + dark theme)
└── options/
    ├── index.html              # Settings page
    ├── options.ts              # Settings controller
    └── options.css             # Settings styles
```

## Setup

### Prerequisites

- Node.js 18+
- A Chrome/Edge browser (Manifest V3)

### Install

```bash
npm install
```

### Configure SSO

1. Register your extension in your IdP (Azure AD / Okta / Google Workspace)
2. Set the OAuth2 redirect URI to the value of `chrome.identity.getRedirectURL('oauth2')`:
   - You can find this by running `chrome.identity.getRedirectURL('oauth2')` in the extension's background service worker DevTools console
3. Open the extension's Settings page and enter your Client ID

### Development

```bash
npm run dev        # watch mode — outputs to dist/
```

Load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

### Production build

```bash
npm run build
npm run package    # creates releases/enterprise-assistant-{version}.zip
```

### Generate icons

```bash
node scripts/generate-icons.js
```

Requires `sharp-cli`: `npm install -g sharp-cli`

### Tests

```bash
npm test
```

## Configuration

All settings are accessible via the Options page (right-click extension icon → Options):

| Setting | Default | Description |
|---------|---------|-------------|
| API Endpoint | `https://api.anthropic.com` | Claude API endpoint |
| Model | `claude-sonnet-4-6` | Claude model to use |
| Max Tokens | `4096` | Maximum response length |
| Temperature | `0.7` | Response creativity (0–1) |
| SSO Provider | `azure` | Identity provider |
| Client ID | _(required)_ | OAuth2 client ID from your IdP |
| Include page context | `true` | Attach page content to chats |
| Auto-summarize | `false` | Summarize pages on navigation |
| Notifications | `true` | Desktop notifications |

## Security

- **PKCE** (Proof Key for Code Exchange) used for all OAuth2 flows — no client secret needed
- **State validation** prevents CSRF during the auth redirect
- **Tokens stored in `chrome.storage.session`** — not persisted across browser restarts
- **Token refresh** runs 5 minutes before expiry via a periodic alarm
- **CSP** restricts extension pages to `'self'` and `https:` connections only

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` / `⌘⇧A` | Open extension popup |
| `Ctrl+Shift+S` / `⌘⇧S` | Toggle sidebar on current page |

## Browser Support

- Google Chrome 114+ (Manifest V3)
- Microsoft Edge 114+
- Chromium-based browsers with MV3 support
