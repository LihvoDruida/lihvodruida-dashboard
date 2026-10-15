const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const load = require('./lib/load-server-ts.cjs');
const root = path.resolve(__dirname, '..');
const runtime = process.env.MISTBLOSSOM_TEST_RUNTIME_ROOT;
const runtimeRequire = runtime ? createRequire(path.resolve(runtime, 'dashboard/server.js')) : require;
const sharpPath = runtimeRequire.resolve('sharp');
if (runtime) assert.ok(sharpPath.startsWith(path.resolve(runtime) + path.sep), 'Sharp must resolve inside the standalone package');
const sharp = runtimeRequire('sharp');
const background = 'discord-welcome-card-night-elf-base.png';
const fonts = ['SpectralSC-Bold.ttf', 'SpectralSC-ExtraBold.ttf', 'Philosopher-Bold.ttf'];
const member = { userId: '111111111111111111', username: 'Fixture', displayName: 'Дмитро · Ґільдія', joinedAt: '2026-10-15T00:00:00Z', avatarUrl: null, defaultAvatarUrl: null };
const settings = { greetings: ['Ласкаво просимо!'], labelPrefix: 'Мурлок', fileName: 'fixture.png' };
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('✓ ' + name); }
function subject(cwd) {
  const events = [], reads = [], accesses = [];
  const renderer = load('src/lib/discordWelcomeCard.ts', {
    'node:fs/promises': { __esModule: true, default: { ...fs, readFile: async file => { reads.push(file); return fs.readFile(file); }, access: async file => { accesses.push(file); return fs.access(file); } } },
    'node:path': { __esModule: true, default: path }, sharp: { __esModule: true, default: sharp },
    '@/lib/security': { logDashboardEvent: (...args) => events.push(args) },
  }, { process: { cwd: () => cwd, env: {} }, URL, AbortSignal, fetch: () => { throw Error('No Discord network allowed'); } }).exports;
  return { ...renderer, events, reads, accesses, render: () => renderer.renderDiscordWelcomeCard(member, settings, { numberOverride: '123' }) };
}
async function installAssets(directory, withFonts = true) {
  const input = runtime ? path.resolve(runtime, 'dashboard') : root;
  await fs.mkdir(path.join(directory, 'public/assets'), { recursive: true });
  await fs.copyFile(path.join(input, 'public/assets', background), path.join(directory, 'public/assets', background));
  if (withFonts) {
    await fs.mkdir(path.join(directory, 'assets/fonts/welcome'), { recursive: true });
    for (const file of fonts) await fs.copyFile(path.join(input, 'assets/fonts/welcome', file), path.join(directory, 'assets/fonts/welcome', file));
  }
}
async function validPng(result) {
  assert.equal(result.contentType, 'image/png'); assert.equal(result.fileName, 'fixture.png');
  assert.equal(result.greeting, 'Ласкаво просимо!'); assert.equal(result.label, 'Мурлок №123');
  const metadata = await sharp(result.buffer).metadata(); assert.equal(metadata.width, 1280); assert.equal(metadata.height, 720); assert.equal(metadata.format, 'png');
  const corner = await sharp(result.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer(); assert.equal(corner[3], 0);
}
let temp;
(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mistblossom-welcome-assets-'));
  const local = path.join(temp, 'local'), parent = path.join(temp, 'runtime');
  await installAssets(local); await installAssets(path.join(parent, 'dashboard'));
  let localResult;
  await check('local renderer uses real PNG, bundled Cyrillic fonts and rounded alpha corners', async () => {
    const card = subject(local); localResult = await card.render(); await validPng(localResult); assert.equal(card.events.length, 0); assert.equal(card.reads.length, 1); assert.equal(card.accesses.length, 3);
  });
  await check('parent runtime layout resolves the same assets and produces identical pixels', async () => {
    const card = subject(parent), result = await card.render(); await validPng(result); assert.deepEqual(result.buffer, localResult.buffer); assert.equal(card.events.length, 0);
  });
  await check('standalone server working directory resolves local paths without source checkout', async () => {
    const card = subject(path.join(parent, 'dashboard')), result = await card.render(); assert.deepEqual(result.buffer, localResult.buffer); assert.equal(card.events.length, 0);
  });
  await check('missing fonts produce a visible warning and a valid DejaVu fallback image', async () => {
    const directory = path.join(temp, 'missing-fonts'); await installAssets(directory, false); const card = subject(directory); await validPng(await card.render());
    assert.equal(card.events.length, 1); assert.equal(card.events[0][1], 'discord.welcome_card_fonts_missing'); assert.equal(card.events[0][3].missing.length, 3);
  });
  await check('missing background fails explicitly; restoring it permits retry on the same instance', async () => {
    const directory = path.join(temp, 'missing-background'), card = subject(directory); await assert.rejects(card.render(), /Welcome-card background is missing/);
    await installAssets(directory); const result = await card.render(); await validPng(result); assert.equal(card.events.length, 0);
  });
  await check('concurrent duplicate renders share the actual result and do not reread assets', async () => {
    const card = subject(local), results = await Promise.all([card.render(), card.render(), card.render()]); assert.equal(results[0], results[1]); assert.equal(results[1], results[2]); assert.equal(card.reads.length, 1); assert.equal(card.accesses.length, 3);
  });
  if (process.env.MISTBLOSSOM_QA_OUTPUT) {
    await fs.mkdir(process.env.MISTBLOSSOM_QA_OUTPUT, { recursive: true });
    await fs.writeFile(path.join(process.env.MISTBLOSSOM_QA_OUTPUT, 'welcome-card.png'), localResult.buffer);
  }
  console.log(`[check-welcome-assets] OK — ${passed}/${passed}; sharp=${sharp.versions.sharp}; standalone=${Boolean(runtime)}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (temp) await fs.rm(temp, { recursive: true, force: true }); });
