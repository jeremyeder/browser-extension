import { StorageManager } from './storage-manager';
import { KeycloakAuth } from '../lib/auth';
import type { ExtensionMessage } from '../types';

// Open side panel when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: Error) => console.error('setPanelBehavior failed', err));

// Handle messages from popup (side panel) and content scripts
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, _sendResponse) => {
    if (message.type === 'OPEN_SETTINGS') {
      void chrome.runtime.openOptionsPage();
      return false;
    }
    return false;
  }
);

// Token refresh alarm
const REFRESH_ALARM = 'token-refresh';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    void refreshTokenIfNeeded();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 5 });
});

async function refreshTokenIfNeeded(): Promise<void> {
  try {
    const tokens = await StorageManager.getTokens();
    if (!tokens?.refreshToken) return;

    const settings = await StorageManager.getSettings();
    if (!settings.acpServerUrl) return;

    const auth = new KeycloakAuth(settings.acpServerUrl);
    if (auth.isExpired(tokens)) {
      const refreshed = await auth.refresh(tokens.refreshToken);
      await StorageManager.saveTokens(refreshed);
    }
  } catch (err) {
    console.error('Token refresh failed:', err);
    await StorageManager.clearTokens();
  }
}
