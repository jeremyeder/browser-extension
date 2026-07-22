/**
 * Auto-summarize feature: triggered when user navigates to a new page
 * if enableAutoSummarize is set in settings.
 */
import type { ExtensionSettings, AuthState } from '../types';

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || !tab.url.startsWith('http')) return;

  const settings: ExtensionSettings = await sendMessage({ type: 'SETTINGS_GET' });
  if (!settings.enableAutoSummarize) return;

  const auth: AuthState = await sendMessage({ type: 'AUTH_CHECK' });
  if (!auth.isAuthenticated) return;

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        pageText: document.body?.innerText?.slice(0, 6000) ?? '',
        title: document.title,
        url: window.location.href,
      }),
    });

    const pageData = result[0]?.result;
    if (!pageData || pageData.pageText.length < 200) return;

    const summary = await sendMessage({
      type: 'PAGE_SUMMARIZE',
      payload: pageData,
    }) as { summary: string };

    if (settings.notificationsEnabled && summary.summary) {
      await chrome.notifications.create(`summary_${tabId}`, {
        type: 'basic',
        iconUrl: 'assets/icons/icon48.png',
        title: 'Page Summary',
        message: summary.summary.slice(0, 200),
        contextMessage: new URL(pageData.url).hostname,
      });
    }
  } catch {
    // Page might not support scripting; silently skip
  }
});

function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response as T);
    });
  });
}
