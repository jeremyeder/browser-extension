import type { Message, AuthState, ExtensionSettings, Task, ChatMessage } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { AuthManager } from './auth-manager';
import { StorageManager } from './storage-manager';

import { AssistantClient } from './assistant-client';

// Side-effect imports — registers listeners that must be active from service-worker startup
import './auto-summarize';
import './notifications';

const storage = new StorageManager();
const auth = new AuthManager(storage);
const assistant = new AssistantClient(storage);

// Open side panel on toolbar icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Initialize on install or update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await storage.setSettings(DEFAULT_SETTINGS);
    await chrome.sidePanel.setOptions({ enabled: true });
  } else if (details.reason === 'update') {
    const current = await storage.getSettings();
    if (current.ssoProvider !== 'keycloak') {
      await storage.setSettings({ ...current, ssoProvider: 'keycloak' as const });
    }
  }

  // Always recreate context menu items (also needed on update to reflect any renames)
  try {
    chrome.contextMenus.create({
      id: 'enterprise-assistant-summarize',
      title: 'Summarize with Enterprise Assistant',
      contexts: ['selection', 'page'],
    });
    chrome.contextMenus.create({
      id: 'enterprise-assistant-ask',
      title: 'Ask Enterprise Assistant about selection',
      contexts: ['selection'],
    });
  } catch {
    // Items may already exist (e.g., on update); non-fatal
  }
});

// Context menu handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const payload =
    info.menuItemId === 'enterprise-assistant-summarize'
      ? { action: 'summarize', selectedText: info.selectionText }
      : { action: 'ask', selectedText: info.selectionText };

  chrome.tabs.sendMessage(tab.id, { type: 'SIDEBAR_OPEN', payload }).catch(() => {
    // Tab may not have the content script loaded (e.g., chrome:// pages)
  });
});

// Message handler — routes from popup / content / options
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      sendResponse({ error: msg });
    });
  return true; // keep channel open for async response
});

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'AUTH_CHECK':
      return auth.getState();

    case 'AUTH_LOGIN':
      return auth.login();

    case 'AUTH_LOGOUT':
      await auth.logout();
      return { success: true };

    case 'CHAT_MESSAGE': {
      const authState: AuthState = await auth.getState();
      if (!authState.isAuthenticated) return { error: 'Not authenticated' };
      const payload = message.payload as {
        messages: ChatMessage[];
        context?: { pageText?: string; selectedText?: string };
      };
      return assistant.chat(payload.messages, payload.context, authState);
    }

    case 'CONTEXT_EXTRACT': {
      // Content script sends CONTEXT_EXTRACT when the popup requests context via the active tab.
      // Use sender.tab if available; otherwise fall back to the active tab.
      const tabId = sender.tab?.id ?? (await getActiveTabId());
      if (!tabId) return { error: 'Could not determine active tab' };
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPageContext,
      });
      return result[0]?.result ?? null;
    }

    case 'SETTINGS_GET':
      return storage.getSettings();

    case 'SETTINGS_SET': {
      const settings = message.payload as Partial<ExtensionSettings>;
      await storage.updateSettings(settings);
      // Broadcast change to all extension views so they can re-render without reload
      chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' }).catch(() => {
        // No listeners open — not an error
      });
      return { success: true };
    }

    case 'TASK_LIST':
      return storage.getTasks();

    case 'TASK_CREATE': {
      const task = message.payload as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
      return storage.createTask(task);
    }

    case 'TASK_UPDATE': {
      const { id, updates } = message.payload as { id: string; updates: Partial<Task> };
      await storage.updateTask(id, updates);
      return { success: true };
    }

    case 'TASK_DELETE': {
      await storage.deleteTask(message.payload as string);
      return { success: true };
    }

    case 'SESSION_LIST':
      return storage.getChatSessions();

    case 'SESSION_GET':
      return storage.getChatSession(message.payload as string);

    case 'SESSION_CREATE': {
      const firstMsg = message.payload as ChatMessage | undefined;
      return storage.createChatSession(firstMsg);
    }

    case 'SESSION_APPEND': {
      const { sessionId, message: msg } = message.payload as {
        sessionId: string;
        message: ChatMessage;
      };
      await storage.appendToSession(sessionId, msg);
      return { success: true };
    }

    case 'SESSION_DELETE': {
      await storage.deleteChatSession(message.payload as string);
      return { success: true };
    }

    case 'PAGE_SUMMARIZE': {
      const authState = await auth.getState();
      if (!authState.isAuthenticated) return { error: 'Not authenticated' };
      const { pageText, url, title } = message.payload as {
        pageText: string;
        url: string;
        title: string;
      };
      return assistant.summarizePage(pageText, url, title, authState);
    }

    default:
      return { error: `Unknown message type: ${String((message as Message).type)}` };
  }
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/** Serialisable function injected into the tab via scripting.executeScript. */
function extractPageContext() {
  const selectedText = window.getSelection()?.toString().trim() ?? '';
  const metaTags: Record<string, string> = {};
  document.querySelectorAll<HTMLMetaElement>('meta[name], meta[property]').forEach((el) => {
    const key = el.getAttribute('name') ?? el.getAttribute('property') ?? '';
    const value = el.getAttribute('content') ?? '';
    if (key && value) metaTags[key] = value;
  });
  return {
    url: window.location.href,
    title: document.title,
    selectedText,
    pageText: document.body?.innerText?.slice(0, 8000) ?? '',
    metadata: metaTags,
  };
}

// Periodic token refresh
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'token-refresh') {
    auth.refreshIfNeeded().catch(() => {
      // Handled internally in AuthManager; log nothing to avoid leaking tokens
    });
  }
});

chrome.alarms.create('token-refresh', { periodInMinutes: 5 });
