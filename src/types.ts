// Types shared across background, content, and popup contexts

export type MessageType =
  | 'AUTH_CHECK'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'AUTH_TOKEN'
  | 'CHAT_MESSAGE'
  | 'CHAT_RESPONSE'
  | 'CHAT_STREAM'
  | 'CHAT_DONE'
  | 'CHAT_ERROR'
  | 'CONTEXT_EXTRACT'
  | 'CONTEXT_RESPONSE'
  | 'SIDEBAR_TOGGLE'
  | 'SIDEBAR_OPEN'
  | 'SIDEBAR_CLOSE'
  | 'SETTINGS_GET'
  | 'SETTINGS_SET'
  | 'SETTINGS_RESPONSE'
  | 'SETTINGS_CHANGED'
  | 'TASK_CREATE'
  | 'TASK_LIST'
  | 'TASK_UPDATE'
  | 'TASK_DELETE'
  | 'TASK_RESPONSE'
  | 'PAGE_SUMMARIZE'
  | 'PAGE_SUMMARY'
  | 'SESSION_CREATE'
  | 'SESSION_LIST'
  | 'SESSION_GET'
  | 'SESSION_APPEND'
  | 'SESSION_DELETE';

export interface Message {
  type: MessageType;
  payload?: unknown;
  requestId?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user?: UserProfile;
  accessToken?: string;
  expiresAt?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  groups?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  context?: PageContext;
}

export interface PageContext {
  url: string;
  title: string;
  selectedText?: string;
  pageText?: string;
  metadata?: Record<string, string>;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionSettings {
  /** Anthropic API endpoint — used only when proxyEndpoint is empty. */
  apiEndpoint: string;
  /**
   * Enterprise API gateway/proxy URL. When set, all AI requests are sent here
   * with the user's OAuth bearer token instead of directly to Anthropic.
   * The proxy is responsible for authentication, logging, and cost allocation.
   */
  proxyEndpoint: string;
  /** Direct Anthropic API key (dev/testing only — do not distribute). */
  anthropicApiKey: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  ssoProvider: 'azure' | 'okta' | 'google' | 'keycloak' | 'custom';
  ssoClientId: string;
  /** Okta organisation subdomain (e.g. "mycompany" → mycompany.okta.com). Separate from clientId. */
  ssoOktaDomain: string;
  /** Keycloak issuer URL (e.g. "https://keycloak.example.com/realms/my-realm"). */
  ssoKeycloakIssuer: string;
  ssoAuthUrl?: string;
  ssoTokenUrl?: string;
  enablePageContext: boolean;
  enableAutoSummarize: boolean;
  enableTaskSync: boolean;
  theme: 'light' | 'dark' | 'system';
  language: string;
  notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiEndpoint: 'https://api.anthropic.com',
  proxyEndpoint: '',
  anthropicApiKey: '',
  modelId: 'claude-sonnet-4-6',
  maxTokens: 4096,
  temperature: 0.7,
  ssoProvider: 'keycloak',
  ssoClientId: 'ambient-browser-extension',
  ssoOktaDomain: '',
  ssoKeycloakIssuer: '',
  enablePageContext: false,
  enableAutoSummarize: false,
  enableTaskSync: false,
  theme: 'system',
  language: 'en',
  notificationsEnabled: true,
};
