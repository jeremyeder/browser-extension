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
    // Try the enterprise-agent endpoint first (future API)
    try {
      return await this.request<EnterpriseAgent>('/api/ambient/v1/users/me/enterprise-agent');
    } catch {
      // Fallback: list agents across projects and use the first one
      const data = await this.request<{ items: EnterpriseAgent[] }>('/api/ambient/v1/agents');
      if (data.items?.length > 0) {
        const agent = data.items[0];
        return { id: agent.id, name: agent.name, projectId: agent.projectId ?? (agent as any).project_id };
      }
      throw new Error('No agents found. Ask your ACP admin to create one.');
    }
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
