import { renderMarkdown } from '../src/utils/markdown';

describe('renderMarkdown', () => {
  test('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  test('wraps plain text in <p>', () => {
    expect(renderMarkdown('Hello world')).toContain('<p>Hello world</p>');
  });

  test('renders bold text', () => {
    const result = renderMarkdown('**bold**');
    expect(result).toContain('<strong>bold</strong>');
  });

  test('renders italic text', () => {
    const result = renderMarkdown('*italic*');
    expect(result).toContain('<em>italic</em>');
  });

  test('renders inline code', () => {
    const result = renderMarkdown('`code`');
    expect(result).toContain('<code>code</code>');
  });

  test('renders fenced code blocks', () => {
    const input = '```javascript\nconsole.log("hi");\n```';
    const result = renderMarkdown(input);
    expect(result).toContain('<pre><code>');
    expect(result).toContain('console.log');
  });

  test('renders h1 heading', () => {
    const result = renderMarkdown('# Title');
    expect(result).toContain('<h1>Title</h1>');
  });

  test('renders h2 heading', () => {
    const result = renderMarkdown('## Subtitle');
    expect(result).toContain('<h2>Subtitle</h2>');
  });

  test('renders h3 heading', () => {
    const result = renderMarkdown('### Section');
    expect(result).toContain('<h3>Section</h3>');
  });

  test('renders links', () => {
    const result = renderMarkdown('[Example](https://example.com)');
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('Example');
  });

  test('renders unordered list items', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('<li>item one</li>');
    expect(result).toContain('<li>item two</li>');
  });

  test('does not double-process code block contents', () => {
    const input = '```\n**not bold**\n```';
    const result = renderMarkdown(input);
    // Bold markers inside code blocks should be escaped, not rendered
    expect(result).not.toContain('<strong>not bold</strong>');
  });
});
