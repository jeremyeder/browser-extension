import type { Settings, AuthTokens } from '../types';

const DEFAULT_SETTINGS: Settings = {
  acpServerUrl: '',
  notifications: true,
  theme: 'system',
};

export class StorageManager {
  static async getSettings(): Promise<Settings> {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return stored as Settings;
  }

  static async saveSettings(settings: Partial<Settings>): Promise<void> {
    await chrome.storage.sync.set(settings);
  }

  static async getTokens(): Promise<AuthTokens | null> {
    const result = await chrome.storage.session.get('tokens');
    return (result['tokens'] as AuthTokens | undefined) ?? null;
  }

  static async saveTokens(tokens: AuthTokens): Promise<void> {
    await chrome.storage.session.set({ tokens });
  }

  static async clearTokens(): Promise<void> {
    await chrome.storage.session.remove('tokens');
  }

  static async getCurrentSessionId(): Promise<string | null> {
    const result = await chrome.storage.local.get('currentSessionId');
    return (result['currentSessionId'] as string | undefined) ?? null;
  }

  static async setCurrentSessionId(sessionId: string | null): Promise<void> {
    if (sessionId === null) {
      await chrome.storage.local.remove('currentSessionId');
    } else {
      await chrome.storage.local.set({ currentSessionId: sessionId });
    }
  }
}
