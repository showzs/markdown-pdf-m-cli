'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const cli = require('../index');

test('parses positional and long CLI arguments', () => {
  assert.deepEqual(cli.parseArgs([
    'README.md',
    '--type',
    'HTML,pdf',
    '--output=dist',
    '--config',
    'custom.json'
  ]), {
    types: ['html', 'pdf'],
    input: 'README.md',
    output: 'dist',
    config: 'custom.json'
  });
});

test('rejects missing option values and unknown options', () => {
  assert.throws(() => cli.parseArgs(['--type']), /Missing value for --type/);
  assert.throws(() => cli.parseArgs(['--unknown']), /Unknown option: --unknown/);
});

test('resolves output types with CLI precedence, all expansion, and deduplication', () => {
  assert.deepEqual(cli.resolveTypes(['HTML', 'pdf', 'html'], ['jpeg']), ['html', 'pdf']);
  assert.deepEqual(cli.resolveTypes([], ['all']), ['html', 'pdf', 'png', 'jpeg']);
  assert.throws(() => cli.resolveTypes(['docx'], []), /No valid output types/);
});

test('deep merges nested configuration and replaces arrays', () => {
  const result = cli.deepMerge(
    { markdownPdf: { margin: { top: '1cm', left: '1cm' }, styles: ['a'] } },
    { markdownPdf: { margin: { top: '2cm' }, styles: ['b'] } }
  );
  assert.deepEqual(result, {
    markdownPdf: { margin: { top: '2cm', left: '1cm' }, styles: ['b'] }
  });
});

test('resolves output and resource paths relative to the input file', () => {
  const input = path.join('docs', 'guide.md');
  const config = { markdownPdf: { outputDirectory: 'dist', outputDirectoryRelativePathFile: true } };
  assert.equal(
    cli.resolveOutputPath(input, 'html', undefined, config),
    path.resolve('docs', 'dist', 'guide.html')
  );

  const href = cli.fixHref(input, 'assets/site.css', { markdownPdf: { stylesRelativePathFile: true } });
  assert.match(href, /^file:\/\/\/.*docs.*assets.*site\.css$/);
});

test('builds PDF and screenshot options from configuration', () => {
  const pdf = cli.buildPdfOptions('out.pdf', {
    orientation: 'landscape',
    scale: '1.25',
    format: 'A4',
    margin: { top: '1cm' }
  });
  assert.equal(pdf.landscape, true);
  assert.equal(pdf.scale, 1.25);
  assert.equal(pdf.margin.top, '1cm');
  assert.equal(pdf.path, 'out.pdf');

  const screenshot = cli.buildScreenshotOptions('out.jpeg', 'jpeg', {
    quality: '80',
    clip: { x: 1, y: 2, width: 300, height: 400 }
  });
  assert.equal(screenshot.quality, 80);
  assert.deepEqual(screenshot.clip, { x: 1, y: 2, width: 300, height: 400 });
  assert.equal(screenshot.fullPage, false);
});

test('normalizes browser variants and numeric helpers', () => {
  assert.equal(cli.normalizeVariantKey('2.1.1'), 'modern');
  assert.equal(cli.normalizeVariantKey('legacy'), 'modern');
  assert.equal(cli.normalizeVariantKey('latest'), 'modern');
  assert.equal(cli.toNumber('bad', 7), 7);
  assert.equal(cli.normalizeDimension('  '), undefined);
  assert.equal(cli.setBooleanValue(false, true), false);
});

test('parses YAML front matter and preserves Markdown content', () => {
  assert.deepEqual(
    cli.parseFrontMatter('---\r\nbreaks: true\r\nnested:\r\n  enabled: false\r\n---\r\n# Title'),
    {
      data: { breaks: true, nested: { enabled: false } },
      content: '# Title'
    }
  );
});

test('leaves Markdown without front matter unchanged', () => {
  assert.deepEqual(cli.parseFrontMatter('# Title'), {
    data: {},
    content: '# Title'
  });
});
