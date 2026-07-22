import type { ExtensionMessage, PageContext } from '../types';

function extractPageContext(): PageContext {
  const selectedText = window.getSelection()?.toString().trim() ?? '';
  // Limit body text to avoid huge payloads
  const bodyText = document.body.innerText.slice(0, 4000);

  return {
    url: location.href,
    title: document.title,
    selectedText,
    bodyText,
  };
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_CONTEXT') {
      sendResponse({ type: 'PAGE_CONTEXT', context: extractPageContext() });
      return true;
    }
    return false;
  }
);
