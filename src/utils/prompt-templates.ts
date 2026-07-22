/**
 * Built-in prompt templates. Users select one via the "/" prefix in the chat input.
 * Each template may include a {{placeholder}} that is filled with page context or selected text.
 */
export interface PromptTemplate {
  id: string;
  label: string;
  description: string;
  /** The prompt text. Use {{selection}} or {{pageText}} for dynamic substitution. */
  prompt: string;
}

export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'summarize',
    label: '/summarize',
    description: 'Summarize the selected text or current page',
    prompt: 'Please summarize the following:\n\n{{selection}}',
  },
  {
    id: 'explain',
    label: '/explain',
    description: 'Explain a concept simply',
    prompt: 'Explain the following clearly and concisely:\n\n{{selection}}',
  },
  {
    id: 'action-items',
    label: '/action-items',
    description: 'Extract action items from text',
    prompt: 'Extract all action items and next steps from the following:\n\n{{selection}}',
  },
  {
    id: 'draft-reply',
    label: '/draft-reply',
    description: 'Draft a professional reply to an email or message',
    prompt: 'Draft a professional reply to the following:\n\n{{selection}}\n\nReply tone: concise and helpful.',
  },
  {
    id: 'meeting-notes',
    label: '/meeting-notes',
    description: 'Format content as meeting notes',
    prompt: 'Reformat the following as clean meeting notes with attendees, decisions, and action items:\n\n{{selection}}',
  },
  {
    id: 'translate',
    label: '/translate',
    description: 'Translate selected text to English',
    prompt: 'Translate the following to English:\n\n{{selection}}',
  },
  {
    id: 'improve',
    label: '/improve',
    description: 'Improve writing clarity and tone',
    prompt: 'Improve the clarity and professional tone of the following text. Return only the improved version:\n\n{{selection}}',
  },
  {
    id: 'risks',
    label: '/risks',
    description: 'Identify risks in a document or plan',
    prompt: 'Identify key risks, assumptions, and open questions in the following:\n\n{{selection}}',
  },
];

export function fillTemplate(template: PromptTemplate, context: { selection?: string; pageText?: string }): string {
  return template.prompt
    .replace('{{selection}}', context.selection ?? context.pageText ?? '(no content selected)')
    .replace('{{pageText}}', context.pageText ?? '');
}
