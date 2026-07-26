'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cli = require('../index');

test('exports browser output through an injected Puppeteer runtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-pdf-m-cli-browser-'));
  const input = path.join(dir, 'sample.md');
  const output = path.join(dir, 'sample.pdf');
  fs.writeFileSync(input, '# Sample', 'utf8');
  const calls = [];
  const runtime = {
    executablePath: 'fake-browser',
    puppeteerVariant: {
      module: {
        async launch(options) {
          calls.push(['launch', options]);
          return {
            async newPage() {
              return {
                async setDefaultTimeout(value) { calls.push(['timeout', value]); },
                async goto(url, options) { calls.push(['goto', url, options]); },
                async pdf(options) { calls.push(['pdf', options]); },
                async screenshot(options) { calls.push(['screenshot', options]); }
              };
            },
            async close() { calls.push(['close']); }
          };
        }
      }
    }
  };
  try {
    await cli.exportDocument('<html></html>', input, 'pdf', dir, {
      markdownPdf: { debug: false, format: 'A4' }
    }, runtime);
    assert.equal(fs.existsSync(output), false);
    assert.equal(calls[0][0], 'launch');
    assert.equal(calls.some((call) => call[0] === 'goto'), true);
    assert.equal(calls.some((call) => call[0] === 'pdf'), true);
    assert.equal(calls.some((call) => call[0] === 'close'), true);
    assert.equal(fs.existsSync(path.join(dir, 'sample_tmp.html')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
