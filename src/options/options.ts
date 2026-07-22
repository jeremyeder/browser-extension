import './options.css';
import { StorageManager } from '../background/storage-manager';
import type { Settings } from '../types';

const acpUrlInput = document.getElementById('acp-url') as HTMLInputElement;
const themeSelect = document.getElementById('theme') as HTMLSelectElement;
const notificationsCheck = document.getElementById('notifications') as HTMLInputElement;
const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

async function load(): Promise<void> {
  const settings = await StorageManager.getSettings();
  acpUrlInput.value = settings.acpServerUrl;
  themeSelect.value = settings.theme;
  notificationsCheck.checked = settings.notifications;
  applyTheme(settings.theme);
}

themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value as Settings['theme']);
});

saveBtn.addEventListener('click', () => {
  void (async () => {
    const settings: Settings = {
      acpServerUrl: acpUrlInput.value.trim(),
      theme: themeSelect.value as Settings['theme'],
      notifications: notificationsCheck.checked,
    };
    await StorageManager.saveSettings(settings);
    applyTheme(settings.theme);

    statusEl.textContent = 'Settings saved';
    statusEl.className = 'status success';
    setTimeout(() => {
      statusEl.className = 'status hidden';
    }, 2500);
  })();
});

void load();
