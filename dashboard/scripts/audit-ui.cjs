const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const tsxFiles = walk(srcRoot).filter((file) => file.endsWith('.tsx'));
const pageFiles = tsxFiles.filter((file) => /[\\/]app[\\/].*[\\/]page\.tsx$/.test(file));
const errors = [];
let appPages = 0;
let pageStacks = 0;
let buttons = 0;
let standardizedButtons = 0;
let semanticButtons = 0;
let actionLinks = 0;
let standardizedActionLinks = 0;
let semanticActionLinks = 0;

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

for (const file of pageFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const mainMatches = [...source.matchAll(/<main\b[^>]*className="([^"]+)"/gs)];
  let hasAppMain = false;
  for (const match of mainMatches) {
    const classes = match[1].split(/\s+/);
    if (!classes.includes('container')) continue;
    appPages += 1;
    if (!classes.includes('app-page')) {
      errors.push(`${relative(file)}: container page is missing app-page`);
    } else {
      hasAppMain = true;
    }
  }

  if (hasAppMain) {
    for (const match of source.matchAll(/<(?:section|div)\b[^>]*className="([^"]*(?:dashboard-shell|content-shell)[^"]*)"/gs)) {
      const classes = match[1].split(/\s+/);
      if (!classes.includes('dashboard-shell') && !classes.includes('content-shell')) continue;
      pageStacks += 1;
      if (!classes.includes('app-page-stack')) {
        errors.push(`${relative(file)}: dashboard/content shell is missing app-page-stack`);
      }
      break;
    }
  }
}

const semanticControlTokens = [
  'global-toast__close',
  'raid-image-picker__item',
  'nav-burger',
  'poll-tab',
  'raid-poll-day-toggle',
  'author-suggestion-chip',
  'profile-display-mode-option',
  'dashboard-nav-more__trigger',
  'dashboard-nav-measure__more',
  'dashboard-user__button',
  'raid-action',
  'discord-preview-mode-button',
];

const semanticActionLinkTokens = [
  'login-discord-button',
  'profile-bnet-cta',
];


for (const file of tsxFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<button\b([^>]*)>/gs)) {
    buttons += 1;
    const attrs = match[1];
    const staticClass = attrs.match(/className="([^"]*)"/s)?.[1] || '';
    const templateClass = attrs.match(/className=\{`([^`]*)`\}/s)?.[1] || '';
    const expressionClass = attrs.match(/className=\{([^}]*)\}/s)?.[1] || '';
    const classSource = `${staticClass} ${templateClass}`.trim();

    if (/(?:^|\s)btn(?:\s|$)/.test(classSource)) {
      standardizedButtons += 1;
      continue;
    }
    if (semanticControlTokens.some((token) => classSource.includes(token))) {
      semanticButtons += 1;
      continue;
    }
    // LogoutButton intentionally receives its concrete button class from props.
    if (/\bbuttonClassName\b/.test(expressionClass)) {
      semanticButtons += 1;
      continue;
    }

    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${relative(file)}:${line}: button has no shared .btn or approved semantic control class`);
  }
}

for (const file of tsxFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<a\b([^>]*)>/gs)) {
    const attrs = match[1];
    const staticClass = attrs.match(/className="([^"]*)"/s)?.[1] || '';
    const templateClass = attrs.match(/className=\{`([^`]*)`\}/s)?.[1] || '';
    const classSource = `${staticClass} ${templateClass}`.trim();
    const looksLikeAction = /(?:^|\s)btn(?:\s|$)/.test(classSource) || /(?:button|action|cta)/i.test(classSource);
    if (!looksLikeAction) continue;

    actionLinks += 1;
    if (/(?:^|\s)btn(?:\s|$)/.test(classSource)) {
      standardizedActionLinks += 1;
      continue;
    }
    if (semanticActionLinkTokens.some((token) => classSource.includes(token))) {
      semanticActionLinks += 1;
      continue;
    }

    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${relative(file)}:${line}: action-like anchor has no shared .btn or approved rich CTA class`);
  }
}

console.log(`UI AUDIT: ${appPages} container page(s), ${pageStacks} page stack(s), ${buttons} button(s).`);
console.log(`UI AUDIT: ${standardizedButtons} shared .btn button(s), ${semanticButtons} specialized semantic button(s).`);
console.log(`UI AUDIT: ${actionLinks} action-like anchor(s): ${standardizedActionLinks} shared .btn, ${semanticActionLinks} approved rich CTA.`);

if (errors.length) {
  console.error(`UI AUDIT: ${errors.length} issue(s):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('UI AUDIT: page structure and button classification are consistent.');
