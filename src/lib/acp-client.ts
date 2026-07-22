import type { ApiMessage, Session, EnterpriseAgent } from '../types';

interface RawMessage {
  event_type: string;
  payload?: string;
  seq?: number;
}

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
      // Fallback: list agents in the enterprise-assistant project
      const data = await this.request<{ items: EnterpriseAgent[] }>(
        '/api/ambient/v1/projects/enterprise-assistant/agents'
      );
      if (data.items?.length > 0) {
        const agent = data.items[0];
        return { id: agent.id, name: agent.name, projectId: (agent as any).project_id ?? 'enterprise-assistant' };
      }
      throw new Error('No enterprise agent found. Ask your ACP admin to create one.');
    }
  }

  async findOrCreateSession(agentId: string, projectId: string): Promise<Session> {
    const data = await this.request<{ items: Session[] }>('/api/ambient/v1/sessions');
    const active = data.items?.find(
      (s) => s.agent_id === agentId &&
        (s.phase === 'Running' || s.phase === 'Creating' || s.phase === 'Pending')
    );
    if (active) return active;

    // Return any session for this agent (even dead ones for phase detection)
    const any = data.items?.find((s) => s.agent_id === agentId);
    if (any) return any;

    return this.createNewSession(agentId, projectId);
  }

  async createNewSession(agentId: string, projectId: string): Promise<Session> {
    return this.request<Session>('/api/ambient/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: agentId,
        project_id: projectId,
        name: `ea-${Date.now()}`,
        prompt: 'Enterprise Assistant session',
      }),
    });
  }

  async sendMessage(sessionId: string, content: string): Promise<ApiMessage> {
    return this.request<ApiMessage>(
      `/api/ambient/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ event_type: 'user', payload: content }),
      }
    );
  }

  async getMessages(sessionId: string): Promise<ApiMessage[]> {
    const data = await this.request<{ items?: RawMessage[] } | RawMessage[]>(
      `/api/ambient/v1/sessions/${sessionId}/messages`
    );
    const items = Array.isArray(data) ? data : (data.items ?? []);
    const userAndAssistant = items.filter(
      (m) => m.event_type === 'user' || m.event_type === 'assistant'
    );

    // Skip bootstrap messages (ACP injects system prompt + agent instructions at session start).
    // Find the first user message sent AFTER the initial assistant greeting.
    let firstAssistantIdx = userAndAssistant.findIndex((m) => m.event_type === 'assistant');
    if (firstAssistantIdx === -1) firstAssistantIdx = 0;

    // Find the first user message after the assistant's greeting — that's the real conversation start
    let conversationStart = userAndAssistant.findIndex(
      (m, i) => i > firstAssistantIdx && m.event_type === 'user'
    );

    // If no user message after greeting, show from the greeting onward
    if (conversationStart === -1) conversationStart = firstAssistantIdx;

    // Include the last assistant greeting message before the first real user message
    const startIdx = Math.max(0, conversationStart - 1);

    return userAndAssistant
      .slice(startIdx)
      .map((m) => ({ role: m.event_type as 'user' | 'assistant', content: m.payload ?? '' }));
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/api/ambient/v1/sessions/${sessionId}`);
  }
}
