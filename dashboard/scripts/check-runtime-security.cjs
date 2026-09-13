const fs = require('node:fs');
const path = require('node:path');

function tuple(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function atLeast(value, minimum) {
  const a = tuple(value);
  const b = tuple(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const requirements = [
  ['next', '16.3.3', process.env.MISTBLOSSOM_EXPECTED_NEXT_VERSION],
  ['react', '19.2.8', process.env.MISTBLOSSOM_EXPECTED_REACT_VERSION],
  ['react-dom', '19.2.8', process.env.MISTBLOSSOM_EXPECTED_REACT_VERSION],
  ['sharp', '0.35.4', process.env.MISTBLOSSOM_EXPECTED_SHARP_VERSION],
];

let failed = false;
for (const [name, minimum, expected] of requirements) {
  const packagePath = path.join(process.cwd(), 'node_modules', name, 'package.json');
  if (!fs.existsSync(packagePath)) {
    console.error(`[security:runtime] FAIL — ${name} is not installed.`);
    failed = true;
    continue;
  }
  const actual = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  if (!atLeast(actual, minimum)) {
    console.error(`[security:runtime] FAIL — ${name}@${actual} is below the approved security floor ${minimum}.`);
    failed = true;
    continue;
  }
  if (expected && actual !== expected) {
    console.error(`[security:runtime] FAIL — ${name}@${actual} does not equal the pinned overlay ${expected}.`);
    failed = true;
    continue;
  }
  console.log(`[security:runtime] OK — ${name}@${actual}`);
}

if (!atLeast(process.versions.node, '24.18.1')) {
  console.error(`[security:runtime] FAIL — Node ${process.versions.node} is below the approved security floor 24.18.1.`);
  failed = true;
} else {
  console.log(`[security:runtime] OK — node@${process.versions.node}`);
}

if (failed) {
  console.error('[security:runtime] Refusing to build/serve with a known-vulnerable runtime. Use the Docker security overlay or update the approved pins.');
  process.exit(1);
}
