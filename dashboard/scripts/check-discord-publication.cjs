const assert = require('node:assert/strict');
const load = require('./lib/load-server-ts.cjs');
const values = load('src/lib/values.ts').exports;
const { DiscordRestError } = load('src/lib/discordRest.ts').exports;
let transport;
const globals = { FormData, Headers, AbortSignal, Response, fetch, process: { env: { DISCORD_BOT_TOKEN: 'qa-placeholder', DISCORD_GUILD_ID: '333333333333333333' } } };
const api = load('src/lib/discordAdmin.ts', {
  '@/lib/discordRest': { DiscordRestError, discordCredentialKey: () => 'qa', discordRestRequest: (...args) => transport(...args) },
  '@/lib/concurrency': {}, '@/lib/rulesOnboarding': {}, '@/lib/security': { logDashboardEvent() {} },
  '@/lib/values': values, '@/lib/discordAvatar': {}, '@/lib/discordRulesStats': {},
}, globals).exports;
const channel = '111111111111111111', bot = '444444444444444444';
const nonce = 'abc123', resourceUrl = 'https://guild.test/raids/raid';
const startedAt = new Date().toISOString();
const message = (id, extra = {}) => ({ id, channel_id: channel, author: { id: bot }, timestamp: startedAt, nonce, embeds: [{ url: resourceUrl }], ...extra });
let passed = 0;
async function test(label, run) { await run(); passed++; console.log('✓ ' + label); }
(async () => {
  await test('actual Discord transport preserves durable nonce and disables ambiguous POST replay', async () => {
    transport = async (path, init, options) => {
      assert.equal(path, '/channels/' + channel + '/messages'); assert.equal(options.retryNever, true);
      const body = JSON.parse(init.body); assert.equal(body.nonce, nonce); assert.equal(body.enforce_nonce, true);
      assert.equal(body.allowed_mentions.parse.length, 0); return { id: '900000000000000001', channel_id: channel };
    };
    await api.createDiscordRaidMessage({ channelId: channel, nonce, retry: 'never', embed: { title: 'qa' } });
  });
  await test('nonce recovery accepts only this bot, channel and a valid timestamp', async () => {
    transport = async path => path === '/users/@me' ? { id: bot } : [
      message('900000000000000001', { author: { id: 'someone-else' } }),
      message('900000000000000002', { channel_id: '222222222222222222' }),
      message('900000000000000003', { timestamp: null }), message('900000000000000004'),
    ];
    const result = await api.findDiscordPublicationMessage({ channelId: channel, nonce, startedAt, resourceUrl });
    assert.equal(result.id, '900000000000000004');
  });
  await test('recovery reads at most three history pages, without creating a message', async () => {
    let pages = 0;
    transport = async (path, init) => {
      assert.equal(init.method || 'GET', 'GET'); if (path === '/users/@me') return { id: bot };
      pages++; return Array.from({ length: 100 }, (_, i) => message(String(900000000000001000n - BigInt(pages * 100 + i)), { nonce: 'different' }));
    };
    assert.equal(await api.findDiscordPublicationMessage({ channelId: channel, nonce, startedAt, resourceUrl }), null); assert.equal(pages, 3);
  });
  await test('two exact nonce matches require explicit reconciliation', async () => {
    transport = async path => path === '/users/@me' ? { id: bot } : [message('900000000000000001'), message('900000000000000002')];
    await assert.rejects(api.findDiscordPublicationMessage({ channelId: channel, nonce, startedAt, resourceUrl }), /кілька/);
  });
  await test('manual recovery accepts the exact resource URL when Discord omits nonce', async () => {
    transport = async path => path === '/users/@me' ? { id: bot } : message('900000000000000001', { nonce: undefined });
    const result = await api.findDiscordPublicationMessage({ channelId: channel, nonce, startedAt, resourceUrl, manualRef: { channelId: channel, messageId: '900000000000000001' } });
    assert.equal(result.id, '900000000000000001');
  });
  await test('manual recovery rejects foreign resource, old message and wrong channel', async () => {
    const params = { channelId: channel, nonce, startedAt, resourceUrl, manualRef: { channelId: channel, messageId: '900000000000000001' } };
    for (const extra of [{ nonce: undefined, embeds: [{ url: 'https://guild.test/raids/other' }] }, { nonce: undefined, timestamp: '2020-01-01T00:00:00Z' }, { nonce: undefined, author: { id: 'foreign' } }]) {
      transport = async path => path === '/users/@me' ? { id: bot } : message('900000000000000001', extra);
      await assert.rejects(api.findDiscordPublicationMessage(params), /не належить/);
    }
    await assert.rejects(api.findDiscordPublicationMessage({ ...params, manualRef: { ...params.manualRef, channelId: '222222222222222222' } }), /канал/);
  });
  await test('scheduled-event recovery needs one exact event created by this bot', async () => {
    const params = { name: 'raid', description: resourceUrl, location: resourceUrl, scheduledStartTime: '2030-01-01T18:00:00Z', scheduledEndTime: '2030-01-01T21:00:00Z' };
    const event = { id: '900000000000000001', creator_id: bot, name: params.name, description: params.description, entity_type: 3, entity_metadata: { location: params.location }, scheduled_start_time: params.scheduledStartTime, scheduled_end_time: params.scheduledEndTime };
    transport = async path => path === '/users/@me' ? { id: bot } : [event, { ...event, creator_id: 'foreign' }];
    assert.equal((await api.findDiscordPublicationScheduledEvent(params)).id, event.id);
    transport = async path => path === '/users/@me' ? { id: bot } : [event, { ...event, id: '900000000000000002' }];
    assert.equal(await api.findDiscordPublicationScheduledEvent(params), null);
  });
  await test('configuration/validation failure before HTTP is a definitive rejection', async () => {
    let calls = 0; transport = async () => { calls++; throw Error('unexpected HTTP'); };
    const env = globals.process.env;
    const token = env.DISCORD_BOT_TOKEN; env.DISCORD_BOT_TOKEN = '';
    await assert.rejects(api.createDiscordRaidMessage({ channelId: channel, embed: {} }), error => error instanceof DiscordRestError && error.status === 401);
    env.DISCORD_BOT_TOKEN = token;
    await assert.rejects(api.createDiscordRaidMessage({ channelId: 'bad', embed: {} }), error => error instanceof DiscordRestError && error.status === 400);
    const guild = env.DISCORD_GUILD_ID; env.DISCORD_GUILD_ID = '';
    await assert.rejects(api.createDiscordGuildScheduledEvent({ name: 'raid', location: 'raid', scheduledStartTime: startedAt, scheduledEndTime: startedAt }), error => error instanceof DiscordRestError && error.status === 400);
    env.DISCORD_GUILD_ID = guild; assert.equal(calls, 0);
  });
  console.log('[check-discord-publication] ' + passed + '/' + passed + ' passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
