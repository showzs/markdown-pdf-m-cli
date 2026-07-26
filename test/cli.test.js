'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.js');

test('prints help and version without starting browser output', () => {
  const help = execFileSync(process.execPath, [indexPath, '--help'], { encoding: 'utf8' });
  assert.match(help, /Usage: markdown-pdf-m-cli/);

  const version = execFileSync(process.execPath, [indexPath, '--version'], { encoding: 'utf8' });
  assert.equal(version.trim(), require('../package.json').version);
});

test('writes HTML output through the CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-pdf-m-cli-'));
  const input = path.join(dir, 'sample.md');
  fs.writeFileSync(input, '# Sample\n\ntext', 'utf8');
  try {
    execFileSync(process.execPath, [indexPath, input, '--type', 'html'], {
      cwd: root,
      encoding: 'utf8'
    });
    const output = fs.readFileSync(path.join(dir, 'sample.html'), 'utf8');
    assert.match(output, /<h1 id="sample">Sample<\/h1>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports missing input as a failed CLI invocation', () => {
  assert.throws(
    () => execFileSync(process.execPath, [indexPath, 'missing.md'], { cwd: root, encoding: 'utf8' }),
    (error) => error.status === 1 && `${error.stdout}${error.stderr}`.includes('Input file not found')
  );
});
