export interface Settings {
  acpServerUrl: string;
  notifications: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface ApiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export interface Session {
  id: string;
  status: string;
  createdAt: string;
  agentId?: string;
}

export interface EnterpriseAgent {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
}

export interface PageContext {
  url: string;
  title: string;
  selectedText: string;
  bodyText: string;
}

export type ExtensionMessage =
  | { type: 'GET_PAGE_CONTEXT' }
  | { type: 'PAGE_CONTEXT'; context: PageContext }
  | { type: 'OPEN_SETTINGS' };
