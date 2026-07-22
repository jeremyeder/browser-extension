/**
 * Renders a subset of Markdown to HTML.
 * Handles: headings, bold, italic, inline code, fenced code blocks, links, lists, paragraphs.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  // Protect fenced code blocks first — extract them to avoid other transforms touching them
  const codeBlocks: string[] = [];
  let html = text.replace(/```(?:[\w-]*)?\n([\s\S]*?)```/g, (_match, code) => {
    const codeStr = String(code).replace(/\n$/, '');
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(codeStr)}</code></pre>`);
    return `\x00CODE_BLOCK_${idx}\x00`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${escapeHtml(code)}</code>`);

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links [label](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Headings (must be at start of line)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Lists — consecutive list items get wrapped in <ul>
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n(<li>[\s\S]*?<\/li>))*/g, (match) =>
    `<ul>${match}</ul>`
  );

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs — split on blank lines
  const paragraphs = html.split(/\n{2,}/);
  html = paragraphs
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (/^(<h[1-6]|<pre|<ul|<li|\x00CODE_BLOCK)/.test(b)) return b;
      return `<p>${b.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  // Restore code blocks
  codeBlocks.forEach((cb, i) => {
    html = html.replace(`\x00CODE_BLOCK_${i}\x00`, cb);
  });

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
