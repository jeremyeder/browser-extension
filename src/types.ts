export interface Settings {
  acpServerUrl: string;
  notifications: boolean;
  theme: 'light' | 'dark' | 'system';
  onboardingComplete?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface ApiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export interface Session {
  id: string;
  status: string;
  phase?: string;
  agent_id?: string;
  project_id?: string;
  annotations?: string;
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
