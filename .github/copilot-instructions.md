# Copilot Instructions

## Project overview

`markdown-pdf-m-cli` is a CommonJS Node.js command-line wrapper around a Markdown-to-document rendering pipeline. The executable is `index.js`, exposed as `markdown-pdf-m`; there is no transpilation or build step.

The main flow is:

1. Parse CLI arguments in `index.js` (`--input`, `--type`, `--output`, and `--config`).
2. Load `config/defaults.json`, then deep-merge the first project config found at `markdown-pdf.config.json` or the explicit `--config` path.
3. Convert Markdown (including front matter) with `markdown-it` and the configured plugins: syntax highlighting, checkboxes, emoji, containers, PlantUML, and optional file includes.
4. Rewrite local image/style paths for browser rendering, inject CSS and optional Mermaid into `template/template.html`, and render the final HTML.
5. Write HTML directly, or launch Puppeteer to export PDF/PNG/JPEG. Chromium is resolved from a configured executable, the cache, or an automatic download.

## Commands

Install dependencies:

```bash
npm install
```

Show CLI help or version:

```bash
npm run start -- --help
npm run start -- --version
```

Convert a document locally:

```bash
npm run start -- path/to/input.md --type pdf,html
npm run start -- path/to/input.md --config ./markdown-pdf.config.json --output ./dist
```

There is currently no build command or lint command. Tests use Node.js's built-in `node:test` runner:

```bash
npm test
node --test test/core.test.js
node --test --test-name-pattern="resolves output types" test/core.test.js
```

Browser output tests use stubs and do not download Chromium or call external services.

## Configuration and rendering conventions

- Keep user-facing settings under the `markdownPdf` object. `config/defaults.json` is the source of defaults; project configuration overrides it rather than replacing the whole object.
- CLI `--type` takes precedence over configuration. Supported output types are `html`, `pdf`, `png`, and `jpeg`; `all` expands to every supported type. Invalid types are warned about and ignored, and an error is raised if none remain.
- Relative output directories and resource paths have explicit file-relative behavior controlled by `outputDirectoryRelativePathFile` and `stylesRelativePathFile`. Preserve this behavior when changing path handling, and use `path`/`pathToFileURL` helpers rather than manual platform-specific concatenation.
- Markdown front matter can override selected rendering behavior such as `breaks`, `emoji`, `plantumlOpenMarker`, and `plantumlCloseMarker`; configuration remains the fallback.
- Non-HTML outputs must use browser-readable `file://` URLs for local images and styles. HTML output preserves web-oriented image references differently, so changes to `convertImgPath` or style resolution should account for the requested output type.
- HTML is assembled through Mustache with triple-braced `style`, `mermaid`, and `content` values. The template and bundled CSS files are part of the rendering contract.
- Browser selection supports `chrome`, `chromium`, and `chrome-headless-shell`, plus modern Puppeteer (default) and the legacy `puppeteer-core@2.1.1` compatibility path. Executable paths and cache locations may come from configuration or `MARKDOWN_PDF_PUPPETEER_EXECUTABLE_PATH`, `MARKDOWN_PDF_EXECUTABLE_PATH`, and `MARKDOWN_PDF_BROWSER_CACHE`.
- Browser downloads are cached under `~/.cache/markdown-pdf-m-cli` by default and are keyed by Puppeteer variant, browser, requested build, and cache directory. Avoid bypassing this cache when changing installation logic.
- Proxy configuration is read from `http.proxy` and applied to `HTTP_PROXY`/`HTTPS_PROXY` before browser resolution or download.

## Implementation conventions

- Keep the CLI dependency-free beyond the packages already declared in `package.json`; use the existing helpers in `index.js` for config merging, type normalization, dimensions, path conversion, and browser resolution instead of duplicating logic.
- Preserve the top-level async error boundary: failures are logged with the `[markdown-pdf-m-cli]` prefix and set `process.exitCode = 1`.
- `safeRequire` only suppresses `MODULE_NOT_FOUND`; other loading errors must propagate.
- Keep output generation deterministic with the configured output basename and extension. Temporary HTML files for browser exports are removed unless `markdownPdf.debug` is enabled.
- The codebase uses 2-space indentation, semicolons, single-quoted JavaScript strings, and CommonJS `require`/`module` conventions. Avoid introducing ESM or a formatter/transpiler without updating the project structure and scripts.