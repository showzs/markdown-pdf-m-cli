'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cli = require('../index');

const inputPath = path.join(os.tmpdir(), 'markdown-pdf-m-cli-test.md');

test.before(() => {
  fs.writeFileSync(inputPath, '# fixture', 'utf8');
});

test.after(() => {
  fs.rmSync(inputPath, { force: true });
});

test('converts Markdown features and front matter to HTML', () => {
  const markdown = [
    '---',
    'breaks: true',
    'emoji: false',
    '---',
    '',
    '# Hello World',
    '',
    'Hello',
    'world',
    '',
    '- [x] done',
    '',
    '```js',
    'const value = 1;',
    '```',
    '',
    '::: note',
    'content',
    ':::'
  ].join('\n');
  const html = cli.convertMarkdownToHtml(inputPath, 'html', markdown, {
    markdownPdf: {
      breaks: false,
      emoji: true,
      'markdown-it-include': { enable: false },
      plantumlServer: ''
    }
  });

  assert.match(html, /<h1 id="hello-world">Hello World<\/h1>/);
  assert.match(html, /<input[^>]+type="checkbox"/);
  assert.match(html, /class="hljs"/);
  assert.match(html, /<div class="note">/);
  assert.match(html, /Hello<br>\nworld/);
});

test('uses file URLs for local images in browser output', () => {
  const html = cli.convertMarkdownToHtml(
    inputPath,
    'pdf',
    '![image](assets/image.png)',
    { markdownPdf: { emoji: false, 'markdown-it-include': { enable: false } } }
  );
  assert.match(html, /src="file:\/\/\/.*assets\/image\.png"/);
});

test('assembles CSS, Mermaid, and content through the template', () => {
  const html = cli.makeHtml('<p>content</p>', inputPath, {
    markdownPdf: {
      mermaidServer: 'https://example.test/mermaid.js',
      includeDefaultStyles: false,
      highlight: false
    }
  });
  assert.match(html, /<script src="https:\/\/example\.test\/mermaid\.js"><\/script>/);
  assert.match(html, /<p>content<\/p>/);
  assert.match(html, /<title>markdown-pdf-m-cli-test\.md<\/title>/);
});
