import type { ExtensionSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const form = document.getElementById('settings-form') as HTMLFormElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;
const customSsoFields = document.getElementById('custom-sso-fields') as HTMLDivElement;
const oktaDomainField = document.getElementById('okta-domain-field') as HTMLDivElement;
const ssoProviderSelect = document.getElementById('sso-provider') as HTMLSelectElement;

async function loadSettings() {
  const settings = await sendMessage<ExtensionSettings>({ type: 'SETTINGS_GET' });
  populateForm(settings);
}

function populateForm(settings: ExtensionSettings) {
  setInput('proxy-endpoint', settings.proxyEndpoint);
  setInput('anthropic-api-key', settings.anthropicApiKey);
  setInput('api-endpoint', settings.apiEndpoint);
  setInput('model-id', settings.modelId);
  setInput('max-tokens', String(settings.maxTokens));
  setInput('temperature', String(settings.temperature));
  setInput('sso-provider', settings.ssoProvider);
  setInput('sso-client-id', settings.ssoClientId);
  setInput('sso-okta-domain', settings.ssoOktaDomain);
  setInput('sso-auth-url', settings.ssoAuthUrl ?? '');
  setInput('sso-token-url', settings.ssoTokenUrl ?? '');
  setCheckbox('enable-page-context', settings.enablePageContext);
  setCheckbox('enable-auto-summarize', settings.enableAutoSummarize);
  setCheckbox('notifications-enabled', settings.notificationsEnabled);
  setInput('theme', settings.theme);
  toggleProviderFields(settings.ssoProvider);
}

ssoProviderSelect.addEventListener('change', () => {
  toggleProviderFields(ssoProviderSelect.value);
});

function toggleProviderFields(provider: string) {
  customSsoFields.classList.toggle('hidden', provider !== 'custom');
  oktaDomainField.classList.toggle('hidden', provider !== 'okta');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = readForm();
  try {
    await sendMessage({ type: 'SETTINGS_SET', payload: settings });
    showStatus('Settings saved.', 'success');
  } catch (err) {
    showStatus('Failed to save settings.', 'error');
    console.error(err);
  }
});

document.getElementById('reset-btn')?.addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  await sendMessage({ type: 'SETTINGS_SET', payload: DEFAULT_SETTINGS });
  populateForm(DEFAULT_SETTINGS);
  showStatus('Settings reset.', 'success');
});

function readForm(): ExtensionSettings {
  return {
    proxyEndpoint: getInput('proxy-endpoint'),
    anthropicApiKey: getInput('anthropic-api-key'),
    apiEndpoint: getInput('api-endpoint') || DEFAULT_SETTINGS.apiEndpoint,
    modelId: getInput('model-id') || DEFAULT_SETTINGS.modelId,
    maxTokens: parseInt(getInput('max-tokens'), 10) || DEFAULT_SETTINGS.maxTokens,
    temperature: parseFloat(getInput('temperature')) || DEFAULT_SETTINGS.temperature,
    ssoProvider: getInput('sso-provider') as ExtensionSettings['ssoProvider'],
    ssoClientId: getInput('sso-client-id'),
    ssoOktaDomain: getInput('sso-okta-domain'),
    ssoAuthUrl: getInput('sso-auth-url') || undefined,
    ssoTokenUrl: getInput('sso-token-url') || undefined,
    enablePageContext: getCheckbox('enable-page-context'),
    enableAutoSummarize: getCheckbox('enable-auto-summarize'),
    enableTaskSync: false,
    theme: getInput('theme') as ExtensionSettings['theme'],
    language: DEFAULT_SETTINGS.language,
    notificationsEnabled: getCheckbox('notifications-enabled'),
  };
}

function showStatus(message: string, type: 'success' | 'error') {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${type}`;
  saveStatus.classList.remove('hidden');
  setTimeout(() => saveStatus.classList.add('hidden'), 3000);
}

function getInput(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
}

function setInput(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (el) el.value = value;
}

function getCheckbox(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
}

function setCheckbox(id: string, checked: boolean) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.checked = checked;
}

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

document.addEventListener('DOMContentLoaded', () => void loadSettings());
