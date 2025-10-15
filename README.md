# markdown-pdf-m-cli

Command-line tool for converting Markdown documents into PDF, HTML, PNG, or JPEG outputs using the same rendering pipeline as the original VS Code extension.

## Installation

```bash
npm install --global .
```

Or run locally without installing:

```bash
npm install
npm run start -- --help
```

## Usage

```bash
markdown-pdf-m <input-file> [options]
```

### Options

| Option | Description |
| --- | --- |
| `-t, --type <types>` | Comma-separated list of output types (`html`, `pdf`, `png`, `jpeg`, or `all`). |
| `-o, --output <dir>` | Override the output directory. |
| `--config <file>` | Path to a custom configuration JSON file. |
| `-h, --help` | Show usage help. |
| `-v, --version` | Show the current version. |

If no `--type` is provided, the tool uses the value from `config/defaults.json` (defaults to `pdf`).

## Configuration

The CLI reads configuration from the bundled `config/defaults.json`. You can create a `markdown-pdf.config.json` in your project directory (or point to a file with `--config`) to override any setting. The structure mirrors the original VS Code settings, for example:

```json
{
  "markdownPdf": {
    "type": ["html", "pdf"],
    "outputDirectory": "dist",
    "highlightStyle": "github",
    "plantumlServer": "https://www.plantuml.com/plantuml"
  }
}
```

## Examples

Convert a Markdown file to PDF and HTML:

```bash
markdown-pdf-m docs/guide.md --type pdf,html
```

Render multiple files with a shared configuration:

```bash
markdown-pdf-m docs/design.md --config ./markdown-pdf.config.json --output ./dist
```

## Notes

- Chromium/Chrome is downloaded automatically if no executable is available. To reuse an existing installation, set `markdownPdf.browser.executablePath` (or the legacy `markdownPdf.executablePath`).
- Set `markdownPdf.browser.puppeteerCore` to `"legacy"` to run with `puppeteer-core@2.1.1` (useful for older Chromium builds such as `722234`). Leave it as `"modern"` (default) to keep using the latest Puppeteer runtime.
- To pin a specific browser build, provide `markdownPdf.browser.name` (`chrome`, `chromium`, or `chrome-headless-shell`) and `markdownPdf.browser.version` (for example `"stable"`, `"canary"`, or an explicit version like `"141.0.7390.54"`). The CLI will download and cache the requested build automatically.
- Proxy settings can be provided through `http.proxy` in the configuration file.
