import type { AuthState, ChatMessage, Task } from '../types';
import { renderMarkdown } from '../utils/markdown';
import { BUILT_IN_TEMPLATES, fillTemplate } from '../utils/prompt-templates';
import './popup.css';

// ── State ──────────────────────────────────────────────────────────────────
let authState: AuthState = { isAuthenticated: false };
let currentSessionId: string | null = null;
let messages: ChatMessage[] = [];
let pageContext: { pageText?: string; selectedText?: string } | null = null;
let tasks: Task[] = [];
let isBusy = false;

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found — check popup HTML`);
  return el as T;
};

const authScreen = $('auth-screen');
const mainScreen = $('main-screen');
const loadingOverlay = $('loading');
const userBar = $('user-bar');

const loginBtn = $<HTMLButtonElement>('login-btn');
const logoutBtn = $<HTMLButtonElement>('logout-btn');
const userAvatar = $<HTMLImageElement>('user-avatar');
const userName = $('user-name');

const chatMessages = $('chat-messages');
const chatInput = $<HTMLTextAreaElement>('chat-input');
const sendBtn = $<HTMLButtonElement>('send-btn');
const attachContextBtn = $<HTMLButtonElement>('attach-context-btn');
const removeContextBtn = $<HTMLButtonElement>('remove-context-btn');
const contextBadge = $('context-badge');
const contextLabel = $('context-label');
const templateMenu = $('template-menu');
const newChatBtn = $<HTMLButtonElement>('new-chat-btn');
const settingsBtn = $<HTMLButtonElement>('settings-btn');
const exportBtn = $<HTMLButtonElement>('export-btn');

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const panels = document.querySelectorAll<HTMLDivElement>('.panel');

const summarizeBtn = $<HTMLButtonElement>('summarize-btn');
const summaryContent = $('summary-content');
const summaryText = $('summary-text');
const keyPointsList = $<HTMLUListElement>('key-points-list');
const actionItemsSection = $('action-items-section');
const actionItemsList = $<HTMLUListElement>('action-items-list');

const addTaskBtn = $<HTMLButtonElement>('add-task-btn');
const addTaskForm = $('add-task-form');
const taskTitleInput = $<HTMLInputElement>('task-title-input');
const taskDescInput = $<HTMLTextAreaElement>('task-desc-input');
const taskPrioritySelect = $<HTMLSelectElement>('task-priority-select');
const saveTaskBtn = $<HTMLButtonElement>('save-task-btn');
const cancelTaskBtn = $<HTMLButtonElement>('cancel-task-btn');
const tasksList = $<HTMLUListElement>('tasks-list');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    authState = await sendMessage<AuthState>({ type: 'AUTH_CHECK' });
    if (authState.isAuthenticated) {
      await showMain();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  } finally {
    showLoading(false);
  }
}

// Listen for settings changes broadcast from service worker
chrome.runtime.onMessage.addListener((msg: { type: string }) => {
  if (msg.type === 'SETTINGS_CHANGED') {
    // Settings updated in options page — nothing to do in popup for now
    // Future: re-fetch and show any relevant settings badge
  }
});

// New chat button
newChatBtn.addEventListener('click', () => {
  messages = [];
  currentSessionId = null;
  chatMessages.innerHTML = '<div class="empty-state"><p>Ask me anything, or type <kbd>/</kbd> for prompt templates.</p></div>';
  exportBtn.classList.add('hidden');
});

// Settings button — opens options page in new tab
settingsBtn.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

// Export conversation as Markdown download
exportBtn.addEventListener('click', () => exportConversation());

// ── Auth ───────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';
  try {
    authState = await sendMessage<AuthState>({ type: 'AUTH_LOGIN' });
    if (authState.isAuthenticated) await showMain();
  } catch (err) {
    console.error('Login failed', err);
    alert('Sign in failed. Check your SSO settings and try again.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'AUTH_LOGOUT' });
  authState = { isAuthenticated: false };
  messages = [];
  currentSessionId = null;
  showAuth();
});

// ── Tabs ───────────────────────────────────────────────────────────────────
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === target);
      t.setAttribute('aria-selected', String(t.dataset.tab === target));
    });
    panels.forEach((p) => {
      const isTarget = p.id === `${target}-panel`;
      p.classList.toggle('active', isTarget);
      p.hidden = !isTarget;
    });
  });
});

// ── Chat ───────────────────────────────────────────────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  sendBtn.disabled = chatInput.value.trim() === '' || isBusy;
  handleSlashCommand(chatInput.value);
});

chatInput.addEventListener('keydown', (e) => {
  // Template menu navigation
  if (!templateMenu.classList.contains('hidden')) {
    const items = templateMenu.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const active = templateMenu.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const idx = active ? Array.from(items).indexOf(active) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      setActiveOption(items, next);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      setActiveOption(items, prev);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const selected = templateMenu.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      selected?.click();
      return;
    }
    if (e.key === 'Escape') {
      closeTemplateMenu();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) void doChat();
  }
});

sendBtn.addEventListener('click', () => void doChat());

attachContextBtn.addEventListener('click', async () => {
  if (pageContext) {
    pageContext = null;
    contextBadge.classList.add('hidden');
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;
    const ctx = await chrome.tabs.sendMessage<
      { type: string },
      { pageText?: string; selectedText?: string; url: string; title: string }
    >(tab.id, { type: 'CONTEXT_EXTRACT' });
    if (!ctx) return;
    pageContext = { pageText: ctx.pageText, selectedText: ctx.selectedText };
    contextLabel.textContent = ctx.selectedText
      ? `"${ctx.selectedText.slice(0, 40)}…" selected`
      : `Page context included`;
    contextBadge.classList.remove('hidden');
  } catch {
    // Extension may not have scripting access to this tab — show tooltip instead of alert
    attachContextBtn.title = 'Cannot access this page (try a regular web page)';
    setTimeout(() => {
      attachContextBtn.title = 'Include page context';
    }, 3000);
  }
});

removeContextBtn.addEventListener('click', () => {
  pageContext = null;
  contextBadge.classList.add('hidden');
});

// ── Slash-command / Prompt Templates ──────────────────────────────────────
function handleSlashCommand(value: string) {
  if (!value.startsWith('/')) {
    closeTemplateMenu();
    return;
  }

  const query = value.slice(1).toLowerCase();
  const matches = BUILT_IN_TEMPLATES.filter(
    (t) => t.id.includes(query) || t.label.includes(query) || t.description.toLowerCase().includes(query),
  );

  if (matches.length === 0) {
    closeTemplateMenu();
    return;
  }

  templateMenu.innerHTML = '';
  matches.forEach((template, i) => {
    const btn = document.createElement('button');
    btn.className = 'template-option';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.innerHTML = `<span class="template-label">${template.label}</span><span class="template-desc">${template.description}</span>`;

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
      applyTemplate(template);
    });

    templateMenu.appendChild(btn);
  });

  templateMenu.classList.remove('hidden');
}

function applyTemplate(template: (typeof BUILT_IN_TEMPLATES)[0]) {
  const ctx = pageContext
    ? { selection: pageContext.selectedText, pageText: pageContext.pageText }
    : {};
  chatInput.value = fillTemplate(template, ctx);
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  sendBtn.disabled = false;
  closeTemplateMenu();
  chatInput.focus();
}

function closeTemplateMenu() {
  templateMenu.classList.add('hidden');
  templateMenu.innerHTML = '';
}

function setActiveOption(items: NodeListOf<HTMLButtonElement>, next: HTMLButtonElement) {
  items.forEach((el) => el.setAttribute('aria-selected', 'false'));
  next.setAttribute('aria-selected', 'true');
  next.scrollIntoView({ block: 'nearest' });
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!templateMenu.contains(e.target as Node) && e.target !== chatInput) {
    closeTemplateMenu();
  }
});

async function doChat() {
  const text = chatInput.value.trim();
  if (!text || isBusy) return;

  const userMsg: ChatMessage = {
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
  };

  messages.push(userMsg);
  appendMessage(userMsg);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isBusy = true;

  // Persist to session
  if (!currentSessionId) {
    const session = await sendMessage<{ id: string }>({ type: 'SESSION_CREATE', payload: userMsg });
    currentSessionId = session.id;
  } else {
    await sendMessage({ type: 'SESSION_APPEND', payload: { sessionId: currentSessionId, message: userMsg } });
  }

  const thinkingEl = appendThinking();

  try {
    const response = await sendMessage<{ content: string } | { error: string }>({
      type: 'CHAT_MESSAGE',
      payload: { messages, context: pageContext },
    });

    thinkingEl.remove();

    if ('error' in response) {
      appendError(response.error);
    } else {
      const aiMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      };
      messages.push(aiMsg);
      appendMessage(aiMsg);
      // Persist AI response
      if (currentSessionId) {
        await sendMessage({ type: 'SESSION_APPEND', payload: { sessionId: currentSessionId, message: aiMsg } });
      }
    }
  } catch (err) {
    thinkingEl.remove();
    appendError(err instanceof Error ? err.message : 'Failed to get response.');
  } finally {
    isBusy = false;
    sendBtn.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function appendMessage(msg: ChatMessage) {
  chatMessages.querySelector('.empty-state')?.remove();

  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  div.setAttribute('role', 'article');
  div.setAttribute('aria-label', `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content.slice(0, 100)}`);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (msg.role === 'assistant') {
    // Render markdown for AI responses
    bubble.innerHTML = renderMarkdown(msg.content);
  } else {
    bubble.textContent = msg.content;
  }

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  div.appendChild(bubble);
  div.appendChild(time);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  updateExportBtn();
  return div;
}

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'message assistant thinking';
  div.setAttribute('role', 'status');
  div.setAttribute('aria-live', 'polite');
  div.setAttribute('aria-label', 'Assistant is thinking');
  div.innerHTML = '<div class="message-bubble"><span class="thinking-dots"><span></span><span></span><span></span></span></div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function appendError(text: string) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.setAttribute('role', 'alert');
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble error';
  bubble.textContent = text;
  div.appendChild(bubble);
  chatMessages.appendChild(div);
}

// ── Export ─────────────────────────────────────────────────────────────────
function exportConversation() {
  if (messages.length === 0) return;

  const date = new Date();
  const header = `# Enterprise Assistant — Conversation Export\n\n_Exported ${date.toLocaleString()}_\n`;
  const body = messages
    .map((msg) => {
      const role = msg.role === 'user' ? '**You**' : '**Assistant**';
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${role} _(${time})_\n\n${msg.content}`;
    })
    .join('\n\n---\n\n');

  const text = `${header}\n---\n\n${body}\n`;
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `enterprise-assistant-${date.toISOString().slice(0, 10)}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function updateExportBtn() {
  exportBtn.classList.toggle('hidden', messages.length === 0);
}

// ── Summary ────────────────────────────────────────────────────────────────
summarizeBtn.addEventListener('click', async () => {
  summarizeBtn.disabled = true;
  summarizeBtn.textContent = 'Summarizing…';
  summaryContent.classList.add('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url) throw new Error('No active tab');

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText?.slice(0, 8000) ?? '',
    });
    const pageText = result[0]?.result ?? '';
    if (pageText.length < 100) throw new Error('Not enough page content to summarize');

    const summary = await sendMessage<{ summary: string; keyPoints: string[]; actionItems: string[] }>({
      type: 'PAGE_SUMMARIZE',
      payload: { pageText, url: tab.url, title: tab.title ?? '' },
    });

    summaryText.textContent = summary.summary;

    keyPointsList.innerHTML = '';
    summary.keyPoints.forEach((pt) => {
      const li = document.createElement('li');
      li.textContent = pt;
      keyPointsList.appendChild(li);
    });

    if (summary.actionItems.length > 0) {
      actionItemsList.innerHTML = '';
      summary.actionItems.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        actionItemsList.appendChild(li);
      });
      actionItemsSection.classList.remove('hidden');
    } else {
      actionItemsSection.classList.add('hidden');
    }

    summaryContent.classList.remove('hidden');
  } catch (err) {
    summaryText.textContent = err instanceof Error ? err.message : 'Failed to summarize this page.';
    keyPointsList.innerHTML = '';
    actionItemsSection.classList.add('hidden');
    summaryContent.classList.remove('hidden');
  } finally {
    summarizeBtn.disabled = false;
    summarizeBtn.textContent = 'Summarize This Page';
  }
});

// ── Tasks ──────────────────────────────────────────────────────────────────
addTaskBtn.addEventListener('click', () => {
  const isOpen = !addTaskForm.classList.contains('hidden');
  addTaskForm.classList.toggle('hidden', isOpen);
  if (!isOpen) taskTitleInput.focus();
});

cancelTaskBtn.addEventListener('click', () => {
  addTaskForm.classList.add('hidden');
  taskTitleInput.value = '';
  taskDescInput.value = '';
});

saveTaskBtn.addEventListener('click', async () => {
  const title = taskTitleInput.value.trim();
  if (!title) {
    taskTitleInput.focus();
    return;
  }

  const task = await sendMessage<Task>({
    type: 'TASK_CREATE',
    payload: {
      title,
      description: taskDescInput.value.trim() || undefined,
      priority: taskPrioritySelect.value as Task['priority'],
      status: 'todo' as const,
      tags: [],
    },
  });

  tasks.push(task);
  renderTasks();
  taskTitleInput.value = '';
  taskDescInput.value = '';
  taskPrioritySelect.value = 'medium';
  addTaskForm.classList.add('hidden');
});

async function loadTasks() {
  tasks = await sendMessage<Task[]>({ type: 'TASK_LIST' });
  renderTasks();
}

function renderTasks() {
  tasksList.innerHTML = '';
  if (tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No tasks yet. Add one above.';
    tasksList.appendChild(li);
    return;
  }

  const sorted = [...tasks].sort((a, b) => {
    const order: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  sorted.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'task-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = task.status === 'done';
    checkbox.id = `task-check-${task.id}`;
    checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.status === 'done' ? 'todo' : 'done'}`);

    checkbox.addEventListener('change', async () => {
      const newStatus: Task['status'] = checkbox.checked ? 'done' : 'todo';
      await sendMessage({ type: 'TASK_UPDATE', payload: { id: task.id, updates: { status: newStatus } } });
      task.status = newStatus;
      titleEl.classList.toggle('done', checkbox.checked);
    });

    const body = document.createElement('div');
    body.className = 'task-body';

    const titleEl = document.createElement('label');
    titleEl.className = `task-title${task.status === 'done' ? ' done' : ''}`;
    titleEl.htmlFor = `task-check-${task.id}`;
    titleEl.textContent = task.title;

    body.appendChild(titleEl);
    if (task.description) {
      const desc = document.createElement('div');
      desc.className = 'task-desc';
      desc.textContent = task.description;
      body.appendChild(desc);
    }

    const badge = document.createElement('span');
    badge.className = `task-priority ${task.priority}`;
    badge.textContent = task.priority;
    badge.setAttribute('aria-label', `Priority: ${task.priority}`);

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(badge);
    tasksList.appendChild(li);
  });
}

// ── Display helpers ────────────────────────────────────────────────────────
function showAuth() {
  authScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  userBar.classList.add('hidden');
}

async function showMain() {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  if (authState.user) {
    userBar.classList.remove('hidden');
    userName.textContent = authState.user.displayName || authState.user.email;
    if (authState.user.avatarUrl) {
      userAvatar.src = authState.user.avatarUrl;
      userAvatar.classList.remove('hidden');
    } else {
      userAvatar.classList.add('hidden');
    }
  }
  await loadTasks();
}

function showLoading(show: boolean) {
  loadingOverlay.classList.toggle('hidden', !show);
}

// ── Messaging ──────────────────────────────────────────────────────────────
function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const r = response as Record<string, unknown> | null;
      if (r && typeof r.error === 'string') {
        reject(new Error(r.error));
        return;
      }
      resolve(response as T);
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => void init());
