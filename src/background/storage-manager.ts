import type { ExtensionSettings, Task, ChatMessage } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEYS = {
  SETTINGS: 'ea_settings',
  TASKS: 'ea_tasks',
  AUTH: 'ea_auth',
  CHAT_SESSIONS: 'ea_chat_sessions',
} as const;

/** Maximum chat sessions retained locally. Oldest are evicted first. */
const MAX_SESSIONS = 50;
/** Maximum messages per session kept in storage. */
const MAX_MESSAGES_PER_SESSION = 200;

export class StorageManager {
  // ── Settings ────────────────────────────────────────────────────────────

  async getSettings(): Promise<ExtensionSettings> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...(result[STORAGE_KEYS.SETTINGS] as Partial<ExtensionSettings>),
    };
  }

  async setSettings(settings: ExtensionSettings): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
  }

  async updateSettings(updates: Partial<ExtensionSettings>): Promise<void> {
    const current = await this.getSettings();
    await this.setSettings({ ...current, ...updates });
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  async getTasks(): Promise<Task[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.TASKS);
    return (result[STORAGE_KEYS.TASKS] as Task[]) ?? [];
  }

  async createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    // Optimistic lock: read → mutate → write in a single async turn to reduce races
    const tasks = await this.getTasks();
    const now = Date.now();
    const newTask: Task = {
      ...task,
      id: `task_${now}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: [...tasks, newTask] });
    return newTask;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<void> {
    const tasks = await this.getTasks();
    const updated = tasks.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t,
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: updated });
  }

  async deleteTask(id: string): Promise<void> {
    const tasks = await this.getTasks();
    await chrome.storage.local.set({
      [STORAGE_KEYS.TASKS]: tasks.filter((t) => t.id !== id),
    });
  }

  // ── Chat History ─────────────────────────────────────────────────────────

  async getChatSessions(): Promise<ChatSession[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CHAT_SESSIONS);
    return (result[STORAGE_KEYS.CHAT_SESSIONS] as ChatSession[]) ?? [];
  }

  async getChatSession(id: string): Promise<ChatSession | null> {
    const sessions = await this.getChatSessions();
    return sessions.find((s) => s.id === id) ?? null;
  }

  /** Create a new session with an optional first message. */
  async createChatSession(firstMessage?: ChatMessage): Promise<ChatSession> {
    const sessions = await this.getChatSessions();
    const now = Date.now();
    const session: ChatSession = {
      id: `session_${now}_${Math.random().toString(36).slice(2, 9)}`,
      title: firstMessage
        ? firstMessage.content.slice(0, 60)
        : `Session ${new Date(now).toLocaleDateString()}`,
      messages: firstMessage ? [firstMessage] : [],
      createdAt: now,
      updatedAt: now,
    };

    // Evict oldest sessions beyond cap
    const kept = [session, ...sessions].slice(0, MAX_SESSIONS);
    await chrome.storage.local.set({ [STORAGE_KEYS.CHAT_SESSIONS]: kept });
    return session;
  }

  /** Append a message to an existing session and update its title if it's the first user message. */
  async appendToSession(sessionId: string, message: ChatMessage): Promise<void> {
    const sessions = await this.getChatSessions();
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = [...s.messages, message].slice(-MAX_MESSAGES_PER_SESSION);
      // Auto-title from first user message
      const title =
        s.messages.length === 0 && message.role === 'user'
          ? message.content.slice(0, 60)
          : s.title;
      return { ...s, messages, title, updatedAt: Date.now() };
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.CHAT_SESSIONS]: updated });
  }

  async deleteChatSession(id: string): Promise<void> {
    const sessions = await this.getChatSessions();
    await chrome.storage.local.set({
      [STORAGE_KEYS.CHAT_SESSIONS]: sessions.filter((s) => s.id !== id),
    });
  }

  // ── Auth (session-scoped — cleared on browser close) ────────────────────

  async getAuthData(): Promise<Record<string, unknown>> {
    const result = await chrome.storage.session.get(STORAGE_KEYS.AUTH);
    return (result[STORAGE_KEYS.AUTH] as Record<string, unknown>) ?? {};
  }

  async setAuthData(data: Record<string, unknown>): Promise<void> {
    await chrome.storage.session.set({ [STORAGE_KEYS.AUTH]: data });
  }

  async clearAuthData(): Promise<void> {
    await chrome.storage.session.remove(STORAGE_KEYS.AUTH);
  }
}
