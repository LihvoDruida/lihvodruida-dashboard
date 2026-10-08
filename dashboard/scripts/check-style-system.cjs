const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const styles = path.join(root, 'src/app/styles');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const order = ['theme', 'reset', 'defaults', 'components', 'layout', 'pages', 'accessibility'];
assert.deepEqual(postcss.parse(read('src/app/styles/cascade.css')).nodes.find(n => n.type === 'atrule').params.split(/,\s*/), order);

let ruleCount = 0;
for (const file of walk(path.join(root, 'src')).filter(file => file.endsWith('.css'))) {
  const css = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  css.walkRules(rule => {
    ruleCount++;
    assert.ok(!/:where\([^\n]*::[\w-]+\)/.test(rule.selector), `Pseudo-element must follow :where(), not appear inside it: ${rule.selector}`);
    let layer;
    let hasHoverGate = false;
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'layer') layer = parent.params;
      if (parent.type === 'atrule' && parent.name === 'media' && /hover:\s*hover/.test(parent.params)) hasHoverGate = true;
    }
    assert.ok(order.includes(layer), `${path.relative(root, file)}: unowned CSS rule ${rule.selector}`);
    if (layer === 'defaults') {
      assert.equal(path.basename(file), 'patterns.css', `Compatibility defaults must have one owner: ${file}`);
    }
    if (['html', 'body', 'html, body'].includes(rule.selector)) {
      rule.walkDecls('overflow-x', declaration => {
        assert.ok(!/hidden|clip/.test(declaration.value), 'Root overflow must be fixed, not concealed');
      });
    }
    if (rule.selector.includes(':hover')) assert.ok(hasHoverGate, `Ungated touch hover: ${rule.selector}`);
    if (/^:where\(\[class(?:\*|\$)=/.test(rule.selector)) {
      assert.equal(layer, 'defaults', `Heuristic selector must stay in defaults: ${rule.selector}`);
    }
    if (file.endsWith('.module.css') && /\.btn\b/.test(rule.selector)) {
      assert.ok(rule.selector.includes(':global(.btn)'), `Shared button accidentally scoped in ${file}: ${rule.selector}`);
    }
  });
}
const desktop = postcss.parse(read('src/app/styles/desktop.css'));
desktop.walkRules(rule => {
  assert.equal(rule.selector, ':root', 'Desktop must change tokens, not override page components');
  rule.walkDecls(declaration => assert.ok(declaration.prop.startsWith('--'), 'Desktop geometry must use shared custom properties'));
});
const layout = read('src/app/layout.tsx');
assert.ok(layout.indexOf('styles/cascade.css') < layout.indexOf('styles/tokens.css'));
assert.ok(read('src/app/styles/tokens.css').includes('env(safe-area-inset-top, 0px)'));
assert.ok(read('src/app/styles/accessibility.css').includes('font-size: max(1rem, var(--control-font-size))'));
assert.ok(read('src/app/styles/responsive.css').includes('@media (pointer: coarse)'));
console.log(`[check-style-system] OK — ${ruleCount} CSS rules: layer ownership, shared controls, hover and desktop isolation.`);
