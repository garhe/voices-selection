import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { Connection, protectKey } from '../server/credentials.js';
import { Store } from '../server/store.js';
import { profile, assessment } from './fixtures.js';
import type { Job } from '../shared/domain.js';

const windowsOnly = { skip: process.platform !== 'win32' };
test('Windows user encryption round-trips a key without persisting plaintext', windowsOnly, async () => {
  const key = 'unit-test-placeholder-not-an-azure-key';
  const encrypted = await protectKey(key, 'protect');
  assert.notEqual(encrypted, key);
  assert.equal(encrypted.includes(key), false);
  assert.equal(await protectKey(encrypted, 'unprotect'), key);
  await assert.rejects(protectKey('not-valid-encrypted-data', 'unprotect'), /decrypt/);
});

test('connection storage preserves, replaces, reloads and removes encrypted credentials', windowsOnly, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-connection-'));
  try {
    const store = new Store(root); await store.init();
    const environment = { endpoint: 'https://env.openai.azure.com', key: 'environment-test-placeholder' };
    const connection = new Connection(store, environment); await connection.load();
    assert.equal(connection.status().connectionSource, 'environment');
    await assert.rejects(connection.save({ endpoint: 'https://new.openai.azure.com', apiKey: '' }), /Enter an API key/);
    await assert.rejects(connection.save({ endpoint: 'http://localhost', apiKey: 'placeholder' }), /HTTPS/);
    const saved = await connection.save({ endpoint: 'wss://saved.openai.azure.com/openai/v1/realtime?model=first-judge', apiKey: 'saved-test-placeholder' });
    assert.equal(saved.endpoint, 'https://saved.openai.azure.com');
    assert.equal(saved.connectionSource, 'saved');
    assert.equal(JSON.stringify(saved).includes('saved-test-placeholder'), false);
    const disk = await readFile(path.join(root, 'connection.json'), 'utf8');
    assert.equal(disk.includes('saved-test-placeholder'), false);
    await connection.save({ endpoint: 'wss://saved.openai.azure.com/openai/v1/realtime?model=second-judge', apiKey: '' });
    assert.equal(connection.current().key, 'saved-test-placeholder');
    await connection.save({ endpoint: saved.endpoint, apiKey: 'rotated-test-placeholder' });
    const restored = new Connection(store, environment); await restored.load();
    assert.equal(restored.current().key, 'rotated-test-placeholder');
    assert.equal(restored.redact(new Error('Failure with rotated-test-placeholder')), 'Failure with [REDACTED]');
    const reset = await restored.clear();
    assert.equal(reset.connectionSource, 'environment');
    assert.equal(restored.current().key, environment.key);
    assert.equal(await store.exists('connection.json'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('UI connection API applies settings without restart, hides keys and tests each draft deployment', windowsOnly, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-connection-api-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const tested: string[] = [];
  let evaluated = false;
  const { app, errors } = await createApp({
    dataDir: root, port: address.port,
    testConnection: async options => {
      assert.equal(options.endpoint, 'https://ui.openai.azure.com');
      assert.equal(options.key, 'ui-test-placeholder');
      tested.push(options.judge.deployment);
      if (options.judge.deployment === 'bad-deployment') throw new Error('Denied with ui-test-placeholder');
      return { model: 'mock-realtime-model' };
    },
    evaluate: async options => {
      evaluated = true;
      assert.equal(options.endpoint, 'https://ui.openai.azure.com');
      assert.equal(options.key, 'ui-test-placeholder');
      return { assessment: assessment() };
    },
  });
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, body?: unknown, method = 'POST') => fetch(url + route, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await (await request('/api/config')).json()).configured, false);
    assert.equal((await request('/api/connection', { endpoint: 'https://ui.openai.azure.com', apiKey: 'ui-test-placeholder' }, 'PUT')).status, 200);
    const configured = await (await request('/api/config')).json();
    assert.equal(configured.configured, true);
    assert.equal(configured.keyStored, true);
    assert.equal(configured.apiKey, undefined);
    assert.equal(JSON.stringify(configured).includes('ui-test-placeholder'), false);
    const draftJudges = configured.judges.map((j: { id: string; name: string; deployment: string }, i: number) => ({
      ...j, deployment: i === 0 ? 'good-deployment' : 'bad-deployment',
    }));
    const testResponse = await request('/api/connection/test', { judges: draftJudges });
    const tests = await testResponse.json();
    assert.equal(tests.results[0].ok, true);
    assert.equal(tests.results[0].model, 'mock-realtime-model');
    assert.equal(tests.results[1].ok, false);
    assert.match(tests.results[1].error, /\[REDACTED\]/);
    assert.equal(JSON.stringify(tests).includes('ui-test-placeholder'), false);
    assert.deepEqual(tested.sort(), ['bad-deployment', 'good-deployment']);
    assert.notEqual((await (await request('/api/config')).json()).judges[0].deployment, 'good-deployment', 'Testing must not silently save panel edits.');
    const id = crypto.randomUUID();
    await request('/api/clips', {
      clip: { id, voice: 'Example', file: 'one.wav', role: 'speaker', start: 0, end: 1, channel: 'mix', language: 'auto' },
      pcm: Buffer.alloc(48000).toString('base64'),
    });
    const started = await (await request('/api/jobs', { name: 'Connection test', profile, clipIds: [id], consent: true })).json() as Job;
    for (let n = 0; n < 100; n++) {
      const current = await (await request(`/api/jobs/${started.id}`)).json() as Job;
      assert.equal(JSON.stringify(current).includes('ui-test-placeholder'), false);
      if (current.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(evaluated, true);
    const removed = await (await request('/api/connection', {}, 'DELETE')).json();
    assert.equal(removed.configured, false);
    assert.equal((await request('/api/connection/test', { judges: draftJudges })).status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
