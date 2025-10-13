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

### Browser Configuration

You can configure the browser used by Puppeteer through the following `markdownPdf` configuration options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `executablePath` | string | `""` | Path to a Chrome/Chromium/Firefox executable. When set, this browser will be used instead of downloading one. |
| `browser` | string | `"chrome"` | Browser type to download and use. Options: `"chrome"`, `"chromium"`, or `"firefox"`. Only used when `executablePath` is not set. |
| `buildId` | string | `""` | Specific browser build/revision to download (e.g., `"123.0.6312.86"` or `"stable"`). When empty, uses the default Puppeteer revision. Only used when `executablePath` is not set. |
| `cacheDir` | string | `""` | Directory to cache downloaded browsers. When empty, defaults to `~/.cache/markdown-pdf-m-cli`. Can also be set via `MARKDOWN_PDF_BROWSER_CACHE` environment variable. |

**Example configuration with browser options:**

```json
{
  "markdownPdf": {
    "browser": "chrome",
    "buildId": "stable",
    "cacheDir": "./browser-cache"
  }
}
```

**Example using a custom executable:**

```json
{
  "markdownPdf": {
    "executablePath": "/usr/bin/google-chrome"
  }
}
```

**Note:** The tool will reuse cached browser downloads when available. If a matching browser (same type and build ID) is already in the cache directory, it will be used instead of downloading again.

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

- Chromium is downloaded automatically if no executable is available. The tool will reuse cached downloads when the same browser type and build are already available.
- Set `markdownPdf.executablePath` in your config to use an existing Chrome/Chromium/Firefox installation.
- Configure browser type, build version, and cache directory through `markdownPdf.browser`, `markdownPdf.buildId`, and `markdownPdf.cacheDir` options.
- Proxy settings can be provided through `http.proxy` in the configuration file.
