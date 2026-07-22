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
    const visible = items.filter((m) => {
      if (m.event_type !== 'user' && m.event_type !== 'assistant') return false;
      const text = (m.payload ?? '').toLowerCase();
      // Skip bootstrap: system prompts, agent instructions, internal monologue
      if (m.event_type === 'user' && (
        text.includes('directives:') ||
        text.includes('you are artoo') ||
        text.includes('you are an enterprise assistant') ||
        text.includes('enterprise assistant session') ||
        text.includes('interaction style:') ||
        text.length > 500 // bootstrap prompts are very long
      )) return false;
      if (m.event_type === 'assistant' && (
        text.includes('check my memory') ||
        text.includes('no prior memory found') ||
        text.includes('let me read') ||
        text.includes('let me check')
      )) return false;
      return true;
    });

    return visible.map((m) => ({
      role: m.event_type as 'user' | 'assistant',
      content: m.payload ?? '',
    }));
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/api/ambient/v1/sessions/${sessionId}`);
  }
}
