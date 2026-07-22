import { StorageManager } from '../src/background/storage-manager';
import type { Settings, AuthTokens } from '../src/types';

// Mock chrome APIs
const mockStorage = {
  sync: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  local: {} as Record<string, unknown>,
};

const makeMockArea = (store: Record<string, unknown>) => ({
  get: jest.fn(async (keys: string | string[] | Record<string, unknown>) => {
    if (typeof keys === 'string') {
      return { [keys]: store[keys] };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((k) => [k, store[k]]));
    }
    // defaults object
    const result: Record<string, unknown> = {};
    for (const [k, defaultVal] of Object.entries(keys as Record<string, unknown>)) {
      result[k] = k in store ? store[k] : defaultVal;
    }
    return result;
  }),
  set: jest.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  }),
  remove: jest.fn(async (keys: string | string[]) => {
    const ks = Array.isArray(keys) ? keys : [keys];
    ks.forEach((k) => delete store[k]);
  }),
});

global.chrome = {
  storage: {
    sync: makeMockArea(mockStorage.sync),
    session: makeMockArea(mockStorage.session),
    local: makeMockArea(mockStorage.local),
  },
} as unknown as typeof chrome;

beforeEach(() => {
  // Clear stores
  Object.keys(mockStorage.sync).forEach((k) => delete mockStorage.sync[k]);
  Object.keys(mockStorage.session).forEach((k) => delete mockStorage.session[k]);
  Object.keys(mockStorage.local).forEach((k) => delete mockStorage.local[k]);

  // Reset mock call counts
  jest.clearAllMocks();
});

describe('StorageManager', () => {
  describe('getSettings', () => {
    test('returns defaults when nothing stored', async () => {
      const settings = await StorageManager.getSettings();
      expect(settings.acpServerUrl).toBe('');
      expect(settings.notifications).toBe(true);
      expect(settings.theme).toBe('system');
    });

    test('returns saved values when stored', async () => {
      await StorageManager.saveSettings({
        acpServerUrl: 'https://example.com',
        notifications: false,
        theme: 'dark',
      });
      const settings = await StorageManager.getSettings();
      expect(settings.acpServerUrl).toBe('https://example.com');
      expect(settings.notifications).toBe(false);
      expect(settings.theme).toBe('dark');
    });
  });

  describe('saveSettings', () => {
    test('persists partial updates without overwriting other fields', async () => {
      await StorageManager.saveSettings({ acpServerUrl: 'https://initial.com' });
      await StorageManager.saveSettings({ theme: 'light' });
      const settings = await StorageManager.getSettings();
      expect(settings.acpServerUrl).toBe('https://initial.com');
      expect(settings.theme).toBe('light');
    });
  });

  describe('tokens', () => {
    test('returns null when no tokens stored', async () => {
      const tokens = await StorageManager.getTokens();
      expect(tokens).toBeNull();
    });

    test('saves and retrieves tokens', async () => {
      const tokens: AuthTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: Date.now() + 3600_000,
      };
      await StorageManager.saveTokens(tokens);
      const retrieved = await StorageManager.getTokens();
      expect(retrieved).toEqual(tokens);
    });

    test('clearTokens removes stored tokens', async () => {
      const tokens: AuthTokens = {
        accessToken: 'access-123',
        expiresAt: Date.now() + 3600_000,
      };
      await StorageManager.saveTokens(tokens);
      await StorageManager.clearTokens();
      const retrieved = await StorageManager.getTokens();
      expect(retrieved).toBeNull();
    });
  });

  describe('session management', () => {
    test('returns null when no session set', async () => {
      const id = await StorageManager.getCurrentSessionId();
      expect(id).toBeNull();
    });

    test('saves and retrieves session ID', async () => {
      await StorageManager.setCurrentSessionId('sess-abc');
      const id = await StorageManager.getCurrentSessionId();
      expect(id).toBe('sess-abc');
    });

    test('clears session ID when set to null', async () => {
      await StorageManager.setCurrentSessionId('sess-abc');
      await StorageManager.setCurrentSessionId(null);
      const id = await StorageManager.getCurrentSessionId();
      expect(id).toBeNull();
    });
  });
});
