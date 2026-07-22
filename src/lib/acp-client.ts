import type { ApiMessage, Session, EnterpriseAgent } from '../types';

export class ACPClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string
  ) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getEnterpriseAgent(): Promise<EnterpriseAgent> {
    return this.request<EnterpriseAgent>('/api/ambient/v1/users/me/enterprise-agent');
  }

  async createSession(agentId: string, projectId?: string): Promise<Session> {
    return this.request<Session>('/api/ambient/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId, projectId }),
    });
  }

  async sendMessage(sessionId: string, content: string): Promise<ApiMessage> {
    return this.request<ApiMessage>(
      `/api/ambient/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ role: 'user', content }),
      }
    );
  }

  async getMessages(sessionId: string): Promise<ApiMessage[]> {
    return this.request<ApiMessage[]>(
      `/api/ambient/v1/sessions/${sessionId}/messages`
    );
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/api/ambient/v1/sessions/${sessionId}`);
  }
}
