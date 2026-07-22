/**
 * Notification click handler — routes user to the relevant tab or UI.
 */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('summary_')) {
    const tabId = parseInt(notificationId.replace('summary_', ''), 10);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) {
      await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  }
  await chrome.notifications.clear(notificationId);
});

export {};
