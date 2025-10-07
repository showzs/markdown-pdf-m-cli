#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { pathToFileURL } = require('url');

const cheerio = require('cheerio');
const grayMatter = require('gray-matter');
const highlightJs = require('highlight.js');
const markdownIt = require('markdown-it');
const mkdirp = require('mkdirp');
const mustache = require('mustache');
const rimraf = require('rimraf');

const puppeteer = require('puppeteer-core');

const DEFAULT_CONFIG_FILE = path.join(__dirname, 'config', 'defaults.json');
const USER_CONFIG_CANDIDATE = 'markdown-pdf.config.json';
const SUPPORTED_TYPES = ['html', 'pdf', 'png', 'jpeg'];

let INSTALL_CHECK = false;

(async () => {
  await main().catch((error) => {
    console.error('[markdown-pdf-m-cli] ' + (error && error.message ? error.message : error));
    if (error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  });
})();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    const pkg = safeRequire(path.join(__dirname, 'package.json'), {});
    console.log(pkg.version || '0.0.0');
    return;
  }
  if (!args.input) {
    printHelp();
    throw new Error('Input markdown file is required.');
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const config = loadConfig(args.config);
  const types = resolveTypes(args.types, config?.markdownPdf?.type);

  setProxy(config);

  const markdown = fs.readFileSync(inputPath, 'utf-8');

  for (const type of types) {
    console.log(`[markdown-pdf-m-cli] Converting ${path.basename(inputPath)} => ${type}`);
    const content = convertMarkdownToHtml(inputPath, type, markdown, config);
    const html = makeHtml(content, inputPath, config);
    await exportDocument(html, inputPath, type, args.output, config);
  }
}

function parseArgs(argv) {
  const result = { types: [] };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--version' || token === '-v') {
      result.version = true;
      continue;
    }
    if (token === '--config') {
      result.config = readNextValue(argv, ++i, '--config');
      continue;
    }
    if (token.startsWith('--config=')) {
      result.config = token.slice('--config='.length);
      continue;
    }
    if (token === '--type' || token === '-t') {
      const value = readNextValue(argv, ++i, '--type');
      result.types.push(...splitList(value));
      continue;
    }
    if (token.startsWith('--type=')) {
      result.types.push(...splitList(token.slice('--type='.length)));
      continue;
    }
    if (token === '--output' || token === '-o') {
      result.output = readNextValue(argv, ++i, '--output');
      continue;
    }
    if (token.startsWith('--output=')) {
      result.output = token.slice('--output='.length);
      continue;
    }
    if (token === '--input' || token === '-i') {
      result.input = readNextValue(argv, ++i, '--input');
      continue;
    }
    if (token.startsWith('--input=')) {
      result.input = token.slice('--input='.length);
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    }
    positional.push(token);
  }

  if (!result.input && positional.length > 0) {
    result.input = positional.shift();
  }
  if (positional.length > 0) {
    result.extra = positional;
  }

  return result;
}

function readNextValue(argv, index, flag) {
  if (index >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return argv[index];
}

function splitList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

function printHelp() {
  console.log(`Usage: markdown-pdf-m-cli <input-file> [options]

Options
  -i, --input <file>       Markdown file to convert (can also be provided as the first positional argument)
  -t, --type <types>       Output types separated by comma [html,pdf,png,jpeg,all]
  -o, --output <dir>       Output directory override
      --config <file>      Path to configuration JSON file (default: ./markdown-pdf.config.json)
  -h, --help               Show this help text
  -v, --version            Show version
`);
}

function loadConfig(customPath) {
  const defaults = safeRequire(DEFAULT_CONFIG_FILE, {});
  const result = JSON.parse(JSON.stringify(defaults));

  const candidatePaths = [];
  if (customPath) {
    candidatePaths.push(path.resolve(process.cwd(), customPath));
  }
  candidatePaths.push(path.resolve(process.cwd(), USER_CONFIG_CANDIDATE));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      const data = safeRequire(candidate, {});
      deepMerge(result, data || {});
      break;
    }
  }

  return result;
}

function resolveTypes(typesFromArgs, configType) {
  let resolved = [];
  if (Array.isArray(typesFromArgs) && typesFromArgs.length > 0) {
    resolved = typesFromArgs;
  } else if (typeof typesFromArgs === 'string' && typesFromArgs.trim().length > 0) {
    resolved = typesFromArgs.split(',');
  } else if (Array.isArray(configType) && configType.length > 0) {
    resolved = configType.slice();
  } else if (typeof configType === 'string' && configType.trim().length > 0) {
    resolved = [configType];
  }

  if (resolved.length === 0) {
    resolved = ['pdf'];
  }

  if (resolved.includes('all')) {
    resolved = SUPPORTED_TYPES.slice();
  }

  const normalized = [];
  for (const raw of resolved) {
    const value = String(raw).toLowerCase();
    if (!SUPPORTED_TYPES.includes(value)) {
      console.warn(`[markdown-pdf-m-cli] Unsupported type ignored: ${value}`);
      continue;
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }

  if (normalized.length === 0) {
    throw new Error('No valid output types were provided.');
  }

  return normalized;
}

async function exportDocument(html, inputPath, type, outputDirOverride, config) {
  const targetPath = resolveOutputPath(inputPath, type, outputDirOverride, config);
  ensureDirSync(path.dirname(targetPath));

  if (type === 'html') {
    fs.writeFileSync(targetPath, html, 'utf-8');
    console.log(`[markdown-pdf-m-cli] Saved: ${targetPath}`);
    return;
  }

  const markdownPdfConfig = config?.markdownPdf || {};
  const executablePath = await ensureChromium(markdownPdfConfig, config);

  const tmpFile = path.join(path.dirname(targetPath), `${path.basename(targetPath, '.' + type)}_tmp.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');

  const launchOptions = {
    executablePath,
    args: [`--lang=${detectLanguage(config)}`, '--no-sandbox', '--disable-setuid-sandbox']
  };

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setDefaultTimeout(0);
  await page.goto(pathToFileURL(tmpFile).toString(), { waitUntil: 'networkidle0' });

  if (type === 'pdf') {
    const options = buildPdfOptions(targetPath, markdownPdfConfig);
    await page.pdf(options);
  } else {
    const options = buildScreenshotOptions(targetPath, type, markdownPdfConfig);
    await page.screenshot(options);
  }

  await browser.close();

  if (!markdownPdfConfig.debug && fs.existsSync(tmpFile)) {
    rimraf.sync(tmpFile);
  }

  console.log(`[markdown-pdf-m-cli] Saved: ${targetPath}`);
}

function detectLanguage(config) {
  return config?.language || process.env.LANG || process.env.LANGUAGE || 'en-US';
}

async function ensureChromium(markdownPdfConfig, config) {
  if (INSTALL_CHECK) {
    return markdownPdfConfig?.executablePath || puppeteer.executablePath();
  }

  if (markdownPdfConfig?.executablePath && fs.existsSync(markdownPdfConfig.executablePath)) {
    INSTALL_CHECK = true;
    return markdownPdfConfig.executablePath;
  }

  const bundled = puppeteer.executablePath();
  if (bundled && fs.existsSync(bundled)) {
    INSTALL_CHECK = true;
    return bundled;
  }

  return installChromium(config);
}

async function installChromium(config) {
  console.log('[markdown-pdf-m-cli] Installing Chromium ...');
  setProxy(config);

  const browserFetcher = puppeteer.createBrowserFetcher();
  const pkg = safeRequire(path.join(__dirname, 'node_modules', 'puppeteer-core', 'package.json'), {});
  const revision = pkg?.puppeteer?.chromium_revision;
  if (!revision) {
    throw new Error('Unable to determine Chromium revision for puppeteer-core.');
  }

  const revisionInfo = browserFetcher.revisionInfo(revision);
  await browserFetcher.download(revisionInfo.revision, (downloadedBytes, totalBytes) => {
    if (!totalBytes) {
      return;
    }
    const progress = Math.floor((downloadedBytes / totalBytes) * 100);
    process.stdout.write(`\r[markdown-pdf-m-cli] Downloading Chromium... ${progress}%`);
  });
  process.stdout.write('\n');

  INSTALL_CHECK = true;
  console.log(`[markdown-pdf-m-cli] Chromium downloaded to ${revisionInfo.folderPath}`);
  return revisionInfo.executablePath;
}

function convertMarkdownToHtml(filename, type, text, config) {
  const markdownPdfConfig = config?.markdownPdf || {};
  const matterParts = grayMatter(text);

  const md = markdownIt({
    html: true,
    breaks: setBooleanValue(matterParts.data.breaks, markdownPdfConfig.breaks),
    highlight(str, lang) {
      if (lang && lang.match(/\bmermaid\b/i)) {
        return `<div class="mermaid">${str}</div>`;
      }
      if (lang && highlightJs.getLanguage(lang)) {
        try {
          const { value } = highlightJs.highlight(str, { language: lang, ignoreIllegals: true });
          return `<pre class="hljs"><code><div>${value}</div></code></pre>`;
        } catch (error) {
          console.warn('highlight.js error:', error.message);
        }
      }
      const escaped = md.utils.escapeHtml(str);
      return `<pre class="hljs"><code><div>${escaped}</div></code></pre>`;
    }
  });

  const defaultRender = md.renderer.rules.image || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const srcIndex = token.attrIndex('src');
    if (srcIndex >= 0) {
      const original = token.attrs[srcIndex][1];
      const href = type === 'html'
        ? decodeURIComponent(original).replace(/("|')/g, '')
        : convertImgPath(original, filename);
      token.attrs[srcIndex][1] = href;
    }
    return defaultRender(tokens, idx, options, env, self);
  };

  if (type !== 'html') {
    const defaultHtmlBlock = md.renderer.rules.html_block || function (tokens, idx) {
      return tokens[idx].content;
    };
    md.renderer.rules.html_block = function (tokens, idx, options, env, self) {
      const htmlBlock = tokens[idx].content;
      const $ = cheerio.load(htmlBlock);
      let changed = false;
      $('img').each(function () {
        const src = $(this).attr('src');
        if (src) {
          $(this).attr('src', convertImgPath(src, filename));
          changed = true;
        }
      });
      if (changed) {
        return $('body').html();
      }
      return defaultHtmlBlock(tokens, idx, options, env, self);
    };
  }

  md.use(require('markdown-it-checkbox'));

  const emojiEnabled = setBooleanValue(matterParts.data.emoji, markdownPdfConfig.emoji);
  if (emojiEnabled) {
    var emojies_defs = require(path.join(__dirname, 'data', 'emoji.json'));
    try {
      var options = {
        defs: emojies_defs
      };
    } catch (error) {
      console.warn('markdown-it-emoji:options', error.message);
    }
    md.use(require('markdown-it-emoji'), options);
    md.renderer.rules.emoji = function (token, idx) {
      var emoji = token[idx].markup;
      var emojipath = path.join(__dirname, 'node_modules', 'emoji-images', 'pngs', emoji + '.png');
      var emojidata = readFile(emojipath, null).toString('base64');
      if (emojidata) {
        return '<img class="emoji" alt="' + emoji + '" src="data:image/png;base64,' + emojidata + '" />';
      } else {
        return ':' + emoji + ':';
      }
    };
  }

  applyHeadingIds(md, Slug);
  md.use(require('markdown-it-container'), '', {
    validate(name) {
      return name.trim().length > 0;
    },
    render(tokens, idx) {
      if (tokens[idx].info.trim() !== '') {
        return `<div class="${tokens[idx].info.trim()}">\n`;
      }
      return '</div>\n';
    }
  });

  const plantumlOptions = {
    openMarker: matterParts.data.plantumlOpenMarker || markdownPdfConfig.plantumlOpenMarker || '@startuml',
    closeMarker: matterParts.data.plantumlCloseMarker || markdownPdfConfig.plantumlCloseMarker || '@enduml',
    server: markdownPdfConfig.plantumlServer || ''
  };
  md.use(require('markdown-it-plantuml'), plantumlOptions);

  const includeConfig = markdownPdfConfig['markdown-it-include'];
  if (includeConfig && includeConfig.enable) {
    md.use(require('markdown-it-include'), {
      root: path.dirname(filename),
      includeRe: /:\[.+\]\((.+\..+)\)/i
    });
  }

  return md.render(matterParts.content);
}

function makeHtml(data, inputPath, config) {
  const markdownPdfConfig = config?.markdownPdf || {};
  const templatePath = path.join(__dirname, 'template', 'template.html');
  const template = readFileIfExists(templatePath, 'utf-8');
  if (!template) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const view = {
    title: path.basename(inputPath),
    style: readStyles(inputPath, config),
    content: data,
    mermaid: markdownPdfConfig.mermaidServer ? `<script src="${markdownPdfConfig.mermaidServer}"></script>` : ''
  };

  return mustache.render(template, view);
}

function readStyles(resourcePath, config) {
  const markdownPdfConfig = config?.markdownPdf || {};
  const markdownConfig = config?.markdown || {};

  let style = '';

  if (markdownPdfConfig.includeDefaultStyles !== false) {
    style += makeCss(path.join(__dirname, 'styles', 'markdown.css'));
  }

  if (markdownPdfConfig.includeDefaultStyles !== false) {
    const markdownStyles = Array.isArray(markdownConfig.styles) ? markdownConfig.styles : [];
    style += buildStyleLinks(markdownStyles, resourcePath, config);
  }

  if (markdownPdfConfig.highlight !== false) {
    const highlightStyle = markdownPdfConfig.highlightStyle;
    if (highlightStyle) {
      const highlightPath = resolveHighlightStyle(highlightStyle);
      style += makeCss(highlightPath);
    } else {
      style += makeCss(path.join(__dirname, 'styles', 'tomorrow.css'));
    }
  }

  if (markdownPdfConfig.includeDefaultStyles !== false) {
    style += makeCss(path.join(__dirname, 'styles', 'markdown-pdf.css'));
  }

  const customStyles = Array.isArray(markdownPdfConfig.styles) ? markdownPdfConfig.styles : [];
  style += buildStyleLinks(customStyles, resourcePath, config);

  return style;
}

function resolveHighlightStyle(styleName) {
  if (fs.existsSync(styleName)) {
    return styleName;
  }
  const candidate = path.join(__dirname, 'node_modules', 'highlight.js', 'styles', styleName);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const withCss = styleName.endsWith('.css') ? styleName : `${styleName}.css`;
  const candidateWithCss = path.join(__dirname, 'node_modules', 'highlight.js', 'styles', withCss);
  if (fs.existsSync(candidateWithCss)) {
    return candidateWithCss;
  }
  throw new Error(`Unable to resolve highlight style: ${styleName}`);
}

function buildStyleLinks(styles, resourcePath, config) {
  if (!styles || styles.length === 0) {
    return '';
  }
  return styles
    .map((href) => fixHref(resourcePath, href, config))
    .filter(Boolean)
    .map((href) => `<link rel="stylesheet" href="${href}" type="text/css">`)
    .join('');
}

function applyHeadingIds(md, slugify) {
  const seen = Object.create(null);
  const defaultRender = md.renderer.rules.heading_open || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    if (token && !token.attrGet('id')) {
      const inlineToken = tokens[idx + 1];
      let text = '';
      if (inlineToken && inlineToken.type === 'inline') {
        text = inlineToken.content || '';
        if (!text && Array.isArray(inlineToken.children)) {
          text = inlineToken.children.map((child) => child.content || '').join('');
        }
      }

      text = text.trim();
      if (text) {
        let slug = slugify(text);
        if (slug) {
          const baseSlug = slug;
          if (Object.prototype.hasOwnProperty.call(seen, baseSlug)) {
            seen[baseSlug] += 1;
            slug = `${baseSlug}-${seen[baseSlug]}`;
          } else {
            seen[baseSlug] = 0;
          }
          token.attrSet('id', slug);
        }
      }
    }
    return defaultRender(tokens, idx, options, env, self);
  };
}

function makeCss(filename) {
  const css = readFileIfExists(filename, 'utf-8');
  if (!css) {
    return '';
  }
  return `\n<style>\n${css}\n</style>\n`;
}

function readFileIfExists(filename, encoding) {
  if (!filename) {
    return '';
  }
  let actual = filename;
  if (filename.startsWith('file://')) {
    actual = url.fileURLToPath(filename);
  }
  if (!fs.existsSync(actual)) {
    return '';
  }
  return fs.readFileSync(actual, encoding || 'utf-8');
}

function convertImgPath(src, filename) {
  let href = decodeURIComponent(src);
  href = href.replace(/("|')/g, '').replace(/\\/g, '/').replace(/#/g, '%23');

  const parsed = url.parse(href);
  if (parsed.protocol === 'file:' && href.indexOf('file:///') !== 0) {
    return href.replace(/^file:\/\//, 'file:///');
  }
  if (parsed.protocol === 'file:') {
    return href;
  }
  if (!parsed.protocol || path.isAbsolute(href)) {
    const resolved = path.resolve(path.dirname(filename), href).replace(/\\/g, '/').replace(/#/g, '%23');
    if (resolved.startsWith('//')) {
      return `file:${resolved}`;
    }
    if (resolved.startsWith('/')) {
      return `file://${resolved}`;
    }
    return `file:///${resolved}`;
  }
  return src;
}

function fixHref(resourcePath, href, config) {
  if (!href) {
    return href;
  }

  try {
    const parsed = new URL(href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (_) {
    // not an absolute URL
  }

  if (href.indexOf('~') === 0) {
    return pathToFileURL(path.join(os.homedir(), href.slice(1))).toString();
  }

  if (path.isAbsolute(href)) {
    return pathToFileURL(href).toString();
  }

  const markdownPdfConfig = config?.markdownPdf || {};
  const stylesRelativePathFile = markdownPdfConfig.stylesRelativePathFile !== false;

  const baseDir = stylesRelativePathFile
    ? path.dirname(resourcePath)
    : process.cwd();

  return pathToFileURL(path.resolve(baseDir, href)).toString();
}

function resolveOutputPath(inputPath, type, outputDirOverride, config) {
  const markdownPdfConfig = config?.markdownPdf || {};
  let outputDir = outputDirOverride || markdownPdfConfig.outputDirectory || '';

  if (!outputDir) {
    outputDir = path.dirname(inputPath);
  } else if (outputDir.startsWith('~')) {
    outputDir = path.join(os.homedir(), outputDir.slice(1));
  } else if (!path.isAbsolute(outputDir)) {
    const useFileDir = markdownPdfConfig.outputDirectoryRelativePathFile !== false;
    outputDir = path.resolve(useFileDir ? path.dirname(inputPath) : process.cwd(), outputDir);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(outputDir, `${baseName}.${type}`);
}

function buildPdfOptions(targetPath, cfg) {
  const margin = cfg?.margin || {};
  const hasCustomWidth = cfg?.width && cfg.width !== '';
  const hasCustomHeight = cfg?.height && cfg.height !== '';

  return {
    path: targetPath,
    scale: toNumber(cfg?.scale, 1),
    displayHeaderFooter: Boolean(cfg?.displayHeaderFooter),
    headerTemplate: cfg?.headerTemplate || '',
    footerTemplate: cfg?.footerTemplate || '',
    printBackground: cfg?.printBackground !== false,
    landscape: (cfg?.orientation || '').toLowerCase() === 'landscape',
    pageRanges: cfg?.pageRanges || '',
    format: !hasCustomWidth && !hasCustomHeight ? cfg?.format || 'A4' : undefined,
    width: hasCustomWidth ? cfg.width : undefined,
    height: hasCustomHeight ? cfg.height : undefined,
    margin: {
      top: normalizeDimension(margin.top),
      right: normalizeDimension(margin.right),
      bottom: normalizeDimension(margin.bottom),
      left: normalizeDimension(margin.left)
    },
    timeout: 0
  };
}

function normalizeDimension(value) {
  return value && String(value).trim().length > 0 ? value : undefined;
}

function buildScreenshotOptions(targetPath, type, cfg) {
  const clip = cfg?.clip || {};
  const clipValues = ['x', 'y', 'width', 'height'].map((key) => clip[key]);
  const hasClip = clipValues.every((value) => value !== null && value !== undefined);

  const options = {
    path: targetPath,
    quality: type === 'jpeg' ? toNumber(cfg?.quality, 100) : undefined,
    fullPage: !hasClip,
    omitBackground: Boolean(cfg?.omitBackground)
  };

  if (hasClip) {
    options.clip = {
      x: Number(clip.x),
      y: Number(clip.y),
      width: Number(clip.width),
      height: Number(clip.height)
    };
  }

  return options;
}

function ensureDirSync(dir) {
  if (!dir) {
    return;
  }
  mkdirp.sync(dir);
}

function setProxy(config) {
  const proxy = config?.http?.proxy;
  if (proxy) {
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
  }
}

function safeRequire(modulePath, fallback) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return fallback;
    }
    throw error;
  }
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return target;
  }

  for (const key of Object.keys(source)) {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      target[key] = sourceValue.slice();
    } else if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      target[key] = deepMerge({ ...targetValue }, sourceValue);
    } else {
      target[key] = sourceValue;
    }
  }

  return target;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function setBooleanValue(a, b) {
  if (a === false) {
    return false;
  }
  return a || b;
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function Slug(string) {
  return encodeURI(
    String(string)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[\]\[!\'#\$%&()\*+,./:;<=?>@\\^_{|}~`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
}
