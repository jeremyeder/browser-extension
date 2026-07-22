import './popup.css';
import { StorageManager } from '../background/storage-manager';
import { KeycloakAuth } from '../lib/auth';
import { ACPClient } from '../lib/acp-client';
import { renderMarkdown } from '../utils/markdown';
import type { AuthTokens, Settings, EnterpriseAgent, ApiMessage, PageContext } from '../types';

// ─── State ────────────────────────────────────────────────────────────────────

interface AppState {
  tokens: AuthTokens | null;
  settings: Settings;
  agent: EnterpriseAgent | null;
  sessionId: string | null;
  includeContext: boolean;
  pendingContext: PageContext | null;
}

const state: AppState = {
  tokens: null,
  settings: { acpServerUrl: '', notifications: true, theme: 'system' },
  agent: null,
  sessionId: null,
  includeContext: false,
  pendingContext: null,
};

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const elem = document.getElementById(id);
  if (!elem) throw new Error(`Element #${id} not found`);
  return elem as T;
}

// ─── Views ────────────────────────────────────────────────────────────────────

type ViewName = 'login' | 'chat' | 'settings' | 'onboarding';

function showView(name: ViewName): void {
  (['login', 'chat', 'settings', 'onboarding'] as const).forEach((v) => {
    el(`view-${v}`).classList.toggle('hidden', v !== name);
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function ensureFreshToken(): Promise<AuthTokens> {
  if (!state.tokens) throw new Error('Not signed in');

  const auth = new KeycloakAuth(state.settings.acpServerUrl);
  if (auth.isExpired(state.tokens)) {
    if (!state.tokens.refreshToken) {
      await StorageManager.clearTokens();
      state.tokens = null;
      showView('login');
      throw new Error('Session expired. Please sign in again.');
    }
    state.tokens = await auth.refresh(state.tokens.refreshToken);
    await StorageManager.saveTokens(state.tokens);
  }

  return state.tokens;
}

// ─── Client factory ───────────────────────────────────────────────────────────

function makeClient(tokens: AuthTokens): ACPClient {
  return new ACPClient(state.settings.acpServerUrl, tokens.accessToken);
}

// ─── Messages UI ──────────────────────────────────────────────────────────────

const messagesEl = el<HTMLElement>('messages');
const typingEl = el<HTMLElement>('typing-indicator');

function appendUserMessage(content: string): void {
  const div = document.createElement('div');
  div.className = 'message message-user';
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendAssistantMessage(content: string): void {
  const div = document.createElement('div');
  div.className = 'message message-assistant';
  div.innerHTML = renderMarkdown(content);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendErrorMessage(text: string): void {
  const div = document.createElement('div');
  div.className = 'message message-error';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping(visible: boolean): void {
  typingEl.classList.toggle('hidden', !visible);
}

function renderMessages(messages: ApiMessage[]): void {
  messagesEl.innerHTML = '';
  for (const msg of messages) {
    if (msg.role === 'user') {
      appendUserMessage(msg.content);
    } else {
      appendAssistantMessage(msg.content);
    }
  }
}

// ─── Page context ─────────────────────────────────────────────────────────────

const contextBanner = el('context-banner');
const btnContext = el('btn-context');

async function fetchPageContext(): Promise<PageContext | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return null;

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' }) as
      | { type: 'PAGE_CONTEXT'; context: PageContext }
      | undefined;

    return response?.context ?? null;
  } catch {
    return null;
  }
}

function updateContextBanner(): void {
  contextBanner.classList.toggle('hidden', !state.includeContext);
  btnContext.setAttribute('aria-pressed', String(state.includeContext));
}

btnContext.addEventListener('click', () => {
  void (async () => {
    if (!state.includeContext) {
      const ctx = await fetchPageContext();
      state.pendingContext = ctx;
      state.includeContext = true;
    } else {
      state.includeContext = false;
      state.pendingContext = null;
    }
    updateContextBanner();
  })();
});

el('btn-remove-context').addEventListener('click', () => {
  state.includeContext = false;
  state.pendingContext = null;
  updateContextBanner();
});

// ─── Send message ─────────────────────────────────────────────────────────────

const inputEl = el<HTMLTextAreaElement>('message-input');
const sendBtn = el<HTMLButtonElement>('btn-send');

async function sendMessage(): Promise<void> {
  const raw = inputEl.value.trim();
  if (!raw) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';

  let content = raw;
  if (state.includeContext && state.pendingContext) {
    const ctx = state.pendingContext;
    const contextBlock =
      `\n\n---\n**Page context**\nURL: ${ctx.url}\nTitle: ${ctx.title}\n` +
      (ctx.selectedText ? `Selected text:\n${ctx.selectedText}\n` : '') +
      (ctx.bodyText ? `Page text (truncated):\n${ctx.bodyText}` : '');
    content = raw + contextBlock;
    // Clear context after use
    state.includeContext = false;
    state.pendingContext = null;
    updateContextBanner();
  }

  appendUserMessage(raw);

  sendBtn.disabled = true;
  showTyping(true);

  try {
    const tokens = await ensureFreshToken();
    const client = makeClient(tokens);

    // Ensure we have a session
    let sessionId = state.sessionId;
    if (!sessionId) {
      if (!state.agent) throw new Error('No enterprise agent found');
      const session = await client.findOrCreateSession(state.agent.id, state.agent.projectId ?? 'enterprise-assistant');
      sessionId = session.id;
      state.sessionId = sessionId;
      await StorageManager.setCurrentSessionId(sessionId);
    }

    await client.sendMessage(sessionId, content);

    // Poll for the assistant reply (simple polling — up to 60s)
    const reply = await waitForReply(sessionId, client);
    if (reply) {
      appendAssistantMessage(reply);
    }
  } catch (err) {
    appendErrorMessage(err instanceof Error ? err.message : 'Failed to send message');
  } finally {
    sendBtn.disabled = false;
    showTyping(false);
  }
}

async function waitForReply(
  sessionId: string,
  client: ACPClient,
  timeoutMs = 300_000,
  pollIntervalMs = 1500
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  // Snapshot the message count right after sending, so we only watch for truly new messages
  let baseline = 0;
  try {
    const msgs = await client.getMessages(sessionId);
    baseline = msgs.length;
  } catch {
    baseline = 0;
  }

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    try {
      const msgs = await client.getMessages(sessionId);
      if (msgs.length > baseline) {
        const newMsgs = msgs.slice(baseline);
        const assistantMsg = [...newMsgs].reverse().find((m) => m.role === 'assistant');
        if (assistantMsg) return assistantMsg.content;
        // User message appeared but no assistant reply yet — update baseline
        baseline = msgs.length;
      }
    } catch {
      // continue polling
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Auto-grow textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

sendBtn.addEventListener('click', () => void sendMessage());

// ─── New chat ─────────────────────────────────────────────────────────────────

el('btn-new-chat').addEventListener('click', () => {
  void (async () => {
    state.sessionId = null;
    state.includeContext = false;
    state.pendingContext = null;
    updateContextBanner();
    await StorageManager.setCurrentSessionId(null);
    messagesEl.innerHTML = '';
  })();
});

// ─── Settings navigation ──────────────────────────────────────────────────────

const settingsServerUrl = el<HTMLInputElement>('settings-server-url');
const settingsNotifications = el<HTMLInputElement>('settings-notifications');
const settingsTheme = el<HTMLSelectElement>('settings-theme');
const settingsStatus = el('settings-status');

function openSettings(): void {
  settingsServerUrl.value = state.settings.acpServerUrl;
  settingsNotifications.checked = state.settings.notifications;
  settingsTheme.value = state.settings.theme;
  settingsStatus.className = 'status-msg hidden';
  showView('settings');
}

el('btn-settings').addEventListener('click', openSettings);
el('btn-back').addEventListener('click', () => showView('chat'));

el('btn-save-settings').addEventListener('click', () => {
  void (async () => {
    const newSettings: Settings = {
      acpServerUrl: settingsServerUrl.value.trim(),
      notifications: settingsNotifications.checked,
      theme: settingsTheme.value as 'light' | 'dark' | 'system',
    };
    await StorageManager.saveSettings(newSettings);
    state.settings = newSettings;
    applyTheme(newSettings.theme);

    settingsStatus.textContent = 'Saved';
    settingsStatus.className = 'status-msg success';
    setTimeout(() => {
      settingsStatus.className = 'status-msg hidden';
    }, 2000);
  })();
});

// Instant theme preview
settingsTheme.addEventListener('change', () => {
  applyTheme(settingsTheme.value as 'light' | 'dark' | 'system');
});

// Sign out
el('btn-signout').addEventListener('click', () => {
  void (async () => {
    await StorageManager.clearTokens();
    await StorageManager.setCurrentSessionId(null);
    state.tokens = null;
    state.sessionId = null;
    state.agent = null;
    showView('login');
  })();
});

// ─── Login ────────────────────────────────────────────────────────────────────

const loginForm = el<HTMLFormElement>('login-form');
const loginError = el('login-error');
const loginBtn = el<HTMLButtonElement>('login-btn');
const serverUrlInput = el<HTMLInputElement>('server-url');

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void handleLogin();
});

async function handleLogin(): Promise<void> {
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  try {
    const serverUrl = serverUrlInput.value.trim();
    const username = el<HTMLInputElement>('username').value;
    const password = el<HTMLInputElement>('password').value;

    if (!serverUrl || !username || !password) {
      showLoginError('All fields are required');
      return;
    }

    // Save the server URL to settings first
    const currentSettings = await StorageManager.getSettings();
    const updatedSettings = { ...currentSettings, acpServerUrl: serverUrl };
    await StorageManager.saveSettings(updatedSettings);
    state.settings = updatedSettings;

    const auth = new KeycloakAuth(serverUrl);
    const tokens = await auth.login(username, password);
    await StorageManager.saveTokens(tokens);
    state.tokens = tokens;

    await initChatView();
  } catch (err) {
    showLoginError(err instanceof Error ? err.message : 'Login failed');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
}

function showLoginError(message: string): void {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

// ─── Chat view init ───────────────────────────────────────────────────────────

function showBootScreen(message: string): void {
  showView('chat');
  messagesEl.innerHTML = '';
  const bootEl = document.createElement('div');
  bootEl.className = 'boot-screen';
  bootEl.innerHTML = `
    <div class="boot-spinner"></div>
    <p class="boot-message">${message}</p>
  `;
  messagesEl.appendChild(bootEl);
}

function clearBootScreen(): void {
  const boot = messagesEl.querySelector('.boot-screen');
  if (boot) boot.remove();
}

async function ensureSession(client: ACPClient): Promise<string> {
  if (!state.agent) throw new Error('No enterprise agent');

  const agentId = state.agent.id;
  const projectId = state.agent.projectId ?? 'enterprise-assistant';

  // Try to find an existing active session
  const session = await client.findOrCreateSession(agentId, projectId);
  const phase = session.phase ?? (session as any).status ?? '';

  if (phase === 'Running') {
    return session.id;
  }

  if (phase === 'Failed' || phase === 'Stopped' || phase === 'Completed') {
    // Dead session — create a new one to pick up where we left off
    showBootScreen('Restarting your assistant session...');
    const newSession = await client.createNewSession(agentId, projectId);
    return await waitForSessionReady(newSession.id, client);
  }

  // Pending/Creating — wait for it
  showBootScreen('Starting your Enterprise Assistant. This takes 1–2 minutes for new users...');
  return await waitForSessionReady(session.id, client);
}

async function waitForSessionReady(sessionId: string, client: ACPClient): Promise<string> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const s = await client.getSession(sessionId);
      const phase = s.phase ?? (s as any).status ?? '';
      if (phase === 'Running') {
        clearBootScreen();
        return sessionId;
      }
      if (phase === 'Failed') {
        clearBootScreen();
        throw new Error('Session failed to start. Try again.');
      }
    } catch (e) {
      if ((e as Error).message?.includes('failed')) throw e;
    }
    await sleep(3000);
  }
  clearBootScreen();
  throw new Error('Session took too long to start.');
}

async function initChatView(): Promise<void> {
  try {
    const tokens = await ensureFreshToken();
    const client = makeClient(tokens);

    // Check if onboarding needed
    if (!state.settings.onboardingComplete) {
      showView('onboarding');
      return;
    }

    // Discover enterprise agent
    try {
      const agent = await client.getEnterpriseAgent();
      state.agent = agent;
      el('agent-name').textContent = agent.name;
    } catch {
      el('agent-name').textContent = 'Enterprise Assistant';
    }

    // Show boot screen immediately (no flash of empty chat)
    showBootScreen('Connecting to your Enterprise Assistant...');
    showView('chat');
    const sessionId = await ensureSession(client);
    state.sessionId = sessionId;
    await StorageManager.setCurrentSessionId(sessionId);

    // Wait for Artoo's first greeting before showing chat
    showBootScreen('Artoo is getting ready...');
    let greeting: ApiMessage[] = [];
    const greetDeadline = Date.now() + 120_000;
    while (Date.now() < greetDeadline) {
      try {
        greeting = await client.getMessages(sessionId);
        if (greeting.some((m) => m.role === 'assistant')) break;
      } catch { /* keep polling */ }
      await sleep(2000);
    }
    clearBootScreen();
    if (greeting.length > 0) renderMessages(greeting);
  } catch (err) {
    console.error('Chat init failed:', err);
    await StorageManager.clearTokens();
    state.tokens = null;
    showView('login');
  }
}

// ─── Onboarding Wizard ───────────────────────────────────────────────────────

let onboardingStep = 0;
const onboardingSteps = document.querySelectorAll('.onboarding-step');
const stepDots = document.querySelectorAll('.step-dot');

function showOnboardingStep(step: number): void {
  onboardingStep = step;
  onboardingSteps.forEach((s, i) => s.classList.toggle('active', i === step));
  stepDots.forEach((d, i) => d.classList.toggle('active', i === step));
}

document.querySelectorAll('.onboarding-next').forEach((btn) => {
  btn.addEventListener('click', () => showOnboardingStep(onboardingStep + 1));
});

async function completeOnboarding(): Promise<void> {
  const displayName = (document.getElementById('ob-name') as HTMLInputElement)?.value || 'Artoo';
  state.settings = { ...state.settings, onboardingComplete: true };
  await StorageManager.saveSettings(state.settings);
  el('agent-name').textContent = displayName;
  await initChatView();
}

document.querySelectorAll('.onboarding-skip').forEach((btn) => {
  btn.addEventListener('click', () => void completeOnboarding());
});

const policyAck = document.getElementById('ob-policy-ack') as HTMLInputElement | null;
const finishBtn = document.querySelector('.onboarding-finish') as HTMLButtonElement | null;
if (policyAck && finishBtn) {
  policyAck.addEventListener('change', () => {
    finishBtn.disabled = !policyAck.checked;
  });
  finishBtn.addEventListener('click', () => void completeOnboarding());
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  state.settings = await StorageManager.getSettings();
  applyTheme(state.settings.theme);

  if (state.settings.acpServerUrl) {
    serverUrlInput.value = state.settings.acpServerUrl;
  }

  state.tokens = await StorageManager.getTokens();

  if (state.tokens) {
    await initChatView();
  } else {
    showView('login');
  }
}

void boot();
