const fs = require('node:fs');
const path = require('node:path');
let ts;
try {
  ts = require('typescript');
} catch {
  // CI/project normally has TypeScript from devDependencies. This fallback lets
  // the repository audit run in the maintenance container as well.
  ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
}

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');
const publicRoot = path.join(root, 'public');
const stylesRoot = path.join(srcRoot, 'app', 'styles');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const STATE_PREFIXES = ['is-', 'has-', 'status-', 'tone-', 'role-', 'diff-'];
const CLASS_METHODS = new Set(['add', 'remove', 'toggle', 'contains', 'replace']);
const SELECTOR_METHODS = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function validateCssBraces(text, file) {
  const stack = [];
  let quote = null;
  let escaped = false;
  let inComment = false;
  let line = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '\n') line += 1;

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      stack.push(line);
      continue;
    }
    if (char === '}') {
      if (!stack.length) return `unexpected } at line ${line}`;
      stack.pop();
    }
  }

  if (quote) return `unterminated string at end of file`;
  if (inComment) return `unterminated comment at end of file`;
  if (stack.length) return `unclosed { opened at line ${stack.at(-1)}`;
  return null;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addClassTokens(text, exact, prefixes) {
  for (const raw of String(text || '').split(/\s+/)) {
    const token = raw.trim();
    if (!token) continue;
    const cleaned = token.replace(/^[.!#]+/, '').replace(/[^A-Za-z0-9_-]+$/g, '');
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(cleaned)) continue;
    if (cleaned.endsWith('-')) prefixes.add(cleaned);
    else exact.add(cleaned);
  }
}

function addSelectorClasses(text, exact) {
  for (const match of String(text || '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) exact.add(match[1]);
}

function collectStrings(node, exact, prefixes) {
  if (!node) return;
  if (ts.isStringLiteralLike(node)) {
    addClassTokens(node.text, exact, prefixes);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    addClassTokens(node.head.text, exact, prefixes);
    for (const span of node.templateSpans) addClassTokens(span.literal.text, exact, prefixes);
  }
  ts.forEachChild(node, (child) => collectStrings(child, exact, prefixes));
}

function collectClassUsage(file, exact, prefixes) {
  const source = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file);
  const kind = ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ext === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);

  function visit(node) {
    // Components in this project intentionally pass class names through props
    // such as errorClassName/iconClassName, so they are runtime CSS consumers too.
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sf);
      if (/className$/i.test(attrName) && node.initializer) collectStrings(node.initializer, exact, prefixes);
    }

    if (ts.isPropertyAssignment(node)) {
      const propName = node.name.getText(sf).replace(/["']/g, '');
      if (/className$/i.test(propName)) collectStrings(node.initializer, exact, prefixes);
    }

    if ((ts.isBindingElement(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer) {
      const bindingName = node.name?.getText(sf) || '';
      if (/className$/i.test(bindingName)) collectStrings(node.initializer, exact, prefixes);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const ownerText = node.expression.expression.getText(sf);
      if (ownerText.endsWith('.classList') && CLASS_METHODS.has(method)) {
        for (const arg of node.arguments) collectStrings(arg, exact, prefixes);
      } else if (SELECTOR_METHODS.has(method)) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteralLike(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) addSelectorClasses(arg.text, exact);
        }
      } else if (method === 'getElementsByClassName') {
        for (const arg of node.arguments) collectStrings(arg, exact, prefixes);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const sourceFiles = [
  ...walk(srcRoot),
  ...(fs.existsSync(publicRoot) ? walk(publicRoot) : []),
].filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
const sourceText = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const usedClasses = new Set();
const dynamicPrefixes = new Set();
for (const file of sourceFiles) collectClassUsage(file, usedClasses, dynamicPrefixes);

const cssFiles = walk(stylesRoot).filter((file) => file.endsWith('.css'));
const invalidCssFiles = cssFiles
  .map((file) => ({ file, error: validateCssBraces(fs.readFileSync(file, 'utf8'), file) }))
  .filter(({ error }) => error);
const unreferencedCssFiles = cssFiles.filter((file) => !sourceText.includes(path.basename(file)));
const cssText = cssFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const cssWithoutComments = stripCssComments(cssText);
const selectorClasses = new Map();
const selectorIds = new Map();
const keyframes = new Map();

for (const file of cssFiles) {
  const css = stripCssComments(fs.readFileSync(file, 'utf8'));
  for (const match of css.matchAll(/(?<![\\\w-])\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    const className = match[1];
    const current = selectorClasses.get(className) || new Set();
    current.add(path.relative(root, file));
    selectorClasses.set(className, current);
  }

  // Restrict ID matching to selector-like chunks immediately before an opening
  // brace so color values in declarations (for example #fff) are not treated as IDs.
  for (const selectorMatch of css.matchAll(/([^{}]+)\{/g)) {
    for (const idMatch of selectorMatch[1].matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      const idName = idMatch[1];
      const current = selectorIds.get(idName) || new Set();
      current.add(path.relative(root, file));
      selectorIds.set(idName, current);
    }
  }

  for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    const current = keyframes.get(match[1]) || new Set();
    current.add(path.relative(root, file));
    keyframes.set(match[1], current);
  }
}

function isProtectedClass(className) {
  if (usedClasses.has(className)) return true;
  for (const prefix of dynamicPrefixes) if (className.startsWith(prefix)) return true;
  if (className.includes('--') && usedClasses.has(className.split('--', 1)[0])) return true;
  return STATE_PREFIXES.some((prefix) => className.startsWith(prefix));
}

const unusedClasses = [...selectorClasses.keys()].filter((className) => !isProtectedClass(className)).sort();
const unusedIds = [...selectorIds.keys()].filter((idName) => !sourceText.includes(idName)).sort();

const definedVars = new Set(
  [...cssWithoutComments.matchAll(/(?<![-A-Za-z0-9_])--([A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]),
);
const consumedVars = new Set(
  [...cssWithoutComments.matchAll(/var\(--([A-Za-z0-9_-]+)/g)].map((match) => match[1]),
);
const unusedVars = [...definedVars]
  .filter((name) => !consumedVars.has(name) && !sourceText.includes(`--${name}`))
  .sort();

const animationCorpus = `${cssWithoutComments}\n${sourceText}`;
const unusedKeyframes = [...keyframes.keys()].filter((name) => {
  const withoutDefinitions = animationCorpus.replace(
    new RegExp(`@(?:-webkit-)?keyframes\\s+${escapeRegExp(name)}\\b`, 'g'),
    '@keyframes',
  );
  return !new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(name)}(?=$|[^A-Za-z0-9_-])`).test(withoutDefinitions);
}).sort();

console.log(`STYLE AUDIT: ${selectorClasses.size} class selectors across ${cssFiles.length} CSS files.`);
console.log(`STYLE AUDIT: ${usedClasses.size} explicit runtime class names + ${dynamicPrefixes.size} dynamic prefixes.`);
console.log(`STYLE AUDIT: ${selectorIds.size} ID selectors, ${definedVars.size} custom properties, ${keyframes.size} keyframe animation(s).`);

if (invalidCssFiles.length) {
  console.error(`STYLE AUDIT: ${invalidCssFiles.length} structurally invalid CSS file(s):`);
  for (const { file, error } of invalidCssFiles) console.error(` - ${path.relative(root, file)}: ${error}`);
}

if (unreferencedCssFiles.length) {
  console.error(`STYLE AUDIT: ${unreferencedCssFiles.length} CSS file(s) are not imported/referenced by runtime source:`);
  for (const file of unreferencedCssFiles) console.error(` - ${path.relative(root, file)}`);
}

if (unusedClasses.length) {
  console.error(`STYLE AUDIT: ${unusedClasses.length} unused class selector candidate(s):`);
  for (const className of unusedClasses) {
    console.error(` - .${className} (${[...selectorClasses.get(className)].join(', ')})`);
  }
}

if (unusedIds.length) {
  console.error(`STYLE AUDIT: ${unusedIds.length} unused ID selector candidate(s):`);
  for (const idName of unusedIds) {
    console.error(` - #${idName} (${[...selectorIds.get(idName)].join(', ')})`);
  }
}

if (unusedVars.length) {
  console.error(`STYLE AUDIT: ${unusedVars.length} unused custom propert${unusedVars.length === 1 ? 'y' : 'ies'}:`);
  for (const name of unusedVars) console.error(` - --${name}`);
}

if (unusedKeyframes.length) {
  console.error(`STYLE AUDIT: ${unusedKeyframes.length} unused keyframe animation(s):`);
  for (const name of unusedKeyframes) {
    console.error(` - @keyframes ${name} (${[...keyframes.get(name)].join(', ')})`);
  }
}

if (invalidCssFiles.length || unreferencedCssFiles.length || unusedClasses.length || unusedIds.length || unusedVars.length || unusedKeyframes.length) process.exit(1);
console.log('STYLE AUDIT: CSS structure is valid; no conservatively confirmed unused class/ID selectors, custom properties, or keyframes.');
