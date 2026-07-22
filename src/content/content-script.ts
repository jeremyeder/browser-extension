import type { Message } from '../types';

// Sidebar state
let sidebarOpen = false;
let sidebarEl: HTMLDivElement | null = null;
let iframeEl: HTMLIFrameElement | null = null;

// Listen for messages from background / popup
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'SIDEBAR_TOGGLE':
      toggleSidebar();
      sendResponse({ ok: true });
      break;

    case 'SIDEBAR_OPEN': {
      openSidebar();
      const payload = message.payload as { action?: string; selectedText?: string } | undefined;
      if (payload?.selectedText && iframeEl?.contentWindow) {
        iframeEl.contentWindow.postMessage(
          { type: 'PRELOAD_CONTEXT', payload },
          chrome.runtime.getURL(''),
        );
      }
      sendResponse({ ok: true });
      break;
    }

    case 'SIDEBAR_CLOSE':
      closeSidebar();
      sendResponse({ ok: true });
      break;

    case 'CONTEXT_EXTRACT':
      sendResponse(extractContext());
      break;

    default:
      sendResponse({ error: 'Unknown message' });
  }
  return true;
});

// Keyboard shortcut listener (Ctrl+Shift+S / Cmd+Shift+S)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleSidebar();
  }
});

function toggleSidebar() {
  if (sidebarOpen) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  if (sidebarOpen) return;

  injectStyles();
  createSidebar();
  sidebarOpen = true;

  document.documentElement.style.setProperty(
    'margin-right',
    `${SIDEBAR_WIDTH}px`,
    'important',
  );
}

function closeSidebar() {
  if (!sidebarOpen || !sidebarEl) return;
  sidebarEl.style.transform = `translateX(${SIDEBAR_WIDTH}px)`;
  setTimeout(() => {
    sidebarEl?.remove();
    sidebarEl = null;
    iframeEl = null;
    document.documentElement.style.removeProperty('margin-right');
    sidebarOpen = false;
  }, 250);
}

const SIDEBAR_WIDTH = 380;

function createSidebar() {
  sidebarEl = document.createElement('div');
  sidebarEl.id = 'enterprise-assistant-sidebar';
  sidebarEl.setAttribute('data-ea-sidebar', '');
  sidebarEl.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: ${SIDEBAR_WIDTH}px;
    height: 100vh;
    z-index: 2147483647;
    background: #fff;
    box-shadow: -2px 0 16px rgba(0,0,0,0.15);
    transform: translateX(${SIDEBAR_WIDTH}px);
    transition: transform 0.25s ease;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #e4e4e7;
  `;

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close Enterprise Assistant');
  closeBtn.style.cssText = `
    position: absolute;
    top: 8px;
    left: -36px;
    width: 28px;
    height: 28px;
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
    z-index: 2147483647;
  `;
  closeBtn.addEventListener('click', closeSidebar);
  sidebarEl.appendChild(closeBtn);

  iframeEl = document.createElement('iframe');
  iframeEl.src = chrome.runtime.getURL('popup/index.html') + '?mode=sidebar';
  iframeEl.style.cssText = `
    width: 100%;
    flex: 1;
    border: none;
    background: transparent;
  `;
  // allow-same-origin is intentionally omitted: combining it with allow-scripts
  // removes the sandboxing protection and lets the iframe access the host page's origin.
  iframeEl.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
  sidebarEl.appendChild(iframeEl);

  document.documentElement.appendChild(sidebarEl);

  // Trigger animation after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (sidebarEl) sidebarEl.style.transform = 'translateX(0)';
    });
  });
}

function injectStyles() {
  if (document.getElementById('ea-sidebar-styles')) return;
  const style = document.createElement('style');
  style.id = 'ea-sidebar-styles';
  style.textContent = `
    html[data-ea-sidebar-open] {
      transition: margin-right 0.25s ease;
    }
  `;
  document.head.appendChild(style);
}

function extractContext() {
  const selectedText = window.getSelection()?.toString().trim() ?? '';
  const metaTags: Record<string, string> = {};
  document.querySelectorAll('meta[name], meta[property]').forEach((el) => {
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
