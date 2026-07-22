import type { ChatMessage, AuthState, ExtensionSettings } from '../types';
import type { StorageManager } from './storage-manager';

const SYSTEM_PROMPT = `You are an Enterprise Assistant — an AI embedded in the user's browser to help with workplace productivity. You help users:
- Summarize and understand web pages and documents
- Answer questions about content they're reading
- Draft emails, messages, and documents
- Manage tasks and action items
- Analyze meeting notes and extract action items

Be concise, professional, and enterprise-appropriate. If context from the current page is provided, use it to give more relevant answers. Respect confidentiality — do not speculate about proprietary information beyond what is provided.`;

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
/** HTTP status codes that are safe to retry. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class AssistantClient {
  constructor(private readonly storage: StorageManager) {}

  async chat(
    messages: ChatMessage[],
    context: { pageText?: string; selectedText?: string } | undefined,
    authState: AuthState,
  ): Promise<{ content: string }> {
    const settings = await this.storage.getSettings();
    const systemWithContext = this.buildSystem(context);

    const body = JSON.stringify({
      model: settings.modelId,
      max_tokens: settings.maxTokens,
      system: systemWithContext,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });

    const response = await this.fetchWithRetry(settings, authState, '/v1/messages', body);
    const data = (await response.json()) as AnthropicResponse;
    const text = data.content.find((c) => c.type === 'text')?.text ?? '';
    return { content: text };
  }

  async summarizePage(
    pageText: string,
    url: string,
    title: string,
    authState: AuthState,
  ): Promise<{ summary: string; keyPoints: string[]; actionItems: string[] }> {
    const settings = await this.storage.getSettings();

    const body = JSON.stringify({
      model: settings.modelId,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Summarize the following page and extract key points and any action items.

Page: ${title}
URL: ${url}

Content:
${pageText.slice(0, 6000)}

Respond ONLY with valid JSON matching this schema:
{"summary":"string","keyPoints":["string"],"actionItems":["string"]}`,
        },
      ],
    });

    const response = await this.fetchWithRetry(settings, authState, '/v1/messages', body);
    const data = (await response.json()) as AnthropicResponse;
    const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as {
        summary?: string;
        keyPoints?: string[];
        actionItems?: string[];
      };
      return {
        summary: parsed.summary ?? '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      };
    } catch {
      return { summary: text, keyPoints: [], actionItems: [] };
    }
  }

  /**
   * Route preference:
   *  1. Enterprise proxy/gateway (proxyEndpoint set) — sends bearer token, gateway authenticates
   *  2. Direct Anthropic API key (anthropicApiKey set) — dev/testing only
   *  3. Error — no valid auth route configured
   */
  private async fetchWithRetry(
    settings: ExtensionSettings,
    authState: AuthState,
    path: string,
    body: string,
  ): Promise<Response> {
    const { url, headers } = this.resolveEndpoint(settings, authState);

    let lastErr: Error = new Error('No attempts made');
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
      }

      let response: Response;
      try {
        response = await fetch(`${url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
        });
      } catch (err) {
        // Network error — always retry
        lastErr = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      if (response.ok) return response;

      if (RETRYABLE_STATUSES.has(response.status)) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const waitMs = parseFloat(retryAfter) * 1000;
          await delay(Math.min(waitMs, 30_000));
        }
        lastErr = new Error(`API error ${response.status}`);
        continue;
      }

      // Non-retryable error (400, 401, 403, etc.)
      const errBody = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${errBody}`);
    }

    throw lastErr;
  }

  private resolveEndpoint(
    settings: ExtensionSettings,
    authState: AuthState,
  ): { url: string; headers: Record<string, string> } {
    if (settings.proxyEndpoint) {
      // Enterprise proxy — auth via bearer token from SSO
      return {
        url: settings.proxyEndpoint.replace(/\/$/, ''),
        headers: {
          Authorization: `Bearer ${authState.accessToken ?? ''}`,
          'anthropic-version': '2023-06-01',
        },
      };
    }

    if (settings.anthropicApiKey) {
      // Direct Anthropic — for dev/testing
      return {
        url: settings.apiEndpoint.replace(/\/$/, ''),
        headers: {
          'x-api-key': settings.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      };
    }

    throw new Error(
      'No API route configured. Set a proxyEndpoint (enterprise) or anthropicApiKey (dev) in Settings.',
    );
  }

  private buildSystem(context: { pageText?: string; selectedText?: string } | undefined): string {
    if (!context) return SYSTEM_PROMPT;
    const parts: string[] = [];
    if (context.selectedText) {
      parts.push(`<selected_text>\n${context.selectedText}\n</selected_text>`);
    } else if (context.pageText) {
      parts.push(`<page_content>\n${context.pageText.slice(0, 3000)}\n</page_content>`);
    }
    if (parts.length === 0) return SYSTEM_PROMPT;
    return `${SYSTEM_PROMPT}\n\n${parts.join('\n\n')}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}
