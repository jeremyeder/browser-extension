import { renderMarkdown } from '../src/utils/markdown';

describe('renderMarkdown', () => {
  it('renders plain text as a paragraph', () => {
    expect(renderMarkdown('Hello world')).toBe('<p>Hello world</p>');
  });

  it('renders bold text', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('use `npm install`')).toContain('<code>npm install</code>');
  });

  it('renders fenced code blocks', () => {
    const md = '```js\nconsole.log("hi");\n```';
    const html = renderMarkdown(md);
    expect(html).toContain('<pre><code');
    expect(html).toContain('console.log');
  });

  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('## Section')).toBe('<h2>Section</h2>');
  });

  it('renders unordered lists', () => {
    const md = '- item one\n- item two';
    const html = renderMarkdown(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
  });

  it('renders ordered lists', () => {
    const md = '1. first\n2. second';
    const html = renderMarkdown(md);
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
  });

  it('escapes HTML in plain text', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders links', () => {
    const html = renderMarkdown('[Example](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not render javascript: links', () => {
    const html = renderMarkdown('[Click](javascript:alert(1))');
    // javascript: URL will not match the https? pattern and is not rendered as a link
    expect(html).not.toContain('href="javascript:');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted text')).toContain('<blockquote>');
  });

  it('renders strikethrough', () => {
    expect(renderMarkdown('~~deleted~~')).toContain('<del>deleted</del>');
  });

  it('renders horizontal rule', () => {
    expect(renderMarkdown('---')).toContain('<hr />');
  });
});
